import type {
  Category,
  CategoryRepository,
  Cursor,
  Id,
  OutboxEntry,
  OutboxRepository,
  Product,
  ProductBarcode,
  ProductBarcodeRepository,
  ProductRepository,
  RejectReason,
  StockMovement,
  StockMovementRepository,
  SyncStateRepository,
  TransactionRunner,
  UtcTimestamp,
} from '@auto-crm/core'
import { sumStock } from '@auto-crm/core'

import type { LocalDatabase, OutboxRow } from './local-database'

// The core repository interfaces on Dexie. A call made inside
// DexieTransactionRunner.run joins its transaction; outside it, each call
// commits on its own.

export class DexieTransactionRunner implements TransactionRunner {
  constructor(private readonly db: LocalDatabase) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.db.tables, work)
  }
}

export class DexieCategoryRepository implements CategoryRepository {
  constructor(private readonly db: LocalDatabase) {}

  get(id: Id): Promise<Category | undefined> {
    return this.db.categories.get(id)
  }

  list(): Promise<Category[]> {
    return this.db.categories.toArray()
  }

  async put(category: Category): Promise<void> {
    await this.db.categories.put(category)
  }
}

export class DexieProductRepository implements ProductRepository {
  constructor(private readonly db: LocalDatabase) {}

  get(id: Id): Promise<Product | undefined> {
    return this.db.products.get(id)
  }

  list(): Promise<Product[]> {
    return this.db.products.toArray()
  }

  async put(product: Product): Promise<void> {
    await this.db.products.put(product)
  }
}

export class DexieProductBarcodeRepository implements ProductBarcodeRepository {
  constructor(private readonly db: LocalDatabase) {}

  findByBarcode(barcode: string): Promise<ProductBarcode | undefined> {
    return this.db.productBarcodes
      .where('barcode')
      .equals(barcode)
      .filter((row) => row.deletedAt === null)
      .first()
  }

  listByProduct(productId: Id): Promise<ProductBarcode[]> {
    return this.db.productBarcodes.where('productId').equals(productId).toArray()
  }

  async put(barcode: ProductBarcode): Promise<void> {
    await this.db.productBarcodes.put(barcode)
  }
}

export class DexieStockMovementRepository implements StockMovementRepository {
  constructor(private readonly db: LocalDatabase) {}

  listByProduct(productId: Id): Promise<StockMovement[]> {
    return this.db.stockMovements.where('productId').equals(productId).toArray()
  }

  // The movement and the stock cache change in one transaction, so the cache
  // always equals the sum of the stored movements.
  add(movement: StockMovement): Promise<void> {
    const { stockMovements, stockLevels } = this.db
    return this.db.transaction('rw', stockMovements, stockLevels, async () => {
      if (await stockMovements.get(movement.id)) return
      await stockMovements.add(movement)
      const level = await stockLevels.get(movement.productId)
      await stockLevels.put({
        productId: movement.productId,
        quantity: sumStock([{ quantityDelta: level?.quantity ?? 0 }, movement]),
      })
    })
  }

  async getQuantity(productId: Id): Promise<number> {
    return (await this.db.stockLevels.get(productId))?.quantity ?? 0
  }
}

const toEntry = (row: OutboxRow): OutboxEntry => {
  const { operation, userId } = row
  return row.status === 'rejected'
    ? { operation, userId, status: 'rejected', reason: row.reason }
    : { operation, userId, status: row.status }
}

export class DexieOutboxRepository implements OutboxRepository {
  constructor(private readonly db: LocalDatabase) {}

  async add(entry: OutboxEntry): Promise<void> {
    await this.db.outbox.add({ ...entry, operationId: entry.operation.id })
  }

  // Rows with one [userId+status] come back in primary key order: `seq`,
  // the order they were added.
  async listPending(userId: Id): Promise<OutboxEntry[]> {
    return (await this.db.outbox.where('[userId+status]').equals([userId, 'pending']).toArray()).map(toEntry)
  }

  // Two index keys come back grouped by key, so sort by `seq` to restore the
  // order they were added.
  async listUnconfirmed(userId: Id): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox
      .where('[userId+status]')
      .anyOf([[userId, 'pending'], [userId, 'accepted']])
      .sortBy('seq')
    return rows.map(toEntry)
  }

  async listRejected(userId: Id): Promise<OutboxEntry[]> {
    return (await this.db.outbox.where('[userId+status]').equals([userId, 'rejected']).toArray()).map(toEntry)
  }

  async markAccepted(operationIds: readonly Id[]): Promise<void> {
    await this.db.outbox.where('operationId').anyOf(operationIds).modify((row) => {
      Object.assign(row, { status: 'accepted' })
    })
  }

  async markRejected(operationId: Id, reason: RejectReason): Promise<void> {
    await this.db.outbox.where('operationId').equals(operationId).modify((row) => {
      Object.assign(row, { status: 'rejected', reason })
    })
  }

  async removeAccepted(userId: Id): Promise<void> {
    await this.db.outbox.where('[userId+status]').equals([userId, 'accepted']).delete()
  }

  async remove(operationId: Id): Promise<void> {
    await this.db.outbox.where('operationId').equals(operationId).delete()
  }
}

export class DexieSyncStateRepository implements SyncStateRepository {
  constructor(private readonly db: LocalDatabase) {}

  async getCursor(): Promise<Cursor | null> {
    return (await this.db.syncState.get('cursor'))?.value ?? null
  }

  async setCursor(cursor: Cursor): Promise<void> {
    await this.db.syncState.put({ key: 'cursor', value: cursor })
  }

  async getLastSyncedAt(): Promise<UtcTimestamp | null> {
    return (await this.db.syncState.get('lastSyncedAt'))?.value ?? null
  }

  async setLastSyncedAt(at: UtcTimestamp): Promise<void> {
    await this.db.syncState.put({ key: 'lastSyncedAt', value: at })
  }
}
