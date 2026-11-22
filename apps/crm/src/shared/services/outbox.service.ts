import type { Id, Operation, OverlaidCatalog, RejectReason } from '@auto-crm/core'

import type { ShopAccess } from './shop-access'
import { shopAccess } from './shop-access'

// A change the server refused (SYN-2), with what it was about so the user can
// recognise it: the product or category name, and the barcode for barcode
// changes. Names come from the current data, or from the change itself when
// it created the row.
export interface AttentionItem {
  operation: Operation
  reason: RejectReason
  name: string | null
  barcode: string | null
}

const productName = (catalog: OverlaidCatalog, id: Id): string | null =>
  catalog.products.find((row) => row.id === id)?.name ?? null

const categoryName = (catalog: OverlaidCatalog, id: Id): string | null =>
  catalog.categories.find((row) => row.id === id)?.name ?? null

const describe = (operation: Operation, catalog: OverlaidCatalog): Pick<AttentionItem, 'name' | 'barcode'> => {
  switch (operation.type) {
    case 'category.create':
      return { name: operation.payload.name, barcode: null }
    case 'category.update':
      return { name: categoryName(catalog, operation.payload.id) ?? operation.payload.changes.name ?? null, barcode: null }
    case 'category.delete':
    case 'category.restore':
      return { name: categoryName(catalog, operation.payload.id), barcode: null }
    case 'product.create':
      return { name: operation.payload.name, barcode: null }
    case 'product.update':
    case 'product.delete':
    case 'product.restore':
      return { name: productName(catalog, operation.payload.id), barcode: null }
    case 'barcode.add':
      return { name: productName(catalog, operation.payload.productId), barcode: operation.payload.barcode }
    case 'barcode.remove': {
      const row = catalog.barcodes.find((barcode) => barcode.id === operation.payload.id)
      return { name: row ? productName(catalog, row.productId) : null, barcode: row?.barcode ?? null }
    }
    case 'stock.move':
      return { name: productName(catalog, operation.payload.productId), barcode: null }
  }
}

// The "needs attention" list: the user's refused changes, to retry or discard.
export class OutboxService {
  constructor(private readonly shop: ShopAccess) {}

  // Oldest first, in the order they were made.
  async listRejected(): Promise<AttentionItem[]> {
    const context = this.shop.context()
    const [rejected, unconfirmed] = await Promise.all([
      context.repositories.outbox.listRejected(context.userId),
      this.shop.unconfirmed(context),
    ])
    const catalog = await this.shop.catalog(context, unconfirmed)
    return rejected.flatMap((entry) => (entry.status === 'rejected'
      ? [{ operation: entry.operation, reason: entry.reason, ...describe(entry.operation, catalog) }]
      : []))
  }

  // Sends the change again, e.g. after the conflicting barcode was removed. If
  // the server refuses it again, it comes back to this list.
  async retry(operationId: Id): Promise<void> {
    const context = this.shop.context()
    await context.repositories.outbox.markPending(operationId)
    this.shop.requestSync()
  }

  // Drops the change for good. It was never applied, so nothing is left behind.
  // The sync request refreshes the counts in the status indicator.
  async discard(operationId: Id): Promise<void> {
    await this.shop.context().repositories.outbox.remove(operationId)
    this.shop.requestSync()
  }
}

export const outboxService = new OutboxService(shopAccess)
