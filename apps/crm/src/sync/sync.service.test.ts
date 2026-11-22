import type { AuthSession } from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DeviceDatabase, DexieDeviceRepository } from '@/data/device-database'
import { LocalDatabase } from '@/data/local-database'

import { FAKE_TENANT, FAKE_USER, FakeGateway } from './fake-gateway'
import type { SyncStatus } from './sync-engine'
import { SyncService } from './sync.service'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const session: AuthSession = { userId: FAKE_USER, email: 'staff@example.com', expiresAt: '2026-11-23T10:00:00.000Z' }

let indexedDB: IDBFactory
let deviceDb: DeviceDatabase
let device: DexieDeviceRepository
let gateway: FakeGateway
let online: boolean
let service: SyncService

const createService = () => new SyncService({
  gateway,
  device,
  openDatabase: (tenantId) => new LocalDatabase(tenantId, { indexedDB, IDBKeyRange }),
  isOnline: () => online,
  watchNetwork: () => () => undefined,
  lock: (_name, work) => work(),
  engineOptions: { setTimer: () => 0, clearTimer: () => undefined },
})

// Resolves once the engine reaches `phase`.
const reach = (phase: SyncStatus['phase']): Promise<void> => new Promise((resolve) => {
  const unsubscribe = service.subscribe((status) => {
    if (status.phase === phase) {
      unsubscribe()
      resolve()
    }
  })
})

beforeEach(() => {
  indexedDB = new IDBFactory()
  deviceDb = new DeviceDatabase({ indexedDB, IDBKeyRange })
  device = new DexieDeviceRepository(deviceDb)
  gateway = new FakeGateway()
  online = true
  service = createService()
})

afterEach(() => {
  service.stop()
  deviceDb.close()
})

describe('SyncService', () => {
  it('bootstraps online, saves the result and starts syncing', async () => {
    const idle = reach('idle')
    const bootstrap = await service.start(session)
    await idle

    expect(bootstrap.tenant.id).toBe(FAKE_TENANT)
    expect(await device.getBootstrap(FAKE_USER)).toStrictEqual(bootstrap)
    expect(gateway.pulledCursors).toStrictEqual([null])
  })

  it('starts offline from the saved bootstrap', async () => {
    await device.saveBootstrap(FAKE_USER, gateway.bootstrapResponse)
    online = false
    const bootstrap = vi.spyOn(gateway, 'bootstrap')

    expect((await service.start(session)).membership.role).toBe('staff')
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it('falls back to the saved bootstrap when the server cannot be reached', async () => {
    await device.saveBootstrap(FAKE_USER, gateway.bootstrapResponse)
    vi.spyOn(gateway, 'bootstrap').mockRejectedValue(new GatewayError('network'))

    expect((await service.start(session)).tenant.id).toBe(FAKE_TENANT)
  })

  it('needs a connection the first time a user starts on this device', async () => {
    online = false
    await expect(service.start(session)).rejects.toMatchObject({ code: 'network' })
  })

  it('does not fall back when the server denies access', async () => {
    await device.saveBootstrap(FAKE_USER, gateway.bootstrapResponse)
    vi.spyOn(gateway, 'bootstrap').mockRejectedValue(new GatewayError('accessDenied'))

    await expect(service.start(session)).rejects.toMatchObject({ code: 'accessDenied' })
  })
})

describe('DexieDeviceRepository', () => {
  it('keeps one device id across restarts', async () => {
    const id = await device.getDeviceId()
    const reopened = new DeviceDatabase({ indexedDB, IDBKeyRange })
    expect(await new DexieDeviceRepository(reopened).getDeviceId()).toBe(id)
    reopened.close()
  })
})
