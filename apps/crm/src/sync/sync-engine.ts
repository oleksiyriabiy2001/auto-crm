import type {
  CategoryRepository,
  Id,
  OutboxRepository,
  ProductBarcodeRepository,
  ProductRepository,
  RemoteGateway,
  StockMovementRepository,
  SyncStateRepository,
  TransactionRunner,
  UtcTimestamp,
} from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'

// The only code that talks to the backend after sign-in. One cycle pushes this
// user's outbox in order, then pulls every change since the stored cursor.
// Every step is saved in a local transaction before the next network call, so
// a dropped connection or a closed tab leaves nothing half-applied: unsent
// entries stay pending, a lost push response is answered "duplicate" on retry,
// and an interrupted pull resumes from the last saved cursor.

export interface SyncRepositories {
  categories: CategoryRepository
  products: ProductRepository
  barcodes: ProductBarcodeRepository
  movements: StockMovementRepository
  outbox: OutboxRepository
  syncState: SyncStateRepository
}

export type SyncPhase
  = | 'idle' // up to date, waiting for the next cycle
    | 'syncing'
    | 'offline' // the backend could not be reached; retrying with backoff
    | 'error' // something else failed; retrying with backoff
    | 'signInRequired' // stopped until the user signs in again
    | 'accessDenied' // stopped: no active membership or the shop is suspended

export interface SyncStatus {
  phase: SyncPhase
  pendingCount: number // changes not confirmed by the server yet
  rejectedCount: number // the "needs attention" list
  lastSyncedAt: UtcTimestamp | null
}

export interface SyncEngineOptions {
  batchSize: number // operations per push
  pollIntervalMs: number // how often to pull other devices' changes
  requestDelayMs: number // debounce after a local write
  backoffBaseMs: number
  backoffMaxMs: number
  now: () => Date
  random: () => number
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  // Keeps two tabs of the same shop from syncing at once.
  withLock: <T>(work: () => Promise<T>) => Promise<T>
}

export const DEFAULT_SYNC_OPTIONS: SyncEngineOptions = {
  batchSize: 100,
  pollIntervalMs: 60_000,
  requestDelayMs: 500,
  backoffBaseMs: 1_000,
  backoffMaxMs: 5 * 60_000,
  now: () => new Date(),
  random: Math.random,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
  withLock: (work) => work(),
}

export class SyncEngine {
  private readonly options: SyncEngineOptions
  private status: SyncStatus = { phase: 'idle', pendingCount: 0, rejectedCount: 0, lastSyncedAt: null }
  private readonly listeners = new Set<(status: SyncStatus) => void>()
  private timer: { handle: unknown, dueAt: number } | null = null
  private running: Promise<void> | null = null
  private runAgain = false
  private stopped = false // by stop(): the database may be closed already
  private halted = false // by stop(), an expired session or denied access
  private failures = 0

  constructor(
    private readonly gateway: RemoteGateway,
    private readonly repositories: SyncRepositories,
    private readonly transactions: TransactionRunner,
    private readonly userId: Id,
    options: Partial<SyncEngineOptions> = {},
  ) {
    this.options = { ...DEFAULT_SYNC_OPTIONS, ...options }
  }

