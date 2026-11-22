import { createRouter, createWebHistory } from 'vue-router'

import { authRoutes } from '@/features/auth/auth.routes'
import { productsRoutes } from '@/features/products/products.routes'
import AppLayout from '@/shared/components/AppLayout.vue'
import { useSessionStore } from '@/shared/stores/session.store'

declare module 'vue-router' {
  interface RouteMeta {
    // Reachable without signing in. Every other route needs a session.
    public?: boolean
    // Only for signed-out users: a signed-in user is sent to the products.
    guestOnly?: boolean
  }
}

// Each feature owns its routes in <feature>.routes.ts; this file only
// combines them and guards sign-in. Signed-in pages render inside AppLayout.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', redirect: { name: 'products' } },
        ...productsRoutes,
      ],
    },
    ...authRoutes,
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'products' },
    },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()
  if (!to.meta.public && !session.isSignedIn) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && session.isSignedIn) {
    return { name: 'products' }
  }
  return true
})

export default router
