import type { Id, Overlaid, OverlaidCatalog, Product, ProductBarcode, ProductFields, StockMovement } from '@auto-crm/core'
import { BarcodeFieldsSchema, isLowStock, isNegativeStock, ProductFieldsSchema, sumStock } from '@auto-crm/core'
import { z } from 'zod'

import { ServiceError } from './service-error'
import type { ShopAccess } from './shop-access'
import { shopAccess } from './shop-access'

const ProductInputSchema = ProductFieldsSchema.extend({ barcodes: z.array(BarcodeFieldsSchema) })
export type ProductInput = z.input<typeof ProductInputSchema>
export type ProductChanges = Partial<z.input<typeof ProductFieldsSchema>>
export type BarcodeInput = z.input<typeof BarcodeFieldsSchema>

// A product as the screens show it: unsynced changes applied, with its stock.
// Quantity includes the user's movements not confirmed yet. Negative stock is
// flagged, never refused.
export type ProductView = Overlaid<Product> & {
  barcodes: string[] // live codes, for search
  quantity: number
  isLowStock: boolean
  isNegativeStock: boolean
}

export interface ProductDetail {
  product: ProductView
  barcodes: Overlaid<ProductBarcode>[] // live ones
  movements: (StockMovement & { pending: boolean })[] // newest first
}

const byName = (a: Product, b: Product): number => a.name.localeCompare(b.name, 'uk')

const findProduct = (catalog: OverlaidCatalog, id: Id): Overlaid<Product> => {
  const product = catalog.products.find((row) => row.id === id)
  if (!product) throw new ServiceError('notFound')
  return product
}

const findLiveBarcode = (catalog: OverlaidCatalog, code: string): Overlaid<ProductBarcode> | undefined =>
  catalog.barcodes.find((row) => row.barcode === code && row.deletedAt === null)

// The server keeps SKUs unique across all products, deleted ones included,
// so a restore can never collide.
const checkSku = (catalog: OverlaidCatalog, sku: string | null, productId: Id): void => {
  if (sku !== null && catalog.products.some((row) => row.sku === sku && row.id !== productId)) {
    throw new ServiceError('skuInUse')
  }
}

const checkCategory = (catalog: OverlaidCatalog, categoryId: Id | null): void => {
  if (categoryId !== null && !catalog.categories.some((row) => row.id === categoryId)) {
    throw new ServiceError('notFound')
  }
}

const checkBarcodesFree = (catalog: OverlaidCatalog, codes: readonly string[]): void => {
  if (new Set(codes).size !== codes.length || codes.some((code) => findLiveBarcode(catalog, code))) {
    throw new ServiceError('barcodeInUse')
  }
}

// Product and barcode use cases. Writes go to the outbox; reads show the
// server's rows with the user's unsynced changes on top.
export class ProductService {
  constructor(private readonly shop: ShopAccess) {}

  // Live products, by name.
  async list(): Promise<ProductView[]> {
    return (await this.load()).views.filter((row) => row.deletedAt === null)
  }

  // Deleted products an admin can restore, by name.
  async listDeleted(): Promise<ProductView[]> {
    return (await this.load()).views.filter((row) => row.deletedAt !== null)
  }

  // A product with its live barcodes and full movement history, deleted
  // products included.
  async get(id: Id): Promise<ProductDetail | undefined> {
    const context = this.shop.context()
    const operations = await this.shop.unconfirmed(context)
    const catalog = await this.shop.catalog(context, operations)
    const product = catalog.products.find((row) => row.id === id)
    if (!product) return undefined

    const pending = (await this.shop.pendingMovements(context, operations)).filter((row) => row.productId === id)
    const stored = await context.repositories.movements.listByProduct(id)
    const movements = [...stored.map((row) => ({ ...row, pending: false })), ...pending]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    const barcodes = catalog.barcodes.filter((row) => row.productId === id && row.deletedAt === null)
    return {
      product: this.toView(product, sumStock(movements), barcodes.map((row) => row.barcode)),
      barcodes,
      movements,
    }
  }

  // The live product a scanned code belongs to. Deleted products do not
  // turn up in scans.
  async findByBarcode(code: string): Promise<ProductView | undefined> {
    const { catalog, views } = await this.load()
    const barcode = findLiveBarcode(catalog, code.trim())
    return views.find((row) => row.id === barcode?.productId && row.deletedAt === null)
  }

