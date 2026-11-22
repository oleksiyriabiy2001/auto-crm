import type { Operation, StockMovement } from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from '@/data/local-database'
import {
  DexieCategoryRepository,
  DexieOutboxRepository,
  DexieProductBarcodeRepository,
  DexieProductRepository,
  DexieStockMovementRepository,
  DexieSyncStateRepository,
  DexieTransactionRunner,
} from '@/data/repositories'

import { FAKE_TENANT, FAKE_USER, FakeGateway } from './fake-gateway'
import type { SyncRepositories, SyncStatus } from './sync-engine'
import { SyncEngine } from './sync-engine'

const OTHER_USER = '0190a5d0-0000-7000-8000-0000000000a2'
const DEVICE = '0190a5d0-0000-7000-8000-0000000000d1'
const PRODUCT = '0190a5d0-0000-7000-8000-0000000000f1'

let idCounter = 0
const newId = (): string => `0190a5d0-0000-7000-8000-${String(++idCounter).padStart(12, '0')}`

const envelope = () => ({ id: newId(), clientTimestamp: '2026-11-22T10:00:00Z', deviceId: DEVICE })

const sale = (quantityDelta = -1): Operation => ({
  ...envelope(),
  type: 'stock.move',
  payload: {
    id: newId(),
    productId: PRODUCT,
    type: quantityDelta > 0 ? 'receive' : 'sale',
    quantityDelta,
    unitCostMinor: null,
    unitPriceMinor: 25_000,
    currency: 'UAH',
    note: null,
    occurredAt: '2026-11-22T10:00:00.000Z',
  },
})

const remoteMovement = (quantityDelta: number): StockMovement => ({
  id: newId(),
  tenantId: FAKE_TENANT,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
  deletedAt: null,
  version: 1,
  productId: PRODUCT,
  type: 'receive',
  quantityDelta,
  unitCostMinor: null,
  unitPriceMinor: null,
  currency: 'UAH',
  note: null,
  occurredAt: '2026-11-22T10:00:00.000Z',
  createdBy: OTHER_USER,
  deviceId: '0190a5d0-0000-7000-8000-0000000000d2',
  sourceType: null,
  sourceId: null,
})

// Timers the test fires by hand: Vitest's fake timers would also freeze
// the in-memory IndexedDB.
class ManualTimers {
  private next = 0
  readonly scheduled = new Map<number, { callback: () => void, ms: number }>()

  set = (callback: () => void, ms: number): number => {
    this.scheduled.set(++this.next, { callback, ms })
    return this.next
  }

  clear = (handle: unknown): void => {
    this.scheduled.delete(handle as number)
  }

  // The delays currently waiting, e.g. [60000].
  delays(): number[] {
    return [...this.scheduled.values()].map((timer) => timer.ms)
  }
}

let db: LocalDatabase
let gateway: FakeGateway
let timers: ManualTimers
let repositories: SyncRepositories
let engine: SyncEngine

const queue = async (operation: Operation, userId = FAKE_USER): Promise<void> => {
  await repositories.outbox.add({ operation, userId, status: 'pending' })
}

const outboxStatuses = async (): Promise<string[]> => (await db.outbox.toArray()).map((row) => row.status)

beforeEach(() => {
  db = new LocalDatabase(FAKE_TENANT, { indexedDB: new IDBFactory(), IDBKeyRange })
  gateway = new FakeGateway()
  timers = new ManualTimers()
  repositories = {
    categories: new DexieCategoryRepository(db),
    products: new DexieProductRepository(db),
    barcodes: new DexieProductBarcodeRepository(db),
    movements: new DexieStockMovementRepository(db),
    outbox: new DexieOutboxRepository(db),
    syncState: new DexieSyncStateRepository(db),
  }
  engine = new SyncEngine(gateway, repositories, new DexieTransactionRunner(db), FAKE_USER, {
    batchSize: 2,
    now: () => new Date('2026-11-22T12:00:00.000Z'),
    random: () => 1,
    setTimer: timers.set,
    clearTimer: timers.clear,
  })
})

afterEach(() => {
  engine.stop()
  db.close()
})

