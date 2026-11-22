import type { Category, Product, ProductBarcode, StockMovement } from './entities'
import type { Operation } from './operations'
import type { Id } from './primitives'
import type { BootstrapResponse, Cursor, RejectReason } from './sync'

// Local database interfaces. Implementations live in the app (Dexie), so
// services never touch storage or the network directly. Rows are stored as
// they arrive, tombstones included: callers filter on `deletedAt`.

// Runs `work` atomically: every repository call inside it commits together or
// not at all, so a local change is never saved without its outbox entry.
// Await only repository calls inside `work`, never the network.
export interface TransactionRunner {
  run: <T>(work: () => Promise<T>) => Promise<T>
}

export interface CategoryRepository {
  get: (id: Id) => Promise<Category | undefined>
  list: () => Promise<Category[]>
  put: (category: Category) => Promise<void>
}

export interface ProductRepository {
  get: (id: Id) => Promise<Product | undefined>
  list: () => Promise<Product[]>
  put: (product: Product) => Promise<void>
}

export interface ProductBarcodeRepository {
  // The live (not removed) barcode row, if any.
  findByBarcode: (barcode: string) => Promise<ProductBarcode | undefined>
  listByProduct: (productId: Id) => Promise<ProductBarcode[]>
  put: (barcode: ProductBarcode) => Promise<void>
}

// Append-only: there is no update or delete.
export interface StockMovementRepository {
  listByProduct: (productId: Id) => Promise<StockMovement[]>
  // Ignores a movement whose id is already stored, so a pull that returns
  // the device's own movement never counts it twice.
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

// Where the next pull starts. Null before the first pull.
export interface SyncStateRepository {
  getCursor: () => Promise<Cursor | null>
  setCursor: (cursor: Cursor) => Promise<void>
}

// Device-level storage, shared by every shop signed in on the device.
export interface DeviceRepository {
  // Generated on first use, then the same forever. Sent on every operation.
  getDeviceId: () => Promise<Id>
  // The last bootstrap per user, so an offline start knows the shop and role.
  saveBootstrap: (userId: Id, bootstrap: BootstrapResponse) => Promise<void>
  getBootstrap: (userId: Id) => Promise<BootstrapResponse | undefined>
}
