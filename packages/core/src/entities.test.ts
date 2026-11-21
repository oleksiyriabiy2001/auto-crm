import { describe, expect, it } from 'vitest'
import { ProductSchema, StockMovementSchema } from './entities'

const row = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  tenantId: '01890a5d-ac96-774b-bcce-b302099a8058',
  createdAt: '2026-11-21T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
  deletedAt: null,
  version: 1,
}

const product = {
  ...row,
  sku: 'OIL-5W30',
  name: 'Олива 5W-30',
  description: null,
  categoryId: null,
  unit: 'l',
  costPriceMinor: 32_000,
  salePriceMinor: 41_500,
  currency: 'UAH',
  minStock: 4,
  locationNote: 'Стелаж 2',
  isActive: true,
}

const movement = {
  ...row,
  productId: '01890a5d-ac96-774b-bcce-b302099a8059',
  type: 'sale',
  quantityDelta: -1.5,
  unitCostMinor: 32_000,
  unitPriceMinor: 41_500,
  currency: 'UAH',
  note: null,
  occurredAt: '2026-11-21T10:00:00Z',
  createdBy: '01890a5d-ac96-774b-bcce-b302099a805a',
  deviceId: '01890a5d-ac96-774b-bcce-b302099a805b',
  sourceType: null,
  sourceId: null,
}

describe('ProductSchema', () => {
  it('accepts a valid product', () => {
    expect(ProductSchema.safeParse(product).success).toBe(true)
  })

  it('accepts a tombstone', () => {
    expect(ProductSchema.safeParse({ ...product, deletedAt: '2026-11-22T08:00:00Z' }).success).toBe(true)
  })

  it.each([
    ['an unknown unit', { unit: 'box' }],
    ['a fractional price', { salePriceMinor: 415.5 }],
    ['a negative threshold', { minStock: -1 }],
    ['a blank name', { name: ' ' }],
    ['a missing tenant', { tenantId: undefined }],
  ])('rejects %s', (_, override) => {
    expect(ProductSchema.safeParse({ ...product, ...override }).success).toBe(false)
  })
})

describe('StockMovementSchema', () => {
  it('accepts a valid movement', () => {
    expect(StockMovementSchema.safeParse(movement).success).toBe(true)
  })

  it('rejects an unknown movement type', () => {
    expect(StockMovementSchema.safeParse({ ...movement, type: 'transfer' }).success).toBe(false)
  })
})
