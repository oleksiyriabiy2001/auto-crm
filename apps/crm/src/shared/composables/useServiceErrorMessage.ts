import { useI18n } from 'vue-i18n'

import { ServiceError } from '@/shared/services/service-error'

// Turns a refused service call into a message for the user.
export const useServiceErrorMessage = () => {
  const { t } = useI18n()

  return (error: unknown): string => {
    if (!(error instanceof ServiceError)) return t('errors.service.unknown')
    switch (error.code) {
      case 'notSignedIn':
        return t('errors.service.notSignedIn')
      case 'forbidden':
        return t('errors.service.forbidden')
      case 'notFound':
        return t('errors.service.notFound')
      case 'invalid':
        return t('errors.service.invalid')
      case 'barcodeInUse':
        return t('errors.service.barcodeInUse')
      case 'skuInUse':
        return t('errors.service.skuInUse')
      case 'categoryCycle':
        return t('errors.service.categoryCycle')
    }
  }
}
