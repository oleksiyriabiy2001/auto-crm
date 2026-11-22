import type { Operation, ProductBarcode, StockMovement } from '@auto-crm/core'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from './local-database'
import {
  DexieOutboxRepository,
  DexieProductBarcodeRepository,
  DexieProductRepository,
  DexieStockMovementRepository,
  DexieSyncStateRepository,
  DexieTransactionRunner,
} from './repositories'

const TENANT = '0190a5d0-0000-7000-8000-00000000000a'
const USER = '0190a5d0-0000-7000-8000-0000000000a1'
const OTHER_USER = '0190a5d0-0000-7000-8000-0000000000a2'
const PRODUCT = '0190a5d0-0000-7000-8000-0000000000f1'

let idCounter = 0
const newId = (): string => `0190a5d0-0000-7000-8000-${String(++idCounter).padStart(12, '0')}`

const synced = () => ({
  tenantId: TENANT,
  createdAt: '2026-11-22T10:00:00.000000Z',
  updatedAt: '2026-11-22T10:00:00.000000Z',
  deletedAt: null,
  version: 1,
})

const movement = (quantityDelta: number, id = newId()): StockMovement => ({
  ...synced(),
  id,
  productId: PRODUCT,
  type: quantityDelta > 0 ? 'receive' : 'sale',
  quantityDelta,
  unitCostMinor: null,
  unitPriceMinor: null,
  currency: 'UAH',
  note: null,
  occurredAt: '2026-11-22T10:00:00.000000Z',
  createdBy: USER,
  deviceId: '0190a5d0-0000-7000-8000-0000000000d1',
  sourceType: null,
  sourceId: null,
})

const barcode = (code: string, deletedAt: string | null = null): ProductBarcode => ({
  ...synced(),
  id: newId(),
  productId: PRODUCT,
  barcode: code,
  symbology: null,
  deletedAt,
})

const deleteOperation = (): Operation => ({
  id: newId(),
  clientTimestamp: '2026-11-22T10:00:00Z',
  deviceId: '0190a5d0-0000-7000-8000-0000000000d1',
  type: 'product.delete',
  baseVersion: 1,
  payload: { id: PRODUCT },
})

let indexedDB: IDBFactory
let db: LocalDatabase

beforeEach(() => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(TENANT, { indexedDB, IDBKeyRange })
})

afterEach(() => {
  db.close()
})

describe('DexieStockMovementRepository', () => {
  it('keeps the cached quantity equal to the sum of movements, without float drift', async () => {
    const movements = new DexieStockMovementRepository(db)
    for (const delta of [0.1, 0.2, 5, -1.25]) await movements.add(movement(delta))
    expect(await movements.getQuantity(PRODUCT)).toBe(4.05)
    expect(await movements.listByProduct(PRODUCT)).toHaveLength(4)
  })

  it('counts a movement once when it arrives again from a pull', async () => {
    const movements = new DexieStockMovementRepository(db)
    const sale = movement(-2)
    await movements.add(sale)
    await movements.add(sale)
    expect(await movements.getQuantity(PRODUCT)).toBe(-2)
    expect(await movements.listByProduct(PRODUCT)).toHaveLength(1)
  })

  it('reports zero for a product with no movements', async () => {
    expect(await new DexieStockMovementRepository(db).getQuantity(PRODUCT)).toBe(0)
  })

  it('tells whether a movement is in the ledger', async () => {
    const movements = new DexieStockMovementRepository(db)
    const sale = movement(-1)
    await movements.add(sale)
    expect(await movements.has(sale.id)).toBe(true)
    expect(await movements.has(newId())).toBe(false)
  })

  it('lists every product\'s cached quantity', async () => {
    const movements = new DexieStockMovementRepository(db)
    const other = newId()
    await movements.add(movement(3))
    await movements.add({ ...movement(-0.5), productId: other })
    expect(await movements.listQuantities()).toStrictEqual(new Map([[PRODUCT, 3], [other, -0.5]]))
  })
})

describe('DexieProductBarcodeRepository', () => {
  it('finds only the live barcode, not a removed one', async () => {
    const barcodes = new DexieProductBarcodeRepository(db)
    const live = barcode('4820000000017')
    await barcodes.put(barcode('4820000000017', '2026-11-21T10:00:00.000000Z'))
    await barcodes.put(live)
    expect(await barcodes.findByBarcode('4820000000017')).toStrictEqual(live)
    expect(await barcodes.findByBarcode('0000')).toBeUndefined()
    expect(await barcodes.listByProduct(PRODUCT)).toHaveLength(2)
    expect(await barcodes.list()).toHaveLength(2)
  })
})

