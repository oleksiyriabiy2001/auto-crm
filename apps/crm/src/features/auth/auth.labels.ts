import { GatewayError } from '@auto-crm/core'

import { i18n } from '@/i18n'

const { t } = i18n.global

// Turns a failed auth call into a message for the user.
export const authErrorMessage = (error: unknown): string => {
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
    case 'sessionExpired':
      return t('auth.errors.sessionExpired')
    case 'accessDenied':
      return t('auth.errors.accessDenied')
    case 'unknown':
      return t('auth.errors.unknown')
  }
}
