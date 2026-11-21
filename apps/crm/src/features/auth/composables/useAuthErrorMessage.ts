import { GatewayError } from '@auto-crm/core'
import { useI18n } from 'vue-i18n'

// Turns a failed auth call into a message for the user.
export const useAuthErrorMessage = () => {
  const { t } = useI18n()

  return (error: unknown): string => {
    const code = error instanceof GatewayError ? error.code : 'unknown'
    switch (code) {
      case 'invalidCredentials':
        return t('auth.errors.invalidCredentials')
      case 'weakPassword':
        return t('auth.errors.weakPassword')
      case 'samePassword':
        return t('auth.errors.samePassword')
      case 'network':
        return t('auth.errors.network')
      case 'unknown':
        return t('auth.errors.unknown')
    }
  }
}
