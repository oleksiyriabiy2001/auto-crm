import type { ProductFields } from '@auto-crm/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductService } from './product.service'
import type { TestShop } from './test-shop'
import { createTestShop, serverBarcode, serverCategory, serverMovement, serverProduct, TEST_NOW, testId } from './test-shop'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const FILTER = testId(1) // live, sku F-1, barcode 4820000000017, 5 in stock, min 5
const PLUG = testId(2) // live, no stock
const OLD = testId(3) // deleted, sku OLD-1, barcode 4820000000024
const CATEGORY = testId(10)
const DELETED_CATEGORY = testId(11)
const FILTER_BARCODE = testId(20)
const OLD_BARCODE = testId(21)

const fields: ProductFields = {
  sku: null,
  name: 'Свічка запалювання',
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: 8_000,
  salePriceMinor: 12_000,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
}

let shop: TestShop
let service: ProductService

beforeEach(async () => {
  shop = createTestShop('admin')
  service = new ProductService(shop.access)
  await shop.seed({
    categories: [
      serverCategory(CATEGORY),
      serverCategory(DELETED_CATEGORY, { deletedAt: '2026-11-21T09:00:00.000Z' }),
    ],
    products: [
      serverProduct(FILTER, { sku: 'F-1', name: 'Фільтр масляний', minStock: 5 }),
      serverProduct(PLUG, { name: 'Свічка' }),
      serverProduct(OLD, { sku: 'OLD-1', name: 'Старий', deletedAt: '2026-11-21T09:00:00.000Z' }),
    ],
    barcodes: [
      serverBarcode(FILTER_BARCODE, FILTER, '4820000000017'),
      serverBarcode(OLD_BARCODE, OLD, '4820000000024'),
      serverBarcode(testId(22), PLUG, '4820000000031', { deletedAt: '2026-11-21T09:00:00.000Z' }),
    ],
    movements: [serverMovement(testId(30), FILTER, 8), serverMovement(testId(31), FILTER, -3)],
  })
})

afterEach(() => {
  shop.db.close()
})

describe('ProductService reads', () => {
  it('lists live products by name with stock and flags', async () => {
    expect((await service.list()).map((row) => [row.name, row.quantity, row.isLowStock, row.isNegativeStock, row.pending])).toStrictEqual([
      ['Свічка', 0, false, false, false],
      ['Фільтр масляний', 5, true, false, false],
    ])
    expect((await service.listDeleted()).map((row) => row.id)).toStrictEqual([OLD])
  })

  it('gives each product its live barcodes, unsynced ones included', async () => {
    await service.addBarcode(FILTER, { barcode: '4820000000048', symbology: null })
    const views = await service.list()
    expect(views.find((row) => row.id === FILTER)?.barcodes).toStrictEqual(['4820000000017', '4820000000048'])
    // The plug's only barcode was removed.
    expect(views.find((row) => row.id === PLUG)?.barcodes).toStrictEqual([])
    expect((await service.get(FILTER))?.product.barcodes).toStrictEqual(['4820000000017', '4820000000048'])
  })

  it('counts unsynced movements in the quantity and flags negative stock', async () => {
    await shop.context.repositories.outbox.add({
      userId: shop.context.userId,
      status: 'pending',
      operation: {
        id: testId(40),
        clientTimestamp: TEST_NOW,
        deviceId: shop.context.deviceId,
        type: 'stock.move',
        payload: {
          id: testId(41),
          productId: PLUG,
          type: 'sale',
          quantityDelta: -2,
          unitCostMinor: null,
          unitPriceMinor: null,
          currency: 'UAH',
          note: null,
          occurredAt: TEST_NOW,
        },
      },
    })
    const plug = (await service.list()).find((row) => row.id === PLUG)
    expect(plug).toMatchObject({ quantity: -2, isNegativeStock: true })
  })

  it('gets a product with its live barcodes and history, newest first', async () => {
    const detail = await service.get(FILTER)
    expect(detail?.product).toMatchObject({ id: FILTER, quantity: 5 })
    expect(detail?.barcodes.map((row) => row.barcode)).toStrictEqual(['4820000000017'])
    expect(detail?.movements.map((row) => row.quantityDelta)).toHaveLength(2)
    expect(await service.get(testId(99))).toBeUndefined()
    expect((await service.get(OLD))?.product.deletedAt).not.toBeNull()
  })

  it('finds a live product by barcode, not a deleted one or a removed barcode', async () => {
    expect((await service.findByBarcode(' 4820000000017 '))?.id).toBe(FILTER)
    expect(await service.findByBarcode('4820000000024')).toBeUndefined()
    expect(await service.findByBarcode('4820000000031')).toBeUndefined()
  })
})