  // Creates a product with its barcodes in one operation. Returns its id.
  async create(input: ProductInput): Promise<Id> {
    const { barcodes, ...fields } = this.shop.parse(ProductInputSchema, input)
    const id = this.shop.newId()
    const withIds = barcodes.map((barcode) => ({ id: this.shop.newId(), ...barcode }))
    await this.shop.submit((_context, catalog) => {
      checkSku(catalog, fields.sku, id)
      checkCategory(catalog, fields.categoryId)
      checkBarcodesFree(catalog, barcodes.map((barcode) => barcode.barcode))
      return { type: 'product.create', payload: { id, ...fields, barcodes: withIds } }
    })
    return id
  }

  // Sends only the fields that change; an edit that changes nothing adds no
  // operation.
  async update(id: Id, input: ProductChanges): Promise<void> {
    const changes = this.shop.parse(ProductFieldsSchema.partial(), input)
    await this.shop.submit((_context, catalog) => {
      const product = findProduct(catalog, id)
      // zod's `partial()` keeps a key given as `undefined`, which means unchanged.
      const entries = Object.entries(changes as Record<string, unknown>)
      const changed: Partial<ProductFields> = Object.fromEntries(
        entries.filter(([key, value]) => value !== undefined && value !== product[key as keyof ProductFields]),
      )
      if (Object.keys(changed).length === 0) return null
      if (changed.sku !== undefined) checkSku(catalog, changed.sku, id)
      if (changed.categoryId !== undefined) checkCategory(catalog, changed.categoryId)
      return { type: 'product.update', baseVersion: product.version, payload: { id, changes: changed } }
    })
  }

  // Deleted products leave lists and scans but stay in history. Deleting a
  // deleted product changes nothing.
  async delete(id: Id): Promise<void> {
    await this.shop.submit((_context, catalog) => {
      const product = findProduct(catalog, id)
      if (product.deletedAt !== null) return null
      return { type: 'product.delete', baseVersion: product.version, payload: { id } }
    })
  }

  // Restoring a live product changes nothing.
  async restore(id: Id): Promise<void> {
    await this.shop.submit((_context, catalog) => {
      const product = findProduct(catalog, id)
      if (product.deletedAt === null) return null
      return { type: 'product.restore', baseVersion: product.version, payload: { id } }
    })
  }

  // Attaches a barcode to a live product. Returns the barcode's id.
  async addBarcode(productId: Id, input: BarcodeInput): Promise<Id> {
    const fields = this.shop.parse(BarcodeFieldsSchema, input)
    const id = this.shop.newId()
    await this.shop.submit((_context, catalog) => {
      if (findProduct(catalog, productId).deletedAt !== null) throw new ServiceError('notFound')
      checkBarcodesFree(catalog, [fields.barcode])
      return { type: 'barcode.add', payload: { id, productId, ...fields } }
    })
    return id
  }

  async removeBarcode(barcodeId: Id): Promise<void> {
    await this.shop.submit((_context, catalog) => {
      const barcode = catalog.barcodes.find((row) => row.id === barcodeId)
      if (barcode?.deletedAt !== null) throw new ServiceError('notFound')
      return { type: 'barcode.remove', payload: { id: barcodeId } }
    })
  }

  // Every product, by name, with its quantity: the cached sum of the stored
  // movements plus the user's movements not stored yet.
  private async load(): Promise<{ catalog: OverlaidCatalog, views: ProductView[] }> {
    const context = this.shop.context()
    const operations = await this.shop.unconfirmed(context)
    const [catalog, quantities, pending] = await Promise.all([
      this.shop.catalog(context, operations),
      context.repositories.movements.listQuantities(),
      this.shop.pendingMovements(context, operations),
    ])
    const codes = new Map<Id, string[]>()
    for (const row of catalog.barcodes) {
      if (row.deletedAt === null) codes.set(row.productId, [...codes.get(row.productId) ?? [], row.barcode])
    }
    const views = catalog.products
      .map((product) => this.toView(product, sumStock([
        { quantityDelta: quantities.get(product.id) ?? 0 },
        ...pending.filter((row) => row.productId === product.id),
      ]), codes.get(product.id) ?? []))
      .sort(byName)
    return { catalog, views }
  }

  private toView(product: Overlaid<Product>, quantity: number, barcodes: string[]): ProductView {
    return {
      ...product,
      barcodes,
      quantity,
      isLowStock: isLowStock(quantity, product.minStock),
      isNegativeStock: isNegativeStock(quantity),
    }
  }
}

export const productService = new ProductService(shopAccess)
