<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import AuthCard from './components/AuthCard.vue'
import { useAuthErrorMessage } from './composables/useAuthErrorMessage'
import { invalidFields, MIN_PASSWORD_LENGTH, NewPasswordFormSchema } from './auth.schema'
import { authService } from '@/shared/services/auth.service'
import { useSessionStore } from '@/shared/stores/session.store'

// Opened from the reset email: the link signs the user in, so a missing
// session means the link was invalid or has expired.
const { t } = useI18n()
const router = useRouter()
const session = useSessionStore()
const authErrorMessage = useAuthErrorMessage()

const password = ref('')
const confirm = ref('')
const invalid = ref<Partial<Record<string, true>>>({})
const error = ref<string | null>(null)
const submitting = ref(false)

const submit = async () => {
  error.value = null
  const form = NewPasswordFormSchema.safeParse({ password: password.value, confirm: confirm.value })
  invalid.value = form.success ? {} : invalidFields(form.error)
  if (!form.success) return

  submitting.value = true
  try {
    await authService.updatePassword(form.data.password)
    await router.replace({ name: 'home' })
  } catch (e) {
    error.value = authErrorMessage(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('auth.setPassword.title')">
    <template v-if="!session.isSignedIn">
      <p
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        role="alert"
      >
        {{ t('auth.setPassword.linkInvalid') }}
      </p>
      <RouterLink
        :to="{ name: 'forgot-password' }"
        class="
          mt-4 block text-center text-sm text-blue-600
          hover:underline
        "
      >
        {{ t('auth.setPassword.requestNew') }}
      </RouterLink>
    </template>

    <form
      v-else
      class="space-y-4"
      novalidate
      @submit.prevent="submit"
    >
      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('auth.setPassword.password') }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          class="
            w-full rounded-lg border border-gray-300 px-3 py-2
            focus:border-blue-500 focus:outline-none
          "
          :aria-invalid="invalid.password"
        >
        <span
          v-if="invalid.password"
          class="mt-1 block text-sm text-red-600"
        >{{ t('auth.validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) }}</span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('auth.setPassword.confirm') }}</span>
        <input
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          class="
            w-full rounded-lg border border-gray-300 px-3 py-2
            focus:border-blue-500 focus:outline-none
          "
          :aria-invalid="invalid.confirm"
        >
        <span
          v-if="invalid.confirm"
          class="mt-1 block text-sm text-red-600"
        >{{ t('auth.validation.passwordsDiffer') }}</span>
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
        {{ t('auth.setPassword.submit') }}
      </button>
    </form>
  </AuthCard>
</template>