describe('ProductService writes', () => {
  it('creates a product with its barcodes in one operation, shown at once', async () => {
    const id = await service.create({ ...fields, name: ' Свічка запалювання ', barcodes: [{ barcode: '4820000000048', symbology: 'ean13' }] })

    const [operation, ...rest] = await shop.outbox()
    expect(rest).toStrictEqual([])
    expect(operation).toMatchObject({
      type: 'product.create',
      payload: { id, name: 'Свічка запалювання', barcodes: [{ id: expect.any(String), barcode: '4820000000048', symbology: 'ean13' }] },
    })
    expect(shop.syncRequests()).toBe(1)
    expect((await service.findByBarcode('4820000000048'))).toMatchObject({ id, pending: true, quantity: 0 })
  })

  it('lets staff create products', async () => {
    const staff = createTestShop('staff')
    await new ProductService(staff.access).create({ ...fields, barcodes: [] })
    expect(await staff.outbox()).toHaveLength(1)
    staff.db.close()
  })

  it('refuses a SKU another product has, deleted ones included', async () => {
    await expect(service.create({ ...fields, sku: 'F-1', barcodes: [] })).rejects.toMatchObject({ code: 'skuInUse' })
    await expect(service.create({ ...fields, sku: 'OLD-1', barcodes: [] })).rejects.toMatchObject({ code: 'skuInUse' })
    await expect(service.update(PLUG, { sku: 'F-1' })).rejects.toMatchObject({ code: 'skuInUse' })
  })

  it('refuses a barcode a live barcode has, or the same one twice', async () => {
    await expect(service.create({ ...fields, barcodes: [{ barcode: '4820000000017', symbology: null }] })).rejects.toMatchObject({ code: 'barcodeInUse' })
    // Still attached to the deleted product, so still in use.
    await expect(service.addBarcode(PLUG, { barcode: '4820000000024', symbology: null })).rejects.toMatchObject({ code: 'barcodeInUse' })
    await expect(service.create({
      ...fields,
      barcodes: [{ barcode: '4820000000048', symbology: null }, { barcode: '4820000000048', symbology: null }],
    })).rejects.toMatchObject({ code: 'barcodeInUse' })
    expect(await shop.outbox()).toStrictEqual([])
  })

  it('lets a removed barcode be reused', async () => {
    await service.addBarcode(FILTER, { barcode: '4820000000031', symbology: null })
    expect((await service.findByBarcode('4820000000031'))?.id).toBe(FILTER)
  })

  it('checks barcodes against unsynced changes too', async () => {
    await service.addBarcode(PLUG, { barcode: '4820000000048', symbology: null })
    await expect(service.addBarcode(FILTER, { barcode: '4820000000048', symbology: null })).rejects.toMatchObject({ code: 'barcodeInUse' })
    await service.removeBarcode(FILTER_BARCODE)
    await service.addBarcode(PLUG, { barcode: '4820000000017', symbology: null })
    expect((await service.findByBarcode('4820000000017'))?.id).toBe(PLUG)
  })

  it('needs an existing category', async () => {
    await expect(service.create({ ...fields, categoryId: testId(99), barcodes: [] })).rejects.toMatchObject({ code: 'notFound' })
    await service.create({ ...fields, categoryId: CATEGORY, barcodes: [] })
    expect(await shop.outbox()).toHaveLength(1)
  })

  it('refuses invalid input', async () => {
    await expect(service.create({ ...fields, salePriceMinor: -1, barcodes: [] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.update(FILTER, { minStock: 0.0001 })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('sends only the fields that change, and nothing for an edit that changes nothing', async () => {
    await service.update(FILTER, { name: 'Фільтр масляний', salePriceMinor: 27_000, description: null })
    await service.update(FILTER, { salePriceMinor: 27_000 })
    expect(await shop.outbox()).toStrictEqual([expect.objectContaining({
      type: 'product.update',
      baseVersion: 2,
      payload: { id: FILTER, changes: { salePriceMinor: 27_000 } },
    })])
    expect((await service.get(FILTER))?.product).toMatchObject({ salePriceMinor: 27_000, pending: true })
  })

  it('treats a field given as undefined as unchanged', async () => {
    await service.update(FILTER, { name: undefined })
    expect(await shop.outbox()).toStrictEqual([])
  })

  it('bases an edit of an unsynced product on version 1', async () => {
    const id = await service.create({ ...fields, barcodes: [] })
    await service.update(id, { name: 'Свічка NGK' })
    expect((await shop.outbox())[1]).toMatchObject({ type: 'product.update', baseVersion: 1 })
  })

  it('refuses staff edits, deletes and barcode removal', async () => {
    const staff = createTestShop('staff')
    await staff.seed({ products: [serverProduct(FILTER)], barcodes: [serverBarcode(FILTER_BARCODE, FILTER, '4820000000017')] })
    const staffService = new ProductService(staff.access)
    await expect(staffService.update(FILTER, { name: 'Нова' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(staffService.delete(FILTER)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(staffService.removeBarcode(FILTER_BARCODE)).rejects.toMatchObject({ code: 'forbidden' })
    await staffService.addBarcode(FILTER, { barcode: '4820000000048', symbology: null })
    expect((await staff.outbox()).map((operation) => operation.type)).toStrictEqual(['barcode.add'])
    staff.db.close()
  })

  it('deletes and restores, and does nothing when already in that state', async () => {
    await service.delete(FILTER)
    await service.delete(FILTER)
    await service.restore(OLD)
    await service.restore(PLUG)
    expect((await shop.outbox()).map((operation) => operation.type)).toStrictEqual(['product.delete', 'product.restore'])
    expect((await service.list()).map((row) => row.id)).toStrictEqual([PLUG, OLD])
    expect(await service.findByBarcode('4820000000017')).toBeUndefined()
  })

  it('adds barcodes only to live products and removes only live barcodes', async () => {
    await expect(service.addBarcode(OLD, { barcode: '4820000000048', symbology: null })).rejects.toMatchObject({ code: 'notFound' })
    await expect(service.removeBarcode(testId(22))).rejects.toMatchObject({ code: 'notFound' })
    await expect(service.update(testId(99), { name: 'Нова' })).rejects.toMatchObject({ code: 'notFound' })
  })
})
