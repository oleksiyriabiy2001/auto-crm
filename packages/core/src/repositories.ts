import type { Product, ProductBarcode, StockMovement } from './entities'
import type { Operation } from './operations'
import type { Id } from './primitives'
import type { RejectReason } from './sync'

// Local database interfaces. Implementations live in the app (Dexie), so
// services never touch storage or the network directly.

export interface ProductRepository {
  get: (id: Id) => Promise<Product | undefined>
  list: () => Promise<Product[]>
  put: (product: Product) => Promise<void>
}

export interface ProductBarcodeRepository {
  findByBarcode: (barcode: string) => Promise<ProductBarcode | undefined>
  listByProduct: (productId: Id) => Promise<ProductBarcode[]>
  put: (barcode: ProductBarcode) => Promise<void>
}

// Append-only: there is no update or delete.
export interface StockMovementRepository {
  listByProduct: (productId: Id) => Promise<StockMovement[]>
  add: (movement: StockMovement) => Promise<void>
  // Current quantity from the incrementally updated local cache.
  getQuantity: (productId: Id) => Promise<number>
}

export type OutboxEntry
  = | { operation: Operation, userId: Id, status: 'pending' }
    | { operation: Operation, userId: Id, status: 'rejected', reason: RejectReason }

export interface OutboxRepository {
  add: (entry: OutboxEntry) => Promise<void>
  // In the order they were added: the sync engine pushes them in this order.
  listPending: (userId: Id) => Promise<OutboxEntry[]>
  // The "needs attention" list.
  listRejected: (userId: Id) => Promise<OutboxEntry[]>
  markRejected: (operationId: Id, reason: RejectReason) => Promise<void>
  remove: (operationId: Id) => Promise<void>
}
