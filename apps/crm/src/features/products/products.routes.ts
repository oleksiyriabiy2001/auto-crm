import type { RouteRecordRaw } from 'vue-router'

import ProductDetailView from './ProductDetailView.vue'
import ProductFormView from './ProductFormView.vue'
import ProductListView from './ProductListView.vue'

export const productsRoutes: RouteRecordRaw[] = [
  {
    path: '/products',
    name: 'products',
    component: ProductListView,
  },
  {
    path: '/products/new',
    name: 'product-new',
    component: ProductFormView,
  },
  {
    path: '/products/:id',
    name: 'product',
    component: ProductDetailView,
  },
  {
    path: '/products/:id/edit',
    name: 'product-edit',
    component: ProductFormView,
    meta: { capability: 'editProduct' },
  },
]
