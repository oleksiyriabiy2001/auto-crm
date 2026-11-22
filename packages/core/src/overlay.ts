import type { Category, Product, ProductBarcode, StockMovement } from './entities'
import type { Operation } from './operations'
import type { Id } from './primitives'

// The screen shows the server's rows with the user's unconfirmed outbox
// operations (pending and accepted, in push order) replayed on top. Rejected
// and discarded operations are never passed in, so their changes vanish.
//
// Accepted operations stay in the outbox until the pull that brings their rows
// back has finished, so while a pull is under way the server's row may already
// be local. Replay must not apply such an operation twice: creates and
// movements are skipped when their row exists, and updates, deletes and
// restores give the same result when repeated.

// `pending`: an unconfirmed operation touched the row ("not synced yet").
export type Overlaid<T> = T & { pending: boolean }

export interface CatalogRows {
  categories: readonly Category[]
  products: readonly Product[]
  barcodes: readonly ProductBarcode[]
}

export interface OverlaidCatalog {
  categories: Overlaid<Category>[]
  products: Overlaid<Product>[]
  barcodes: Overlaid<ProductBarcode>[]
}

// Who the replayed operations belong to: the outbox holds only the signed-in
// user's operations for one shop.
export interface ReplayContext {
  tenantId: Id
  userId: Id
}

type Row = Category | Product | ProductBarcode

// The synced columns of a row that exists only on this device so far.
// Version 1 is what the server gives a new row.
const newRow = (id: Id, operation: Operation, { tenantId }: ReplayContext) => ({
  id,
  tenantId,
  createdAt: operation.clientTimestamp,
  updatedAt: operation.clientTimestamp,
  deletedAt: null,
  version: 1,
})

class Table<T extends Row> {
  private readonly rows: Map<Id, Overlaid<T>>

  constructor(rows: readonly T[]) {
    this.rows = new Map(rows.map((row) => [row.id, { ...row, pending: false }]))
  }

  create(row: T): void {
    if (!this.rows.has(row.id)) this.rows.set(row.id, { ...row, pending: true })
  }

  // A row missing here was never created, or its create was rejected: the
  // operation will be rejected too, so there is nothing to show. zod's
  // `partial()` lets a field be `undefined`, which means unchanged.
  change(id: Id, changes: { [K in keyof T]?: T[K] | undefined }): void {
    const row = this.rows.get(id)
    if (!row) return
    const defined = Object.entries(changes).filter(([, value]) => value !== undefined)
    this.rows.set(id, { ...row, ...Object.fromEntries(defined), pending: true })
  }

  toArray(): Overlaid<T>[] {
    return [...this.rows.values()]
  }
}

export const replayCatalog = (
  rows: CatalogRows,
  operations: readonly Operation[],
  context: ReplayContext,
): OverlaidCatalog => {
  const categories = new Table(rows.categories)
  const products = new Table(rows.products)
  const barcodes = new Table(rows.barcodes)

  for (const operation of operations) {
    const at = operation.clientTimestamp
    switch (operation.type) {
      case 'category.create': {
        const { id, ...fields } = operation.payload
        categories.create({ ...newRow(id, operation, context), ...fields })
        break
      }
      case 'category.update':
        categories.change(operation.payload.id, { ...operation.payload.changes, updatedAt: at })
        break
      case 'category.delete':
        categories.change(operation.payload.id, { deletedAt: at, updatedAt: at })
        break
      case 'category.restore':
        categories.change(operation.payload.id, { deletedAt: null, updatedAt: at })
        break
      case 'product.create': {
        const { id, barcodes: productBarcodes, ...fields } = operation.payload
        products.create({ ...newRow(id, operation, context), ...fields })
        for (const { id: barcodeId, ...barcode } of productBarcodes) {
          barcodes.create({ ...newRow(barcodeId, operation, context), productId: id, ...barcode })
        }
        break
      }
      case 'product.update':
        products.change(operation.payload.id, { ...operation.payload.changes, updatedAt: at })
        break
      case 'product.delete':
        products.change(operation.payload.id, { deletedAt: at, updatedAt: at })
        break
      case 'product.restore':
        products.change(operation.payload.id, { deletedAt: null, updatedAt: at })
        break
      case 'barcode.add': {
        const { id, ...fields } = operation.payload
        barcodes.create({ ...newRow(id, operation, context), ...fields })
        break
      }
      case 'barcode.remove':
        barcodes.change(operation.payload.id, { deletedAt: at, updatedAt: at })
        break
      case 'stock.move':
        break
    }
  }

  return { categories: categories.toArray(), products: products.toArray(), barcodes: barcodes.toArray() }
}

// The user's movements the local ledger does not hold yet. `knownIds` are the
// operations' movement ids already in the ledger; those are skipped so a
// movement is never counted twice.
export const pendingMovements = (
  operations: readonly Operation[],
  knownIds: ReadonlySet<Id>,
  context: ReplayContext,
): Overlaid<StockMovement>[] => {
  const movements: Overlaid<StockMovement>[] = []
  for (const operation of operations) {
    if (operation.type !== 'stock.move' || knownIds.has(operation.payload.id)) continue
    const { id, ...fields } = operation.payload
    movements.push({
      ...newRow(id, operation, context),
      ...fields,
      createdBy: context.userId,
      deviceId: operation.deviceId,
      sourceType: null,
      sourceId: null,
      pending: true,
    })
  }
  return movements
}
