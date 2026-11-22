import type { ProductFields } from '@auto-crm/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeGateway } from '@/sync/fake-gateway'
import { SyncEngine } from '@/sync/sync-engine'

import { CategoryService } from './category.service'
import { ProductService } from './product.service'
import { StockService } from './stock.service'
import type { TestShop } from './test-shop'
import { createTestShop, serverMovement, serverProduct, TEST_USER, testId } from './test-shop'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

// End to end on the device: services write the outbox, the engine pushes it to
// FakeGateway and pulls the server's rows back. What the screens show must not
// change across the sync, at any point of it.

const fields: ProductFields = {
  sku: null,
  name: 'Фільтр масляний',
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: 15_000,
  salePriceMinor: 25_000,
  currency: 'UAH',
  minStock: 2,
  locationNote: null,
  isActive: true,
}

let shop: TestShop
let gateway: FakeGateway
let engine: SyncEngine
let categories: CategoryService
let products: ProductService
let stock: StockService

beforeEach(() => {
  shop = createTestShop('admin')
  gateway = new FakeGateway()
  engine = new SyncEngine(gateway, shop.context.repositories, shop.context.transactions, TEST_USER, {
    setTimer: () => 0,
    clearTimer: () => undefined,
  })
  categories = new CategoryService(shop.access)
  products = new ProductService(shop.access)
  stock = new StockService(shop.access)
})

afterEach(() => {
  engine.stop()
  shop.db.close()
})

// A row as the user sees it. Versions and timestamps are the server's to
// assign, and `pending` is the one thing a sync is meant to change.
const visible = (row: object): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...row }
  copy.deleted = copy.deletedAt !== null
  for (const key of ['pending', 'version', 'createdAt', 'updatedAt', 'deletedAt']) Reflect.deleteProperty(copy, key)
  return copy
}

// Everything the screens can show.
const screens = async () => {
  const all = [...await products.list(), ...await products.listDeleted()]
  const details = await Promise.all(all.map(async (product) => products.get(product.id)))
  return {
    categories: [...await categories.list(), ...await categories.listDeleted()].map(visible),
    products: all.map(visible),
    barcodes: details.flatMap((detail) => detail?.barcodes ?? []).map(visible),
    movements: details.flatMap((detail) => detail?.movements ?? []).map(visible),
  }
}

const pendingFlags = async (): Promise<boolean[]> => [
  ...(await categories.list()).map((row) => row.pending),
  ...(await products.list()).map((row) => row.pending),
  ...(await products.listDeleted()).map((row) => row.pending),
]

