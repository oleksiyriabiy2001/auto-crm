import type { AuthSession, BootstrapResponse, DeviceRepository, Id, RemoteGateway } from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'

import { DeviceDatabase, DexieDeviceRepository } from '@/data/device-database'
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
import { gateway } from '@/gateway'

import type { SyncEngineOptions, SyncStatus } from './sync-engine'
import { SyncEngine } from './sync-engine'

export interface SyncServiceDeps {
  gateway: RemoteGateway
  device: DeviceRepository
  openDatabase: (tenantId: Id) => LocalDatabase
  isOnline: () => boolean
  // Calls back when the browser goes online or offline; returns a remover.
  watchNetwork: (onOnline: () => void, onOffline: () => void) => () => void
  // Runs `work` while holding the named lock, across tabs.
  lock: <T>(name: string, work: () => Promise<T>) => Promise<T>
  engineOptions?: Partial<SyncEngineOptions>
}

interface ActiveSync {
  engine: SyncEngine
  db: LocalDatabase
  stopWatching: () => void
  unsubscribe: () => void
}

// Starts and stops syncing for the signed-in user. The shop and role come from
// `bootstrap` when online, or from the copy saved at the last online start.
export class SyncService {
  private active: ActiveSync | null = null
  private status: SyncStatus = { phase: 'idle', pendingCount: 0, rejectedCount: 0, lastSyncedAt: null }
  private readonly listeners = new Set<(status: SyncStatus) => void>()

  constructor(private readonly deps: SyncServiceDeps) {}

  // Rejects with a GatewayError: `network` when offline on the device's first
  // start for this user, `sessionExpired` or `accessDenied` from the server.
  async start(session: AuthSession): Promise<BootstrapResponse> {
    this.stop()
    const bootstrap = await this.loadBootstrap(session.userId)

    const db = this.deps.openDatabase(bootstrap.tenant.id)
    const engine = new SyncEngine(
      this.deps.gateway,
      {
        categories: new DexieCategoryRepository(db),
        products: new DexieProductRepository(db),
        barcodes: new DexieProductBarcodeRepository(db),
        movements: new DexieStockMovementRepository(db),
        outbox: new DexieOutboxRepository(db),
        syncState: new DexieSyncStateRepository(db),
      },
      new DexieTransactionRunner(db),
      session.userId,
      {
        withLock: (work) => this.deps.lock(`auto-crm-sync-${bootstrap.tenant.id}`, work),
        ...this.deps.engineOptions,
      },
    )
    this.active = {
      engine,
      db,
      unsubscribe: engine.subscribe((status) => {
        this.update(status)
      }),
      stopWatching: this.deps.watchNetwork(
        () => void engine.notifyOnline(),
        () => {
          engine.notifyOffline()
        },
      ),
    }
    // The first sync can take a while on a big shop; screens read local data
    // meanwhile.
    void engine.start()
    return bootstrap
  }

  stop(): void {
    if (!this.active) return
    const { engine, db, stopWatching, unsubscribe } = this.active
    engine.stop()
    stopWatching()
    unsubscribe()
    db.close()
    this.active = null
  }

  requestSync(): void {
    this.active?.engine.requestSync()
  }

  getStatus(): SyncStatus {
    return this.status
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async loadBootstrap(userId: Id): Promise<BootstrapResponse> {
    const { device } = this.deps
    if (this.deps.isOnline()) {
      try {
        const bootstrap = await this.deps.gateway.bootstrap()
        await device.saveBootstrap(userId, bootstrap)
        return bootstrap
      } catch (error) {
        // `navigator.onLine` can say online when the server is unreachable.
        if (!(error instanceof GatewayError && error.code === 'network')) throw error
      }
    }
    const saved = await device.getBootstrap(userId)
    if (!saved) throw new GatewayError('network')
    return saved
  }

  private update(status: SyncStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}

export const syncService = new SyncService({
  gateway,
  device: new DexieDeviceRepository(new DeviceDatabase()),
  openDatabase: (tenantId) => new LocalDatabase(tenantId),
  isOnline: () => navigator.onLine,
  watchNetwork: (onOnline, onOffline) => {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  },
  // Web Locks keep two tabs of one shop from syncing at once.
  lock: (name, work) => ('locks' in navigator ? navigator.locks.request(name, work) : work()),
})
