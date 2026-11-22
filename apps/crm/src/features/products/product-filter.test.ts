import { describe, expect, it } from 'vitest'

import type { ProductView } from '@/shared/services/product.service'

import type { ProductFilter } from './product-filter'
import { DEFAULT_PRODUCT_FILTER, filterProducts } from './product-filter'

const view = (name: string, fields: Partial<ProductView> = {}): ProductView => ({
  id: name,
  tenantId: 't',
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
  deletedAt: null,
  version: 1,
  sku: null,
  name,
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: null,
  salePriceMinor: null,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
  pending: false,
  barcodes: [],
  quantity: 0,
  isLowStock: false,
  isNegativeStock: false,
  ...fields,
})

// Оливи (oils) └─ Моторні (motor); Фільтри (filters)
const categories = [
  { id: 'oils', parentId: null },
  { id: 'motor', parentId: 'oils' },
  { id: 'filters', parentId: null },
]

const products = [
  view('Фільтр масляний', { sku: 'F-100', barcodes: ['4820000000017'], categoryId: 'filters', quantity: 5, salePriceMinor: 25_000 }),
  view('Олива 5W-30', { sku: 'OIL-5', categoryId: 'motor', quantity: 1.5, salePriceMinor: 90_000, isLowStock: true }),
  view('Антифриз', { quantity: -2, isNegativeStock: true }),
  view('Свічка', { sku: 'NGK-1', categoryId: 'oils', salePriceMinor: 12_000 }),
]

const names = (filter: Partial<ProductFilter>): string[] =>
  filterProducts(products, { ...DEFAULT_PRODUCT_FILTER, ...filter }, categories).map((product) => product.name)

describe('filterProducts', () => {
  it('sorts by name by default', () => {
    expect(names({})).toStrictEqual(['Антифриз', 'Олива 5W-30', 'Свічка', 'Фільтр масляний'])
  })

  it.each<[string, string[]]>([
    ['фільтр', ['Фільтр масляний']], // part of the name, any case
    ['oil', ['Олива 5W-30']], // part of the SKU, any case
    ['00017', ['Фільтр масляний']], // part of a barcode
    ['  ngk ', ['Свічка']], // surrounding spaces ignored
    ['нема', []],
  ])('searches "%s"', (search, expected) => {
    expect(names({ search })).toStrictEqual(expected)
  })

  it('filters by a category and its subcategories', () => {
    expect(names({ categoryId: 'oils' })).toStrictEqual(['Олива 5W-30', 'Свічка'])
    expect(names({ categoryId: 'motor' })).toStrictEqual(['Олива 5W-30'])
  })

  it('shows low and negative stock', () => {
    expect(names({ lowStockOnly: true })).toStrictEqual(['Антифриз', 'Олива 5W-30'])
  })

  it('sorts by quantity both ways', () => {
    expect(names({ sortBy: 'quantity' })).toStrictEqual(['Антифриз', 'Свічка', 'Олива 5W-30', 'Фільтр масляний'])
    expect(names({ sortBy: 'quantity', descending: true })).toStrictEqual(['Фільтр масляний', 'Олива 5W-30', 'Свічка', 'Антифриз'])
  })

  it('puts products without a SKU or price last in either direction', () => {
    expect(names({ sortBy: 'sku' })).toStrictEqual(['Фільтр масляний', 'Свічка', 'Олива 5W-30', 'Антифриз'])
    expect(names({ sortBy: 'salePrice', descending: true })).toStrictEqual(['Олива 5W-30', 'Фільтр масляний', 'Свічка', 'Антифриз'])
  })

  it('combines search, category and low stock', () => {
    expect(names({ search: 'о', categoryId: 'oils', lowStockOnly: true })).toStrictEqual(['Олива 5W-30'])
  })
})
