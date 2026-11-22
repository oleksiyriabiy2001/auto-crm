import type { BootstrapResponse } from '@auto-crm/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { SignedIn } from '@/shared/services/auth.service'
import { authService } from '@/shared/services/auth.service'

// Who is signed in and which shop is open. Holds UI state only; the auth
// service signs in and starts syncing.
export const useSessionStore = defineStore('session', () => {
  const signedIn = ref<SignedIn | null>(null)
  const session = computed(() => signedIn.value?.session ?? null)
  const shop = computed<BootstrapResponse | null>(() => signedIn.value?.shop ?? null)
  const role = computed(() => shop.value?.membership.role ?? null)
  const isSignedIn = computed(() => signedIn.value !== null)

  // Loads the cached session on start-up, before the first navigation.
  const restore = async (): Promise<void> => {
    try {
      signedIn.value = await authService.restore()
    } catch {
      // TODO(phase 2): an offline start must keep the cached session.
      signedIn.value = null
    }
  }

  const signIn = async (email: string, password: string): Promise<void> => {
    signedIn.value = await authService.signIn(email, password)
  }

  // Sync stops first, so even if the server call fails the shop is closed.
  const signOut = async (): Promise<void> => {
    try {
      await authService.signOut()
    } finally {
      signedIn.value = null
    }
  }

  return { session, shop, role, isSignedIn, restore, signIn, signOut }
})