describe('DexieOutboxRepository', () => {
  it('lists one user\'s pending entries in the order they were added', async () => {
    const outbox = new DexieOutboxRepository(db)
    const [first, second, theirs] = [deleteOperation(), deleteOperation(), deleteOperation()]
    await outbox.add({ operation: second, userId: USER, status: 'pending' })
    await outbox.add({ operation: theirs, userId: OTHER_USER, status: 'pending' })
    await outbox.add({ operation: first, userId: USER, status: 'pending' })

    const pending = await outbox.listPending(USER)
    expect(pending.map((entry) => entry.operation.id)).toStrictEqual([second.id, first.id])
    expect(pending[0]).toStrictEqual({ operation: second, userId: USER, status: 'pending' })
  })

  it('moves a rejected entry to "needs attention" and removes entries', async () => {
    const outbox = new DexieOutboxRepository(db)
    const [rejected, accepted] = [deleteOperation(), deleteOperation()]
    await outbox.add({ operation: rejected, userId: USER, status: 'pending' })
    await outbox.add({ operation: accepted, userId: USER, status: 'pending' })

    await outbox.markRejected(rejected.id, 'forbidden')
    await outbox.remove(accepted.id)

    expect(await outbox.listPending(USER)).toStrictEqual([])
    expect(await outbox.listRejected(USER)).toStrictEqual([
      { operation: rejected, userId: USER, status: 'rejected', reason: 'forbidden' },
    ])
  })

  it('keeps accepted entries out of the pending list until they are removed', async () => {
    const outbox = new DexieOutboxRepository(db)
    const [accepted, pending, theirs] = [deleteOperation(), deleteOperation(), deleteOperation()]
    await outbox.add({ operation: accepted, userId: USER, status: 'pending' })
    await outbox.add({ operation: pending, userId: USER, status: 'pending' })
    await outbox.add({ operation: theirs, userId: OTHER_USER, status: 'accepted' })

    await outbox.markAccepted([accepted.id])
    expect((await outbox.listPending(USER)).map((entry) => entry.operation.id)).toStrictEqual([pending.id])

    await outbox.removeAccepted(USER)
    expect(await db.outbox.count()).toBe(2)
    expect((await db.outbox.get({ operationId: theirs.id }))?.status).toBe('accepted')
  })

  it('lists one user\'s pending and accepted entries in the order they were added', async () => {
    const outbox = new DexieOutboxRepository(db)
    const [first, accepted, rejected, last, theirs] = [deleteOperation(), deleteOperation(), deleteOperation(), deleteOperation(), deleteOperation()]
    for (const operation of [first, accepted, rejected, last]) await outbox.add({ operation, userId: USER, status: 'pending' })
    await outbox.add({ operation: theirs, userId: OTHER_USER, status: 'pending' })
    await outbox.markAccepted([accepted.id])
    await outbox.markRejected(rejected.id, 'notFound')

    expect(await outbox.listUnconfirmed(USER)).toStrictEqual([
      { operation: first, userId: USER, status: 'pending' },
      { operation: accepted, userId: USER, status: 'accepted' },
      { operation: last, userId: USER, status: 'pending' },
    ])
  })

  it('refuses the same operation twice', async () => {
    const outbox = new DexieOutboxRepository(db)
    const operation = deleteOperation()
    await outbox.add({ operation, userId: USER, status: 'pending' })
    await expect(outbox.add({ operation, userId: USER, status: 'pending' })).rejects.toThrow('ConstraintError')
  })
})

describe('DexieSyncStateRepository', () => {
  it('starts with no cursor and keeps the last one set', async () => {
    const state = new DexieSyncStateRepository(db)
    expect(await state.getCursor()).toBeNull()
    await state.setCursor('41')
    await state.setCursor('42')
    expect(await state.getCursor()).toBe('42')
  })

  it('keeps the last sync time apart from the cursor', async () => {
    const state = new DexieSyncStateRepository(db)
    expect(await state.getLastSyncedAt()).toBeNull()
    await state.setCursor('7')
    await state.setLastSyncedAt('2026-11-22T10:00:00.000Z')
    expect(await state.getLastSyncedAt()).toBe('2026-11-22T10:00:00.000Z')
    expect(await state.getCursor()).toBe('7')
  })
})

describe('DexieTransactionRunner', () => {
  it('saves nothing when the work fails part-way', async () => {
    const movements = new DexieStockMovementRepository(db)
    const outbox = new DexieOutboxRepository(db)
    const operation = deleteOperation()

    await expect(new DexieTransactionRunner(db).run(async () => {
      await movements.add(movement(3))
      await outbox.add({ operation, userId: USER, status: 'pending' })
      throw new Error('crash before commit')
    })).rejects.toThrow('crash before commit')

    expect(await movements.getQuantity(PRODUCT)).toBe(0)
    expect(await movements.listByProduct(PRODUCT)).toStrictEqual([])
    expect(await outbox.listPending(USER)).toStrictEqual([])
  })

  it('commits every call when the work succeeds', async () => {
    const products = new DexieProductRepository(db)
    const outbox = new DexieOutboxRepository(db)
    const operation = deleteOperation()

    await new DexieTransactionRunner(db).run(async () => {
      await outbox.add({ operation, userId: USER, status: 'pending' })
      await new DexieStockMovementRepository(db).add(movement(1))
    })

    expect(await outbox.listPending(USER)).toHaveLength(1)
    expect(await products.list()).toStrictEqual([])
  })
})

describe('LocalDatabase', () => {
  it('keeps each shop in its own database', async () => {
    const otherShop = new LocalDatabase('0190a5d0-0000-7000-8000-00000000000b', { indexedDB, IDBKeyRange })
    await new DexieStockMovementRepository(db).add(movement(5))
    expect(await new DexieStockMovementRepository(otherShop).getQuantity(PRODUCT)).toBe(0)
    otherShop.close()
  })
})
