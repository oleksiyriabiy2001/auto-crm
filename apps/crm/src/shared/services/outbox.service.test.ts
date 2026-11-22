import type { Operation, RejectReason } from '@auto-crm/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OutboxService } from './outbox.service'
import { ProductService } from './product.service'
import type { TestShop } from './test-shop'
import { createTestShop, serverBarcode, serverCategory, serverProduct, TEST_DEVICE, TEST_NOW, TEST_USER, testId } from './test-shop'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const FILTER = testId(1)
const CATEGORY = testId(2)
const BARCODE = testId(3)

let shop: TestShop
let service: OutboxService
let nextId = 100

beforeEach(async () => {
  shop = createTestShop('admin')
  service = new OutboxService(shop.access)
  await shop.seed({
    categories: [serverCategory(CATEGORY, { name: 'Оливи' })],
    products: [serverProduct(FILTER, { name: 'Фільтр' })],
    barcodes: [serverBarcode(BARCODE, FILTER, '4820000000017')],
  })
})

afterEach(() => {
  shop.db.close()
})

// Adds an operation to the outbox as the server refused it.
const reject = async (type: Operation['type'], payload: unknown, reason: RejectReason, baseVersion?: number): Promise<string> => {
  const operation = {
    id: testId(nextId++),
    clientTimestamp: TEST_NOW,
    deviceId: TEST_DEVICE,
    type,
    payload,
    ...(baseVersion === undefined ? {} : { baseVersion }),
  } as Operation
  await shop.context.repositories.outbox.add({ operation, userId: TEST_USER, status: 'pending' })
  await shop.context.repositories.outbox.markRejected(operation.id, reason)
  return operation.id
}

describe('OutboxService', () => {
  it('lists refused changes with the name and barcode they were about', async () => {
    await reject('barcode.add', { id: testId(50), productId: FILTER, barcode: '4820000000024', symbology: null }, 'barcodeConflict')
    await reject('barcode.remove', { id: BARCODE }, 'forbidden')
    await reject('category.update', { id: CATEGORY, changes: { name: 'Мастила' } }, 'categoryCycle', 2)
    await reject('product.create', { ...serverProduct(testId(51), { name: 'Свічка' }), barcodes: [] }, 'skuConflict')

    expect((await service.listRejected()).map(({ operation, reason, name, barcode }) => [operation.type, reason, name, barcode])).toStrictEqual([
      ['barcode.add', 'barcodeConflict', 'Фільтр', '4820000000024'],
      ['barcode.remove', 'forbidden', 'Фільтр', '4820000000017'],
      ['category.update', 'categoryCycle', 'Оливи', null],
      ['product.create', 'skuConflict', 'Свічка', null],
    ])
  })

  it('retries a change under the same id and asks for a sync', async () => {
    const id = await reject('product.delete', { id: FILTER }, 'forbidden', 2)

    await service.retry(id)

    expect(await service.listRejected()).toStrictEqual([])
    expect((await shop.outbox()).map((operation) => operation.id)).toStrictEqual([id])
    expect(shop.syncRequests()).toBe(1)
  })

  it('discards a change for good, so it no longer shows', async () => {
    const id = await reject('product.update', { id: FILTER, changes: { name: 'Нове' } }, 'notFound', 2)
    const products = new ProductService(shop.access)
    expect((await products.get(FILTER))?.product.name).toBe('Фільтр')

    await service.discard(id)

    expect(await service.listRejected()).toStrictEqual([])
    expect(await shop.outbox()).toStrictEqual([])
    expect(shop.syncRequests()).toBe(1)
  })
})
