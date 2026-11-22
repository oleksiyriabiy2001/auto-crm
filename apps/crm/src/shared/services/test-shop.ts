import type { Category, Id, Operation, Product, ProductBarcode, Role, StockMovement } from '@auto-crm/core'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

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
import type { ShopContext } from '@/sync/sync.service'

import { ShopAccess } from './shop-access'

// A shop on an in-memory IndexedDB for service tests. Server rows are seeded
// straight into the local tables, as a pull would write them. Test files
// importing this must `vi.mock('@/gateway')`.

export const TEST_TENANT = '0190a5d0-0000-7000-8000-00000000000a'
export const TEST_USER = '0190a5d0-0000-7000-8000-0000000000a1'
export const TEST_DEVICE = '0190a5d0-0000-7000-8000-0000000000d1'
export const TEST_NOW = '2026-11-22T10:00:00.000Z'
const SERVER_TIME = '2026-11-20T09:00:00.000Z'

// Readable fixed ids for seeded rows: `testId(1)` → ...000000000001.
export const testId = (n: number): Id => `0190a5d0-0000-7000-8000-${String(n).padStart(12, '0')}`

const synced = (id: Id) => ({
  id,
  tenantId: TEST_TENANT,
  createdAt: SERVER_TIME,
  updatedAt: SERVER_TIME,
  deletedAt: null,
  version: 2,
})

export const serverCategory = (id: Id, fields: Partial<Category> = {}): Category => ({
  ...synced(id),
  name: 'Фільтри',
  parentId: null,
  ...fields,
})

export const serverProduct = (id: Id, fields: Partial<Product> = {}): Product => ({
  ...synced(id),
  sku: null,
  name: 'Фільтр масляний',
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: 15_000,
  salePriceMinor: 25_000,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
  ...fields,
})

export const serverBarcode = (id: Id, productId: Id, barcode: string, fields: Partial<ProductBarcode> = {}): ProductBarcode => ({
  ...synced(id),
  productId,
  barcode,
  symbology: 'ean13',
  ...fields,
})

export const serverMovement = (id: Id, productId: Id, quantityDelta: number): StockMovement => ({
  ...synced(id),
  productId,
  type: quantityDelta > 0 ? 'receive' : 'sale',
  quantityDelta,
  unitCostMinor: 15_000,
  unitPriceMinor: 25_000,
  currency: 'UAH',
  note: null,
  occurredAt: SERVER_TIME,
  createdBy: TEST_USER,
  deviceId: TEST_DEVICE,
  sourceType: null,
  sourceId: null,
})

export interface TestShop {
  db: LocalDatabase
  context: ShopContext
  access: ShopAccess
  syncRequests: () => number
  signOut: () => void
  // The user's unconfirmed operations, in push order.
  outbox: () => Promise<Operation[]>
  seed: (rows: {
    categories?: Category[]
    products?: Product[]
    barcodes?: ProductBarcode[]
    movements?: StockMovement[]
  }) => Promise<void>
}

export const createTestShop = (role: Role = 'admin'): TestShop => {
  const db = new LocalDatabase(TEST_TENANT, { indexedDB: new IDBFactory(), IDBKeyRange })
  const context: ShopContext = {
    tenantId: TEST_TENANT,
    userId: TEST_USER,
    role,
    deviceId: TEST_DEVICE,
    repositories: {
      categories: new DexieCategoryRepository(db),
      products: new DexieProductRepository(db),
      barcodes: new DexieProductBarcodeRepository(db),
      movements: new DexieStockMovementRepository(db),
      outbox: new DexieOutboxRepository(db),
      syncState: new DexieSyncStateRepository(db),
    },
    transactions: new DexieTransactionRunner(db),
  }
  let open = true
  let syncRequests = 0
  // Generated ids start far above the ones tests seed.
  let nextId = 900_000
  const access = new ShopAccess({
    getContext: () => (open ? context : null),
    requestSync: () => {
      syncRequests += 1
    },
    newId: () => testId(nextId++),
    now: () => new Date(TEST_NOW),
  })

  return {
    db,
    context,
    access,
    syncRequests: () => syncRequests,
    signOut: () => {
      open = false
    },
    outbox: async () => (await context.repositories.outbox.listUnconfirmed(TEST_USER)).map((entry) => entry.operation),
    seed: async ({ categories = [], products = [], barcodes = [], movements = [] }) => {
      const { repositories } = context
      for (const row of categories) await repositories.categories.put(row)
      for (const row of products) await repositories.products.put(row)
      for (const row of barcodes) await repositories.barcodes.put(row)
      for (const row of movements) await repositories.movements.add(row)
    },
  }
}
