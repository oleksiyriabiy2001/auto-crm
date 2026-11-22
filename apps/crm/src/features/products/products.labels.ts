import type { ProductUnit } from '@auto-crm/core'

import { i18n } from '@/i18n'

const { t } = i18n.global

// The short label for a product's unit, e.g. "шт".
export const unitLabel = (unit: ProductUnit): string => {
  switch (unit) {
    case 'pcs':
      return t('products.units.pcs')
    case 'l':
      return t('products.units.l')
    case 'kg':
      return t('products.units.kg')
    case 'set':
      return t('products.units.set')
    case 'm':
      return t('products.units.m')
  }
}
