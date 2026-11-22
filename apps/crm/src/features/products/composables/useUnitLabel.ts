import type { ProductUnit } from '@auto-crm/core'
import { useI18n } from 'vue-i18n'

// The short label for a product's unit, e.g. "шт".
export const useUnitLabel = () => {
  const { t } = useI18n()

  return (unit: ProductUnit): string => {
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
}
