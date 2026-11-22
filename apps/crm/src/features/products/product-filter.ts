import type { CategoryNode, Id } from '@auto-crm/core'

import type { ProductView } from '@/shared/services/product.service'

export type ProductSortKey = 'name' | 'sku' | 'quantity' | 'salePrice'

export interface ProductFilter {
  // Matches part of the name, SKU or a barcode, ignoring case.
  search: string
  // The category or any of its subcategories. Null shows every product.
  categoryId: Id | null
  // At or below the threshold, or negative.
  lowStockOnly: boolean
  sortBy: ProductSortKey
  descending: boolean
}

export const DEFAULT_PRODUCT_FILTER: ProductFilter = {
  search: '',
  categoryId: null,
  lowStockOnly: false,
  sortBy: 'name',
  descending: false,
}

const LOCALE = 'uk'
const normalize = (text: string): string => text.trim().toLocaleLowerCase(LOCALE)

// The category and every category below it.
const withDescendants = (categories: readonly CategoryNode[], rootId: Id): Set<Id> => {
  const ids = new Set([rootId])
  // Adds children until nothing new turns up; capped so a broken tree cannot loop.
  for (let pass = 0; pass <= categories.length; pass++) {
    const before = ids.size
    for (const category of categories) {
      if (category.parentId !== null && ids.has(category.parentId)) ids.add(category.id)
    }
    if (ids.size === before) break
  }
  return ids
}

// Compares two values with nulls last whatever the direction.
const compare = (a: string | number | null, b: string | number | null, descending: boolean): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), LOCALE)
  return descending ? -order : order
}

const sortValue = (product: ProductView, key: ProductSortKey): string | number | null => {
  switch (key) {
    case 'name':
      return product.name
    case 'sku':
      return product.sku
    case 'quantity':
      return product.quantity
    case 'salePrice':
      return product.salePriceMinor
  }
}

// The product list as INV-1 shows it: searched, filtered and sorted. Ties
// fall back to the name, so the order is stable.
export const filterProducts = (
  products: readonly ProductView[],
  filter: ProductFilter,
  categories: readonly CategoryNode[],
): ProductView[] => {
  const search = normalize(filter.search)
  const inCategory = filter.categoryId === null ? null : withDescendants(categories, filter.categoryId)
  return products
    .filter((product) => search === ''
      || normalize(product.name).includes(search)
      || (product.sku !== null && normalize(product.sku).includes(search))
      || product.barcodes.some((code) => code.includes(search)))
    .filter((product) => inCategory === null || (product.categoryId !== null && inCategory.has(product.categoryId)))
    .filter((product) => !filter.lowStockOnly || product.isLowStock || product.isNegativeStock)
    .sort((a, b) => compare(sortValue(a, filter.sortBy), sortValue(b, filter.sortBy), filter.descending)
      || a.name.localeCompare(b.name, LOCALE))
}
