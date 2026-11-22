import type { RouteRecordRaw } from 'vue-router'

import NeedsAttentionView from './NeedsAttentionView.vue'

export const attentionRoutes: RouteRecordRaw[] = [
  {
    path: '/attention',
    name: 'attention',
    component: NeedsAttentionView,
  },
]
