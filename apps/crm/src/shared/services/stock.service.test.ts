import type { MovementType } from '@auto-crm/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductService } from './product.service'
import { StockService } from './stock.service'
import type { TestShop } from './test-shop'
import { createTestShop, serverMovement, serverProduct, TEST_NOW, testId } from './test-shop'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const FILTER = testId(1) // 2 in stock, cost 150.00, price 250.00
const OLD = testId(2) // deleted

let shop: TestShop
let service: StockService

beforeEach(async () => {
  shop = createTestShop('admin')
  service = new StockService(shop.access)
  await shop.seed({
    products: [serverProduct(FILTER), serverProduct(OLD, { deletedAt: '2026-11-21T09:00:00.000Z' })],
    movements: [serverMovement(testId(30), FILTER, 2)],
  })
})

afterEach(() => {
  shop.db.close()
})

const quantity = async (productId = FILTER) => (await new ProductService(shop.access).get(productId))?.product.quantity

describe('StockService', () => {
  it('records a sale with the price and cost copied in, and shows it at once', async () => {
    const id = await service.recordMovement({ productId: FILTER, type: 'sale', quantity: 1.5, note: null })

    expect(await shop.outbox()).toStrictEqual([expect.objectContaining({
      type: 'stock.move',
      payload: {
        id,
        productId: FILTER,
        type: 'sale',
        quantityDelta: -1.5,
        unitCostMinor: 15_000,
        unitPriceMinor: 25_000,
        currency: 'UAH',
        note: null,
        occurredAt: TEST_NOW,
      },
    })])
    expect(shop.syncRequests()).toBe(1)
    expect(await quantity()).toBe(0.5)
  })

  it.each<[MovementType, number, number]>([
    ['receive', 3, 3],
    ['consume', 1, -1],
    ['write_off', 0.5, -0.5],
    ['initial', 10, 10],
    ['adjustment', -0.25, -0.25],
  ])('turns %s of %d into a delta of %d', async (type, typed, delta) => {
    await service.recordMovement({ productId: FILTER, type, quantity: typed, note: 'Перерахунок' })
    expect((await shop.outbox())[0]).toMatchObject({ payload: { quantityDelta: delta } })
  })

  it('allows negative stock and flags it', async () => {
    await service.recordMovement({ productId: FILTER, type: 'sale', quantity: 5, note: null })
    const filter = (await new ProductService(shop.access).list()).find((row) => row.id === FILTER)
    expect(filter).toMatchObject({ quantity: -3, isNegativeStock: true })
  })

  it('refuses zero, a typed negative, and an adjustment without a note', async () => {
    await expect(service.recordMovement({ productId: FILTER, type: 'receive', quantity: 0, note: null })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.recordMovement({ productId: FILTER, type: 'sale', quantity: -1, note: null })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.recordMovement({ productId: FILTER, type: 'adjustment', quantity: 1, note: '   ' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.recordMovement({ productId: FILTER, type: 'receive', quantity: 0.0005, note: null })).rejects.toMatchObject({ code: 'invalid' })
    expect(await shop.outbox()).toStrictEqual([])
  })

  it('records on a deleted product, since the sale still happened', async () => {
    await service.recordMovement({ productId: OLD, type: 'sale', quantity: 1, note: null })
    expect(await quantity(OLD)).toBe(-1)
  })

  it('refuses an unknown product', async () => {
    await expect(service.recordMovement({ productId: testId(99), type: 'sale', quantity: 1, note: null })).rejects.toMatchObject({ code: 'notFound' })
  })

  it('copies the price of a product edited on this device but not synced yet', async () => {
    await new ProductService(shop.access).update(FILTER, { salePriceMinor: 30_000 })
    await service.recordMovement({ productId: FILTER, type: 'sale', quantity: 1, note: null })
    expect((await shop.outbox())[1]).toMatchObject({ payload: { unitPriceMinor: 30_000 } })
  })

  it('lets staff receive, sell and consume, but not adjust, write off or set an initial count', async () => {
    const staff = createTestShop('staff')
    await staff.seed({ products: [serverProduct(FILTER)] })
    const staffService = new StockService(staff.access)
    for (const type of ['receive', 'sale', 'consume'] as const) {
      await staffService.recordMovement({ productId: FILTER, type, quantity: 1, note: null })
    }
    for (const type of ['adjustment', 'write_off', 'initial'] as const) {
      await expect(staffService.recordMovement({ productId: FILTER, type, quantity: 1, note: 'Перерахунок' })).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect(await staff.outbox()).toHaveLength(3)
    staff.db.close()
  })
})
