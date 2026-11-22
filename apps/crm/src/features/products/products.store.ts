import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { ProductFilter, ProductSortKey } from './product-filter'
import { DEFAULT_PRODUCT_FILTER } from './product-filter'

// The product list's search, filters and sort, kept while the user opens a
// product and comes back.
export const useProductsStore = defineStore('products', () => {
  const filter = ref<ProductFilter>({ ...DEFAULT_PRODUCT_FILTER })
  const showDeleted = ref(false)

  // A second click on the same column reverses the order.
  const sortBy = (key: ProductSortKey): void => {
    filter.value = {
      ...filter.value,
      sortBy: key,
      descending: filter.value.sortBy === key ? !filter.value.descending : false,
    }
  }

  return { filter, showDeleted, sortBy }
})