describe('push', () => {
  it('sends this user\'s changes in order, in batches, and never another user\'s', async () => {
    const [first, second, third] = [sale(), sale(), sale()]
    await queue(first)
    await queue(sale(), OTHER_USER)
    await queue(second)
    await queue(third)

    await engine.syncNow()

    expect(gateway.pushed.map((batch) => batch.map((op) => op.id))).toStrictEqual([
      [first.id, second.id],
      [third.id],
    ])
    expect(await repositories.outbox.listPending(OTHER_USER)).toHaveLength(1)
  })

  it('keeps confirmed changes until the pull brings their rows back', async () => {
    await queue(sale(-2))
    gateway.failNext('pull')

    await engine.syncNow()
    expect(await outboxStatuses()).toStrictEqual(['accepted'])
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(0)

    await engine.syncNow()
    expect(await outboxStatuses()).toStrictEqual([])
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(-2)
  })

  it('moves a refused change to "needs attention" and carries on', async () => {
    const refused = sale()
    await queue(refused)
    await queue(sale())
    gateway.decide = (op) => (op.id === refused.id ? { operationId: op.id, status: 'rejected', reason: 'forbidden' } : undefined)

    await engine.syncNow()

    expect(await repositories.outbox.listRejected(FAKE_USER)).toStrictEqual([
      { operation: refused, userId: FAKE_USER, status: 'rejected', reason: 'forbidden' },
    ])
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0, rejectedCount: 1 })
  })

  it('keeps changes pending and stops when the shop is suspended', async () => {
    await queue(sale())
    gateway.decide = (op) => ({ operationId: op.id, status: 'rejected', reason: 'tenantSuspended' })

    await engine.syncNow()

    expect(await outboxStatuses()).toStrictEqual(['pending'])
    expect(engine.getStatus().phase).toBe('accessDenied')
    expect(timers.delays()).toStrictEqual([])
  })

  it('keeps unsent changes when the connection drops, and retries with backoff', async () => {
    await queue(sale())
    await queue(sale())
    await queue(sale())
    gateway.failNext('push')

    await engine.syncNow()
    expect(await outboxStatuses()).toStrictEqual(['pending', 'pending', 'pending'])
    expect(engine.getStatus()).toMatchObject({ phase: 'offline', pendingCount: 3 })
    expect(timers.delays()).toStrictEqual([1_000])

    gateway.failNext('push')
    await engine.syncNow()
    expect(timers.delays()).toStrictEqual([2_000])

    await engine.syncNow()
    expect(await outboxStatuses()).toStrictEqual([])
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0 })
    expect(timers.delays()).toStrictEqual([60_000])
  })

  it('never applies a change twice when the server\'s answer is lost', async () => {
    await queue(sale(-3))
    gateway.failNext('push', new GatewayError('network'), true)

    await engine.syncNow()
    expect(await outboxStatuses()).toStrictEqual(['pending'])

    await engine.syncNow()
    expect(gateway.pushed).toHaveLength(2)
    expect(await outboxStatuses()).toStrictEqual([])
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(-3)
  })

  it('stops instead of looping when the server skips a result', async () => {
    await queue(sale())
    gateway.pushOperations = () => Promise.resolve({ results: [] })

    await engine.syncNow()

    expect(await outboxStatuses()).toStrictEqual(['pending'])
    expect(engine.getStatus().phase).toBe('error')
  })
})

describe('pull', () => {
  it('pages through every change and remembers where it stopped', async () => {
    gateway.pageSize = 2
    for (const delta of [1, 2, 3, 4, 5]) gateway.addRow(remoteMovement(delta))

    await engine.syncNow()

    expect(gateway.pulledCursors).toStrictEqual([null, '2', '4'])
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(15)
    expect(await repositories.syncState.getCursor()).toBe('5')

    gateway.addRow(remoteMovement(10))
    await engine.syncNow()
    expect(gateway.pulledCursors.at(-1)).toBe('5')
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(25)
  })

  it('resumes from the last saved page after a failure', async () => {
    gateway.pageSize = 2
    for (const delta of [1, 2, 3]) gateway.addRow(remoteMovement(delta))
    const pull = gateway.pullChanges.bind(gateway)
    let calls = 0
    gateway.pullChanges = (request) => (++calls === 2 ? Promise.reject(new GatewayError('network')) : pull(request))

    await engine.syncNow()
    expect(await repositories.syncState.getCursor()).toBe('2')
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(3)
    expect(await repositories.syncState.getLastSyncedAt()).toBeNull()

    await engine.syncNow()
    expect(gateway.pulledCursors.at(-1)).toBe('2')
    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(6)
  })

  it('counts the device\'s own movement once when it comes back', async () => {
    await queue(sale(-1))
    gateway.addRow(remoteMovement(5))

    await engine.syncNow()
    await engine.syncNow()

    expect(await repositories.movements.getQuantity(PRODUCT)).toBe(4)
    expect(await repositories.movements.listByProduct(PRODUCT)).toHaveLength(2)
  })

  it('records when the last full sync finished', async () => {
    await engine.syncNow()
    expect(engine.getStatus().lastSyncedAt).toBe('2026-11-22T12:00:00.000Z')
  })
})

describe('scheduling', () => {
  it('runs one cycle at a time and follows up on a request made during it', async () => {
    const first = engine.syncNow()
    engine.requestSync()
    await engine.syncNow()
    await first

    expect(gateway.pulledCursors).toHaveLength(1)
    expect(timers.delays()).toStrictEqual([0])
  })

  it('syncs soon after a local write, without pushing the poll timer later', async () => {
    await engine.syncNow()
    expect(timers.delays()).toStrictEqual([60_000])

    engine.requestSync()
    expect(timers.delays()).toStrictEqual([500])
  })

  it('caps the backoff at five minutes', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      gateway.failNext('pull')
      await engine.syncNow()
    }
    expect(timers.delays()).toStrictEqual([300_000])
  })

  it('forgets the backoff when the device comes back online', async () => {
    gateway.failNext('pull')
    gateway.failNext('pull')
    await engine.syncNow()
    await engine.syncNow()
    expect(timers.delays()).toStrictEqual([2_000])

    await engine.notifyOnline()
    expect(engine.getStatus().phase).toBe('idle')
    expect(timers.delays()).toStrictEqual([60_000])
  })

  it.each([
    ['sessionExpired', 'signInRequired'],
    ['accessDenied', 'accessDenied'],
  ] as const)('stops on %s until started again', async (code, phase) => {
    gateway.failNext('pull', new GatewayError(code))

    await engine.syncNow()
    expect(engine.getStatus().phase).toBe(phase)
    expect(timers.delays()).toStrictEqual([])

    engine.requestSync()
    expect(timers.delays()).toStrictEqual([])

    await engine.start()
    expect(engine.getStatus().phase).toBe('idle')
  })

  it('tells subscribers about every change of status', async () => {
    const seen: SyncStatus['phase'][] = []
    const unsubscribe = engine.subscribe((status) => seen.push(status.phase))
    await queue(sale())

    await engine.syncNow()
    unsubscribe()
    await engine.syncNow()

    expect(seen).toStrictEqual(['syncing', 'idle', 'idle'])
  })
})
