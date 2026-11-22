import type { MovementType } from '@auto-crm/core'
import { useI18n } from 'vue-i18n'

// What a stock movement was, e.g. "Продаж".
export const useMovementTypeLabel = () => {
  const { t } = useI18n()

  return (type: MovementType): string => {
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
}
