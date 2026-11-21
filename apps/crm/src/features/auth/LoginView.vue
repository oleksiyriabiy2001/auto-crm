<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AuthCard from './components/AuthCard.vue'
import { useAuthErrorMessage } from './composables/useAuthErrorMessage'
import { invalidFields, LoginFormSchema } from './auth.schema'
import { useSessionStore } from '@/shared/stores/session.store'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const authErrorMessage = useAuthErrorMessage()

const email = ref('')
const password = ref('')
const invalid = ref<Partial<Record<string, true>>>({})
const error = ref<string | null>(null)
const submitting = ref(false)

const submit = async () => {
  error.value = null
  const form = LoginFormSchema.safeParse({ email: email.value.trim(), password: password.value })
  invalid.value = form.success ? {} : invalidFields(form.error)
  if (!form.success) return

  submitting.value = true
  try {
    await session.signIn(form.data.email, form.data.password)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (e) {
    error.value = authErrorMessage(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('auth.login.title')">
    <form
      class="space-y-4"
      novalidate
      @submit.prevent="submit"
    >
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
          :aria-invalid="invalid.email"
        >
        <span
          v-if="invalid.email"
          class="mt-1 block text-sm text-red-600"
        >{{ t('auth.validation.email') }}</span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('auth.login.password') }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="
            w-full rounded-lg border border-gray-300 px-3 py-2
            focus:border-blue-500 focus:outline-none
          "
          :aria-invalid="invalid.password"
        >
        <span
          v-if="invalid.password"
          class="mt-1 block text-sm text-red-600"
        >{{ t('auth.validation.passwordRequired') }}</span>
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
        {{ submitting ? t('auth.login.submitting') : t('auth.login.submit') }}
      </button>

      <RouterLink
        :to="{ name: 'forgot-password' }"
        class="
          block text-center text-sm text-blue-600
          hover:underline
        "
      >
        {{ t('auth.login.forgotPassword') }}
      </RouterLink>
    </form>
  </AuthCard>
</template>
