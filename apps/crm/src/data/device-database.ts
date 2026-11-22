import type { BootstrapResponse, DeviceRepository, Id } from '@auto-crm/core'
import type { DexieOptions, EntityTable } from 'dexie'
import { Dexie } from 'dexie'

interface DeviceRow {
  key: 'deviceId'
  value: Id
}

interface BootstrapRow {
  userId: Id
  bootstrap: BootstrapResponse
}

// What the device keeps outside any one shop's database: its own id, and who
// signed in to which shop, so an offline start can open the right one.
export class DeviceDatabase extends Dexie {
  device!: EntityTable<DeviceRow, 'key'>
  bootstraps!: EntityTable<BootstrapRow, 'userId'>

  // `options` lets tests pass an in-memory IndexedDB.
  constructor(options?: DexieOptions) {
    super('auto-crm-device', options)
    this.version(1).stores({
      device: 'key',
      bootstraps: 'userId',
    })
  }
}

export class DexieDeviceRepository implements DeviceRepository {
  constructor(private readonly db: DeviceDatabase) {}

  // In one transaction, so two tabs opening at once agree on one id.
  getDeviceId(): Promise<Id> {
    return this.db.transaction('rw', this.db.device, async () => {
      const existing = await this.db.device.get('deviceId')
      if (existing) return existing.value
      const value = crypto.randomUUID()
      await this.db.device.add({ key: 'deviceId', value })
      return value
    })
  }

  async saveBootstrap(userId: Id, bootstrap: BootstrapResponse): Promise<void> {
    await this.db.bootstraps.put({ userId, bootstrap })
  }

  async getBootstrap(userId: Id): Promise<BootstrapResponse | undefined> {
    return (await this.db.bootstraps.get(userId))?.bootstrap
  }
}
