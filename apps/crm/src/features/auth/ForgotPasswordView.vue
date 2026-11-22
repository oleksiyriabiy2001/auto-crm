<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { authErrorMessage } from './auth.labels'
import { EmailSchema } from './auth.schema'
import AuthCard from './components/AuthCard.vue'
import { authService } from '@/shared/services/auth.service'

const { t } = useI18n()

const email = ref('')
const invalid = ref(false)
const error = ref<string | null>(null)
const submitting = ref(false)
const sent = ref(false)

const submit = async () => {
  error.value = null
  const parsed = EmailSchema.safeParse(email.value.trim())
  invalid.value = !parsed.success
  if (!parsed.success) return

  submitting.value = true
  try {
    await authService.requestPasswordReset(parsed.data)
    // The same message whether or not the account exists, so the form
    // cannot be used to find out who has an account.
    sent.value = true
  } catch (e) {
    error.value = authErrorMessage(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('auth.forgot.title')">
    <p
      v-if="sent"
      class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
      role="status"
    >
      {{ t('auth.forgot.sent') }}
    </p>

    <form
      v-else
      class="space-y-4"
      novalidate
      @submit.prevent="submit"
    >
      <p class="text-sm text-gray-600">
        {{ t('auth.forgot.hint') }}
      </p>

      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('auth.login.email') }}</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          class="
            w-full rounded-lg border border-gray-300 px-3 py-2
            focus:border-blue-500 focus:outline-none
          "
          :aria-invalid="invalid"
        >
        <span
          v-if="invalid"
          class="mt-1 block text-sm text-red-600"
        >{{ t('auth.validation.email') }}</span>
      </label>

      <p
        v-if="error"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        role="alert"
      >
        {{ error }}
      </p>

      <button
        type="submit"
        class="
          w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white
          hover:bg-blue-700
          disabled:opacity-60
        "
        :disabled="submitting"
      >
        {{ t('auth.forgot.submit') }}
      </button>
    </form>

    <RouterLink
      :to="{ name: 'login' }"
      class="
        mt-4 block text-center text-sm text-blue-600
        hover:underline
      "
    >
      {{ t('auth.forgot.backToLogin') }}
    </RouterLink>
  </AuthCard>
</template>
