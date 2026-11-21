import type { RouteRecordRaw } from 'vue-router'

import ForgotPasswordView from './ForgotPasswordView.vue'
import LoginView from './LoginView.vue'
import SetPasswordView from './SetPasswordView.vue'

export const authRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { public: true, guestOnly: true },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: ForgotPasswordView,
    meta: { public: true, guestOnly: true },
  },
  {
    // Opened from the password reset email. Public so an expired link can
    // explain itself instead of bouncing to the login screen.
    path: '/set-password',
    name: 'set-password',
    component: SetPasswordView,
    meta: { public: true },
  },
]
