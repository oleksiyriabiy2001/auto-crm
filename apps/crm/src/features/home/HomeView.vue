<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useSessionStore } from '@/shared/stores/session.store'

const { t } = useI18n()
const router = useRouter()
const session = useSessionStore()

const signOut = async () => {
  await session.signOut()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="p-6">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">
        {{ t('app.title') }}
      </h1>
      <button
        type="button"
        class="
          rounded-lg border border-gray-300 px-3 py-1.5 text-sm
          hover:bg-gray-50
        "
        @click="signOut"
      >
        {{ t('home.signOut') }}
      </button>
    </div>
    <p class="mt-4 text-gray-600">
      {{ t('home.signedInAs', { email: session.session?.email }) }}
    </p>
  </main>
</template>
