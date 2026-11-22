import type {
  Category,
  Cursor,
  Id,
  OutboxEntry,
  Product,
  ProductBarcode,
  StockMovement,
  UtcTimestamp,
} from '@auto-crm/core'
import type { DexieOptions, EntityTable } from 'dexie'
import { Dexie } from 'dexie'

// `seq` keeps the push order; `operationId` lets the server's answer find
// the entry.
export type OutboxRow = OutboxEntry & { seq?: number, operationId: Id }

// The incrementally updated stock cache: the sum of a product's movements.
export interface StockLevelRow {
  productId: Id
  quantity: number
}

export type SyncStateRow
  = | { key: 'cursor', value: Cursor }
    | { key: 'lastSyncedAt', value: UtcTimestamp }

// The device's copy of one shop. Each shop gets its own database, so data
// from two shops signed in on one device never mixes.
//
// IndexedDB cannot index booleans or null, so `deletedAt` and `isActive`
// are filtered in code, not by index.
export class LocalDatabase extends Dexie {
  categories!: EntityTable<Category, 'id'>
  products!: EntityTable<Product, 'id'>
  productBarcodes!: EntityTable<ProductBarcode, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>
  stockLevels!: EntityTable<StockLevelRow, 'productId'>
  outbox!: EntityTable<OutboxRow, 'seq'>
  syncState!: EntityTable<SyncStateRow, 'key'>

  // `options` lets tests pass an in-memory IndexedDB.
  constructor(tenantId: Id, options?: DexieOptions) {
    super(`auto-crm-${tenantId}`, options)
    this.version(1).stores({
      categories: 'id',
      products: 'id',
      productBarcodes: 'id, barcode, productId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      outbox: '++seq, &operationId, [userId+status]',
      syncState: 'key',
    })
  }
}
