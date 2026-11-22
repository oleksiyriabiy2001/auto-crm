import { describe, expect, it } from 'vitest'
import type { Category, Product, ProductBarcode } from './entities'
import type { Operation } from './operations'
import type { CatalogRows } from './overlay'
import { pendingMovements, replayCatalog } from './overlay'

const context = {
  tenantId: '01890a5d-ac96-774b-bcce-b30209900001',
  userId: '01890a5d-ac96-774b-bcce-b30209900002',
}
const deviceId = '01890a5d-ac96-774b-bcce-b30209900003'
const serverTime = '2026-11-20T09:00:00Z'
const at = '2026-11-21T10:00:00Z'

// Readable ids: `uuid(7)` → ...000000000007.
const uuid = (n: number): string => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`

const synced = (id: string) => ({
  id,
  tenantId: context.tenantId,
  createdAt: serverTime,
  updatedAt: serverTime,
  deletedAt: null,
  version: 3,
})

const productFields = {
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
} as const

const category = (id: string, fields: Partial<Category> = {}): Category => ({
  ...synced(id),
  name: 'Фільтри',
  parentId: null,
  ...fields,
})
const product = (id: string, fields: Partial<Product> = {}): Product => ({
  ...synced(id),
  ...productFields,
  ...fields,
})
const barcode = (id: string, productId: string, code: string): ProductBarcode => ({
  ...synced(id),
  productId,
  barcode: code,
  symbology: 'ean13',
})

let nextOperation = 1000
const op = <T extends Operation['type']>(
  type: T,
  payload: Extract<Operation, { type: T }>['payload'],
  baseVersion?: number,
): Operation => ({
  id: uuid(nextOperation++),
  clientTimestamp: at,
  deviceId,
  type,
  payload,
  ...(baseVersion === undefined ? {} : { baseVersion }),
}) as Operation

const empty: CatalogRows = { categories: [], products: [], barcodes: [] }

describe('replayCatalog', () => {
  it('returns the server rows unchanged and not pending without operations', () => {
    const rows = { categories: [category(uuid(1))], products: [product(uuid(2))], barcodes: [barcode(uuid(3), uuid(2), '4820000000001')] }
    const result = replayCatalog(rows, [], context)
    expect(result.categories).toStrictEqual([{ ...rows.categories[0], pending: false }])
    expect(result.products).toStrictEqual([{ ...rows.products[0], pending: false }])
    expect(result.barcodes).toStrictEqual([{ ...rows.barcodes[0], pending: false }])
  })

  it('adds a created category as a new pending row', () => {
    const result = replayCatalog(empty, [op('category.create', { id: uuid(1), name: 'Оливи', parentId: null })], context)
    expect(result.categories).toStrictEqual([{
      id: uuid(1),
      tenantId: context.tenantId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      version: 1,
      name: 'Оливи',
      parentId: null,
      pending: true,
    }])
  })

  it('adds a created product and its barcodes', () => {
    const result = replayCatalog(empty, [op('product.create', {
      id: uuid(1),
      ...productFields,
      barcodes: [{ id: uuid(2), barcode: '4820000000001', symbology: 'ean13' }],
    })], context)
    expect(result.products).toStrictEqual([{ ...product(uuid(1)), createdAt: at, updatedAt: at, version: 1, pending: true }])
    expect(result.barcodes).toStrictEqual([{ ...barcode(uuid(2), uuid(1), '4820000000001'), createdAt: at, updatedAt: at, version: 1, pending: true }])
  })

  it('merges only the changed fields of an update and keeps the version', () => {
    const rows = { ...empty, products: [product(uuid(1))], categories: [category(uuid(2))] }
    const result = replayCatalog(rows, [
      op('product.update', { id: uuid(1), changes: { name: 'Фільтр повітряний', salePriceMinor: 30_000 } }, 3),
      op('category.update', { id: uuid(2), changes: { parentId: null, name: 'Оливи' } }, 3),
    ], context)
    expect(result.products).toStrictEqual([{ ...product(uuid(1)), name: 'Фільтр повітряний', salePriceMinor: 30_000, updatedAt: at, pending: true }])
    expect(result.categories).toStrictEqual([{ ...category(uuid(2)), name: 'Оливи', updatedAt: at, pending: true }])
  })

  it('soft-deletes and restores categories and products', () => {
    const rows = {
      ...empty,
      categories: [category(uuid(1)), category(uuid(2), { deletedAt: serverTime })],
      products: [product(uuid(3)), product(uuid(4), { deletedAt: serverTime })],
    }
    const result = replayCatalog(rows, [
      op('category.delete', { id: uuid(1) }, 3),
      op('category.restore', { id: uuid(2) }, 3),
      op('product.delete', { id: uuid(3) }, 3),
      op('product.restore', { id: uuid(4) }, 3),
    ], context)
    expect(result.categories.map((row) => [row.deletedAt, row.pending])).toStrictEqual([[at, true], [null, true]])
    expect(result.products.map((row) => [row.deletedAt, row.pending])).toStrictEqual([[at, true], [null, true]])
  })

  it('adds and removes barcodes', () => {
    const rows = { ...empty, products: [product(uuid(1))], barcodes: [barcode(uuid(2), uuid(1), '4820000000001')] }
    const result = replayCatalog(rows, [
      op('barcode.remove', { id: uuid(2) }),
      op('barcode.add', { id: uuid(3), productId: uuid(1), barcode: '4820000000002', symbology: null }),
    ], context)
    expect(result.barcodes).toStrictEqual([
      { ...barcode(uuid(2), uuid(1), '4820000000001'), deletedAt: at, updatedAt: at, pending: true },
      { ...synced(uuid(3)), createdAt: at, updatedAt: at, version: 1, productId: uuid(1), barcode: '4820000000002', symbology: null, pending: true },
    ])
  })

  it('applies operations in order: a row created and edited on this device', () => {
    const result = replayCatalog(empty, [
      op('product.create', { id: uuid(1), ...productFields, barcodes: [] }),
      op('product.update', { id: uuid(1), changes: { name: 'Свічка запалювання' } }, 1),
      op('product.delete', { id: uuid(1) }, 1),
    ], context)
    expect(result.products).toStrictEqual([expect.objectContaining({ name: 'Свічка запалювання', deletedAt: at, pending: true })])
  })

  it('ignores edits of a row that does not exist (its create was rejected)', () => {
    const result = replayCatalog(empty, [
      op('product.update', { id: uuid(1), changes: { name: 'Нове' } }, 1),
      op('category.delete', { id: uuid(2) }, 1),
      op('barcode.remove', { id: uuid(3) }),
    ], context)
    expect(result).toStrictEqual({ categories: [], products: [], barcodes: [] })
  })

  it('does not let a create overwrite the server row when a pull already brought it back', () => {
    // The server row was edited on another device after the create.
    const rows = {
      categories: [category(uuid(1), { name: 'Мастила' })],
      products: [product(uuid(2), { name: 'Змінено іншим' })],
      barcodes: [barcode(uuid(3), uuid(2), '4820000000001')],
    }
    const result = replayCatalog(rows, [
      op('category.create', { id: uuid(1), name: 'Оливи', parentId: null }),
      op('product.create', { id: uuid(2), ...productFields, barcodes: [{ id: uuid(3), barcode: '4820000000009', symbology: null }] }),
      op('barcode.add', { id: uuid(3), productId: uuid(2), barcode: '4820000000009', symbology: null }),
    ], context)
    expect(result.categories[0]?.name).toBe('Мастила')
    expect(result.products[0]?.name).toBe('Змінено іншим')
    expect(result.barcodes.map((row) => row.barcode)).toStrictEqual(['4820000000001'])
  })

  it('gives the same result when an update, delete or restore is replayed on its own server row', () => {
    const operations = [
      op('product.update', { id: uuid(1), changes: { name: 'Фільтр повітряний' } }, 3),
      op('product.delete', { id: uuid(1) }, 3),
    ]
    const before = replayCatalog({ ...empty, products: [product(uuid(1))] }, operations, context)
    const pulled = { ...empty, products: [product(uuid(1), { name: 'Фільтр повітряний', deletedAt: at, updatedAt: at })] }
    const after = replayCatalog(pulled, operations, context)
    expect(after.products).toStrictEqual(before.products)
  })

  it('treats an undefined field in the changes as unchanged', () => {
    const rows = { ...empty, products: [product(uuid(1))] }
    const result = replayCatalog(rows, [op('product.update', { id: uuid(1), changes: { name: undefined, salePriceMinor: 1 } }, 3)], context)
    expect(result.products[0]?.name).toBe('Фільтр масляний')
  })

  it('does not change the input rows', () => {
    const rows = { ...empty, products: [product(uuid(1))] }
    replayCatalog(rows, [op('product.update', { id: uuid(1), changes: { name: 'Нове' } }, 3)], context)
    expect(rows.products[0]?.name).toBe('Фільтр масляний')
  })
})

describe('pendingMovements', () => {
  const move = (id: string, quantityDelta: number) => op('stock.move', {
    id,
    productId: uuid(1),
    type: quantityDelta > 0 ? 'receive' : 'sale',
    quantityDelta,
    unitCostMinor: 15_000,
    unitPriceMinor: 25_000,
    currency: 'UAH',
    note: null,
    occurredAt: at,
  })

  it('turns stock.move operations into pending ledger rows', () => {
    const result = pendingMovements([move(uuid(10), 5)], new Set(), context)
    expect(result).toStrictEqual([{
      id: uuid(10),
      tenantId: context.tenantId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      version: 1,
      productId: uuid(1),
      type: 'receive',
      quantityDelta: 5,
      unitCostMinor: 15_000,
      unitPriceMinor: 25_000,
      currency: 'UAH',
      note: null,
      occurredAt: at,
      createdBy: context.userId,
      deviceId,
      sourceType: null,
      sourceId: null,
      pending: true,
    }])
  })

  it('skips movements the ledger already holds, so none is counted twice', () => {
    const result = pendingMovements([move(uuid(10), 5), move(uuid(11), -2)], new Set([uuid(10)]), context)
    expect(result.map((row) => row.id)).toStrictEqual([uuid(11)])
  })

  it('ignores other operation types', () => {
    const result = pendingMovements([op('product.delete', { id: uuid(1) }, 3), move(uuid(10), -1)], new Set(), context)
    expect(result.map((row) => row.quantityDelta)).toStrictEqual([-1])
  })
})