  getStatus(): SyncStatus {
    return this.status
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Syncs now, then keeps polling until stop().
  async start(): Promise<void> {
    this.stopped = false
    this.halted = false
    this.failures = 0
    await this.syncNow()
  }

  // A cycle already running finishes its current network call and then ends
  // quietly, without touching the database.
  stop(): void {
    this.stopped = true
    this.halted = true
    this.clearTimer()
  }

  // Called after a local write: sync soon, so the change leaves the device.
  requestSync(): void {
    if (this.halted) return
    if (this.running) {
      this.runAgain = true
      return
    }
    this.schedule(this.options.requestDelayMs)
  }

  // The browser came back online: forget the backoff and sync now.
  notifyOnline(): Promise<void> {
    if (this.halted) return Promise.resolve()
    this.failures = 0
    return this.syncNow()
  }

  notifyOffline(): void {
    if (this.halted) return
    this.update({ phase: 'offline' })
  }

  // Runs one cycle and resolves when it ends. If one is already running, waits
  // for it and has it followed by another as soon as it ends.
  syncNow(): Promise<void> {
    if (this.halted) return Promise.resolve()
    if (this.running) {
      this.runAgain = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<void> {
    this.clearTimer()
    this.update({ phase: 'syncing' })

    let nextDelay: number | null = this.options.pollIntervalMs
    try {
      await this.options.withLock(() => this.cycle())
      this.failures = 0
      this.update({ phase: 'idle' })
    } catch (error) {
      if (this.stopped) return
      nextDelay = this.handleFailure(error)
    }

    try {
      await this.refreshCounts()
    } catch (error) {
      if (this.stopped) return
      console.error('Sync status failed', error)
    }
    if (nextDelay !== null && !this.halted) {
      this.schedule(this.runAgain ? 0 : nextDelay)
    }
    this.runAgain = false
  }

  private async cycle(): Promise<void> {
    await this.push()
    await this.pull()
  }

  private async push(): Promise<void> {
    const { outbox } = this.repositories
    for (;;) {
      const batch = (await outbox.listPending(this.userId)).slice(0, this.options.batchSize)
      if (batch.length === 0) return

      const { results } = await this.gateway.pushOperations({ operations: batch.map((entry) => entry.operation) })
      const resultById = new Map(results.map((result) => [result.operationId, result]))

      const { suspended, missing } = await this.transactions.run(async () => {
        const accepted: Id[] = []
        const outcome = { suspended: false, missing: false }
        for (const { operation } of batch) {
          const result = resultById.get(operation.id)
          if (result === undefined) outcome.missing = true
          else if (result.status !== 'rejected') accepted.push(operation.id)
          // Not the user's fault: keep it pending for when the shop is active.
          else if (result.reason === 'tenantSuspended') outcome.suspended = true
          else await outbox.markRejected(operation.id, result.reason)
        }
        await outbox.markAccepted(accepted)
        return outcome
      })

      if (suspended) throw new GatewayError('accessDenied')
      // Retrying at once would send the same batch forever.
      if (missing) throw new Error('The push response is missing results')
    }
  }

  private async pull(): Promise<void> {
    const { categories, products, barcodes, movements, outbox, syncState } = this.repositories
    let cursor = await syncState.getCursor()
    for (;;) {
      const { changes, cursor: next, hasMore } = await this.gateway.pullChanges({ cursor })
      await this.transactions.run(async () => {
        for (const row of changes.categories) await categories.put(row)
        for (const row of changes.products) await products.put(row)
        for (const row of changes.productBarcodes) await barcodes.put(row)
        for (const row of changes.stockMovements) await movements.add(row)
        await syncState.setCursor(next)
        if (!hasMore) {
          // Their rows are local now, so the overlay no longer needs them.
          await outbox.removeAccepted(this.userId)
          await syncState.setLastSyncedAt(this.options.now().toISOString())
        }
      })
      if (!hasMore) return
      cursor = next
    }
  }

  // Returns the delay before the next attempt, or null to stop retrying.
  private handleFailure(error: unknown): number | null {
    const code = error instanceof GatewayError ? error.code : null
    if (code === 'sessionExpired' || code === 'accessDenied') {
      this.halted = true
      this.update({ phase: code === 'sessionExpired' ? 'signInRequired' : 'accessDenied' })
      return null
    }
    if (code !== 'network') console.error('Sync failed', error)
    this.failures += 1
    this.update({ phase: code === 'network' ? 'offline' : 'error' })
    return this.backoff()
  }

  // Exponential, capped, with jitter so many devices do not retry together.
  private backoff(): number {
    const { backoffBaseMs, backoffMaxMs, random } = this.options
    const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** (this.failures - 1))
    return Math.round(delay * (0.5 + random() / 2))
  }

  private schedule(ms: number): void {
    const dueAt = this.options.now().getTime() + ms
    if (this.timer && this.timer.dueAt <= dueAt) return
    this.clearTimer()
    const handle = this.options.setTimer(() => {
      this.timer = null
      void this.syncNow()
    }, ms)
    this.timer = { handle, dueAt }
  }

  private clearTimer(): void {
    if (this.timer) this.options.clearTimer(this.timer.handle)
    this.timer = null
  }

  private async refreshCounts(): Promise<void> {
    const { outbox, syncState } = this.repositories
    const [pending, rejected, lastSyncedAt] = await Promise.all([
      outbox.listPending(this.userId),
      outbox.listRejected(this.userId),
      syncState.getLastSyncedAt(),
    ])
    this.update({ pendingCount: pending.length, rejectedCount: rejected.length, lastSyncedAt })
  }

  private update(change: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...change }
    for (const listener of this.listeners) listener(this.status)
  }
}
