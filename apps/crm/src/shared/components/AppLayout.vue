<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRouter } from 'vue-router'

import SyncStatusIndicator from '@/shared/components/SyncStatusIndicator.vue'
import { useCan } from '@/shared/composables/useCan'
import { useSessionStore } from '@/shared/stores/session.store'
import { useSyncStore } from '@/shared/stores/sync.store'

// The frame around every signed-in page: navigation, sync status, and the
// banners that say why syncing stopped.
const { t } = useI18n()
const router = useRouter()
const session = useSessionStore()
const sync = useSyncStore()
const can = useCan()

const signOut = async () => {
  try {
    await session.signOut()
  } finally {
    await router.replace({ name: 'login' })
  }
}
</script>

<template>
  <div class="min-h-dvh bg-gray-50">
    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span class="font-semibold">{{ session.shop?.tenant.name ?? t('app.title') }}</span>
        <nav class="flex gap-4 text-sm">
          <RouterLink
            :to="{ name: 'products' }"
            class="
              text-gray-700
              hover:text-gray-900
            "
            active-class="font-medium text-blue-700"
          >
            {{ t('layout.nav.products') }}
          </RouterLink>
          <RouterLink
            v-if="can('manageCategories')"
            :to="{ name: 'categories' }"
            class="
              text-gray-700
              hover:text-gray-900
            "
            active-class="font-medium text-blue-700"
          >
            {{ t('layout.nav.categories') }}
          </RouterLink>
        </nav>
        <SyncStatusIndicator class="ml-auto" />
        <div class="flex items-center gap-3 text-sm">
          <span class="text-gray-600">{{ session.shop?.profile.displayName }}</span>
          <button
            type="button"
            class="
              rounded-lg border border-gray-300 px-3 py-1.5
              hover:bg-gray-50
            "
            @click="signOut"
          >
            {{ t('layout.signOut') }}
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="sync.status.phase === 'signInRequired'"
      class="bg-red-50 text-red-800"
      role="alert"
    >
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        {{ t('sync.banner.signInRequired') }}
        <button
          type="button"
          class="font-medium underline"
          @click="signOut"
        >
          {{ t('sync.banner.signInAgain') }}
        </button>
      </div>
    </div>
    <div
      v-else-if="sync.status.phase === 'accessDenied'"
      class="bg-red-50 text-red-800"
      role="alert"
    >
      <div class="mx-auto max-w-6xl px-4 py-2 text-sm">
        {{ t('sync.banner.accessDenied') }}
      </div>
    </div>

    <main class="mx-auto max-w-6xl p-4">
      <RouterView />
    </main>
  </div>
</template>
