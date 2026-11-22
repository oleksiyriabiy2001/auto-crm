import type { OperationType, RejectReason } from '@auto-crm/core'
import { useI18n } from 'vue-i18n'

// What a refused change was and why the server refused it.
export const useAttentionLabels = () => {
  const { t } = useI18n()

  const operationLabel = (type: OperationType): string => {
    switch (type) {
      case 'category.create':
        return t('attention.operations.categoryCreate')
      case 'category.update':
        return t('attention.operations.categoryUpdate')
      case 'category.delete':
        return t('attention.operations.categoryDelete')
      case 'category.restore':
        return t('attention.operations.categoryRestore')
      case 'product.create':
        return t('attention.operations.productCreate')
      case 'product.update':
        return t('attention.operations.productUpdate')
      case 'product.delete':
        return t('attention.operations.productDelete')
      case 'product.restore':
        return t('attention.operations.productRestore')
      case 'barcode.add':
        return t('attention.operations.barcodeAdd')
      case 'barcode.remove':
        return t('attention.operations.barcodeRemove')
      case 'stock.move':
        return t('attention.operations.stockMove')
    }
  }

  const reasonLabel = (reason: RejectReason): string => {
    switch (reason) {
      case 'forbidden':
        return t('attention.reasons.forbidden')
      case 'tenantSuspended':
        return t('attention.reasons.tenantSuspended')
      case 'barcodeConflict':
        return t('attention.reasons.barcodeConflict')
      case 'skuConflict':
        return t('attention.reasons.skuConflict')
      case 'categoryCycle':
        return t('attention.reasons.categoryCycle')
      case 'notFound':
        return t('attention.reasons.notFound')
      case 'invalidPayload':
        return t('attention.reasons.invalidPayload')
    }
  }

  return { operationLabel, reasonLabel }
}