describe('services through a sync', () => {
  it('show the same data before, during and after the sync', async () => {
    const filters = await categories.create({ name: 'Фільтри', parentId: null })
    const oil = await categories.create({ name: 'Оливні', parentId: filters })
    await categories.update(oil, { name: 'Масляні' })
    await categories.delete(await categories.create({ name: 'Тимчасова', parentId: null }))

    const filter = await products.create({ ...fields, sku: 'F-1', categoryId: oil, barcodes: [{ barcode: '4820000000017', symbology: 'ean13' }] })
    await products.update(filter, { salePriceMinor: 27_000 })
    await products.addBarcode(filter, { barcode: '4820000000024', symbology: null })
    const first = (await products.get(filter))?.barcodes.find((row) => row.barcode === '4820000000017')
    await products.removeBarcode(first?.id ?? '')
    await stock.recordMovement({ productId: filter, type: 'receive', quantity: 10, note: null })
    await stock.recordMovement({ productId: filter, type: 'sale', quantity: 3, note: null })
    await stock.recordMovement({ productId: filter, type: 'adjustment', quantity: -0.5, note: 'Пошкоджено' })
    await products.delete(await products.create({ ...fields, name: 'Свічка', barcodes: [] }))

    const before = await screens()
    expect(await pendingFlags()).toStrictEqual([true, true, true, true])
    expect((await products.get(filter))?.product).toMatchObject({ quantity: 6.5, salePriceMinor: 27_000 })

    // One row per page, so the screens are read between every page, while
    // accepted operations are still replayed on rows already pulled.
    gateway.pageSize = 1
    const during: Awaited<ReturnType<typeof screens>>[] = []
    const pull = gateway.pullChanges.bind(gateway)
    gateway.pullChanges = async (request) => {
      if (request.cursor !== null) during.push(await screens())
      return pull(request)
    }

    await engine.syncNow()

    expect(await shop.outbox()).toStrictEqual([])
    expect(during.length).toBeGreaterThan(5)
    for (const snapshot of during) expect(snapshot).toStrictEqual(before)
    expect(await screens()).toStrictEqual(before)
    expect(await pendingFlags()).toStrictEqual([false, false, false, false])
  })

  it('show another device\'s edit of a new product as soon as it is pulled', async () => {
    const filter = await products.create({ ...fields, barcodes: [] })
    // Right after our push, another device renames the product and records a
    // movement, so the pull ends on a later page than the renamed row.
    const push = gateway.pushOperations.bind(gateway)
    gateway.pushOperations = async (request) => {
      const response = await push(request)
      gateway.addRow(serverProduct(filter, { ...fields, name: 'Фільтр MANN', version: 2 }))
      gateway.addRow({ ...serverMovement(testId(50), filter, 1), createdBy: testId(51) })
      return response
    }
    gateway.pageSize = 1
    const during: (string | undefined)[] = []
    const pull = gateway.pullChanges.bind(gateway)
    gateway.pullChanges = async (request) => {
      if (request.cursor !== null) during.push((await products.get(filter))?.product.name)
      return pull(request)
    }

    await engine.syncNow()

    // Read after the renamed row's page, while the accepted create is still
    // in the outbox: the create must not hide the server's row.
    expect(during).toStrictEqual(['Фільтр MANN'])
    expect((await products.get(filter))?.product).toMatchObject({ name: 'Фільтр MANN', quantity: 1 })
  })

  it('drop a change the server rejects and keep the rest', async () => {
    const filter = await products.create({ ...fields, barcodes: [] })
    await engine.syncNow()

    const barcode = await products.addBarcode(filter, { barcode: '4820000000017', symbology: null })
    await products.update(filter, { salePriceMinor: 30_000 })
    gateway.decide = (operation) => (operation.type === 'barcode.add'
      ? { operationId: operation.id, status: 'rejected', reason: 'barcodeConflict' }
      : undefined)
    expect((await products.findByBarcode('4820000000017'))?.id).toBe(filter)

    await engine.syncNow()

    expect(await products.findByBarcode('4820000000017')).toBeUndefined()
    expect((await products.get(filter))?.product).toMatchObject({ salePriceMinor: 30_000, pending: false })
    expect(await shop.context.repositories.outbox.listRejected(TEST_USER)).toStrictEqual([
      expect.objectContaining({ reason: 'barcodeConflict', operation: expect.objectContaining({ payload: expect.objectContaining({ id: barcode }) }) }),
    ])
  })

  it('show nothing of an edit whose row the server never had', async () => {
    await engine.syncNow()
    const ghost = await products.create({ ...fields, barcodes: [] })
    await stock.recordMovement({ productId: ghost, type: 'receive', quantity: 4, note: null })
    gateway.decide = (operation) => (operation.type === 'product.create'
      ? { operationId: operation.id, status: 'rejected', reason: 'forbidden' }
      : undefined)

    await engine.syncNow()

    // The movement is refused as notFound once its product was refused.
    expect(await products.list()).toStrictEqual([])
    expect((await shop.context.repositories.outbox.listRejected(TEST_USER)).map((entry) => entry.status === 'rejected' && entry.reason))
      .toStrictEqual(['forbidden', 'notFound'])
  })
})
