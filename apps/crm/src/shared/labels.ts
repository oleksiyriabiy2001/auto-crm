import type { MovementType } from '@auto-crm/core'

import { i18n } from '@/i18n'
import { ServiceError } from '@/shared/services/service-error'

// Display text used by several features. Each value has its own case, so
// ESLint can check every message key exists and is used.
const { t } = i18n.global

// What a stock movement was, e.g. "Продаж".
export const movementTypeLabel = (type: MovementType): string => {
  switch (type) {
    case 'initial':
      return t('products.movementTypes.initial')
    case 'receive':
      return t('products.movementTypes.receive')
    case 'sale':
      return t('products.movementTypes.sale')
    case 'consume':
      return t('products.movementTypes.consume')
    case 'adjustment':
      return t('products.movementTypes.adjustment')
    case 'write_off':
      return t('products.movementTypes.writeOff')
  }
}

// Turns a refused service call into a message for the user.
export const serviceErrorMessage = (error: unknown): string => {
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
