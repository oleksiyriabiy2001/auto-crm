import { createRouter, createWebHistory } from 'vue-router'

import { authRoutes } from '@/features/auth/auth.routes'
import { homeRoutes } from '@/features/home/home.routes'
import { useSessionStore } from '@/shared/stores/session.store'

declare module 'vue-router' {
  interface RouteMeta {
    // Reachable without signing in. Every other route needs a session.
    public?: boolean
    // Only for signed-out users: a signed-in user is sent home.
    guestOnly?: boolean
  }
}

// Each feature owns its routes in <feature>.routes.ts; this file only
// combines them and guards sign-in.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    ...homeRoutes,
    ...authRoutes,
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'home' },
    },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()
  if (!to.meta.public && !session.isSignedIn) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && session.isSignedIn) {
    return { name: 'home' }
  }
  return true
})

export default router
