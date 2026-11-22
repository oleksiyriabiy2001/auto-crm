import type { AuthSession } from '@auto-crm/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { authService } from '@/shared/services/auth.service'

// Who is signed in. Holds UI state only; the auth service does the work.
export const useSessionStore = defineStore('session', () => {
  const session = ref<AuthSession | null>(null)
  const isSignedIn = computed(() => session.value !== null)

  // TODO(phase 2, step 4): start syncService (src/sync/sync.service.ts) after
  // restore and signIn, and stop it on signOut. Until then nothing syncs.

  // Loads the cached session on start-up, before the first navigation.
  const restore = async (): Promise<void> => {
    try {
      session.value = await authService.getSession()
    } catch {
      // TODO(phase 2): an offline start must keep the cached session.
      session.value = null
    }
  }

  const signIn = async (email: string, password: string): Promise<void> => {
    session.value = await authService.signIn(email, password)
  }

  const signOut = async (): Promise<void> => {
    await authService.signOut()
    session.value = null
  }

  return { session, isSignedIn, restore, signIn, signOut }
})
