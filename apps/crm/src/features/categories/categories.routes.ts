import type { RouteRecordRaw } from 'vue-router'

import CategoriesView from './CategoriesView.vue'

export const categoriesRoutes: RouteRecordRaw[] = [
  {
    path: '/categories',
    name: 'categories',
    component: CategoriesView,
    meta: { capability: 'manageCategories' },
  },
]
