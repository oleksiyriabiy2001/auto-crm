import type { RouteRecordRaw } from 'vue-router'

import ProductListView from './ProductListView.vue'

export const productsRoutes: RouteRecordRaw[] = [
  {
    path: '/products',
    name: 'products',
    component: ProductListView,
  },
]
