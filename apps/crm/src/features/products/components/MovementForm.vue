<script setup lang="ts">
import type { MovementType } from '@auto-crm/core'
import { movementCapability, MovementTypeSchema, sumStock, toQuantityDelta } from '@auto-crm/core'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMovementTypeLabel } from '../composables/useMovementTypeLabel'
import { useUnitLabel } from '../composables/useUnitLabel'
import { invalidFields, MovementFormSchema } from '../products.schema'
import { useCan } from '@/shared/composables/useCan'
import { useFormat } from '@/shared/composables/useFormat'
import { useServiceErrorMessage } from '@/shared/composables/useServiceErrorMessage'
import type { ProductView } from '@/shared/services/product.service'
import { stockService } from '@/shared/services/stock.service'

// STK-1: record a movement. STK-3: adjustments need a note and the admin
// role, so staff only see receive, sale and consume. STK-2: a movement that
// takes stock below zero is warned about but saved.
const props = defineProps<{ product: ProductView }>()

const { t } = useI18n()
const { quantity: formatQuantity } = useFormat()
const typeLabel = useMovementTypeLabel()
const unitLabel = useUnitLabel()
const can = useCan()
const serviceErrorMessage = useServiceErrorMessage()

const types = computed(() => MovementTypeSchema.options.filter((type) => can(movementCapability(type))))
const type = ref<MovementType>('receive')
const quantity = ref('')
const note = ref('')
const invalid = ref<Partial<Record<string, true>>>({})
const error = ref<string | null>(null)
const saved = ref<string | null>(null)
const submitting = ref(false)

// Stock after this movement, while the quantity typed is valid. A missing
// adjustment note does not change the stock, so the preview fills one in.
const stockAfter = computed(() => {
  const form = MovementFormSchema.safeParse({ type: type.value, quantity: quantity.value, note: note.value || 'x' })
  if (!form.success) return null
  return sumStock([{ quantityDelta: props.product.quantity }, { quantityDelta: toQuantityDelta(type.value, form.data.quantity) }])
})

const submit = async () => {
  error.value = null
  saved.value = null
  const form = MovementFormSchema.safeParse({ type: type.value, quantity: quantity.value, note: note.value })
  invalid.value = form.success ? {} : invalidFields(form.error)
  if (!form.success) return

  submitting.value = true
  try {
    await stockService.recordMovement({ productId: props.product.id, ...form.data })
    saved.value = t('products.movement.saved', { type: typeLabel(form.data.type) })
    quantity.value = ''
    note.value = ''
  } catch (e) {
    error.value = serviceErrorMessage(e)
  } finally {
    submitting.value = false
  }
}

const inputClass = `
  w-full rounded-lg border border-gray-300 bg-white px-3 py-2
  focus:border-blue-500 focus:outline-none
  aria-invalid:border-red-500
`
</script>

<template>
  <form
    class="space-y-3 rounded-xl bg-white p-4 ring-1 ring-gray-200"
    novalidate
    @submit.prevent="submit"
  >
    <h2 class="font-semibold">
      {{ t('products.movement.title') }}
    </h2>

    <div
      class="
        grid gap-3
        sm:grid-cols-[auto_10rem_1fr_auto] sm:items-start
      "
    >
      <label class="block">
        <span class="sr-only">{{ t('products.detail.columns.type') }}</span>
        <select
          v-model="type"
          :class="inputClass"
        >
          <option
            v-for="option in types"
            :key="option"
            :value="option"
          >
            {{ typeLabel(option) }}
          </option>
        </select>
      </label>
      <label class="block">
        <span class="sr-only">{{ t('products.detail.columns.quantity') }}</span>
        <input
          v-model="quantity"
          inputmode="decimal"
          :placeholder="type === 'adjustment' ? t('products.movement.signedPlaceholder') : t('products.detail.columns.quantity')"
          :class="inputClass"
          :aria-invalid="invalid.quantity"
        >
        <span
          v-if="invalid.quantity"
          class="mt-1 block text-sm text-red-600"
        >
          {{ type === 'adjustment' ? t('products.movement.invalidSigned') : t('products.movement.invalidQuantity') }}
        </span>
      </label>
      <label class="block">
        <span class="sr-only">{{ t('products.detail.columns.note') }}</span>
        <input
          v-model="note"
          :placeholder="type === 'adjustment' ? t('products.movement.noteRequired') : t('products.movement.noteOptional')"
          :class="inputClass"
          :aria-invalid="invalid.note"
        >
        <span
          v-if="invalid.note"
          class="mt-1 block text-sm text-red-600"
        >{{ t('products.movement.noteMissing') }}</span>
      </label>
      <button
        type="submit"
        class="
          rounded-lg bg-blue-600 px-4 py-2 font-medium text-white
          hover:bg-blue-700
          disabled:opacity-60
        "
        :disabled="submitting"
      >
        {{ t('products.movement.submit') }}
      </button>
    </div>

    <p
      v-if="stockAfter !== null && stockAfter < 0"
      class="text-sm text-amber-700"
    >
      {{ t('products.movement.willBeNegative', { quantity: `${formatQuantity(stockAfter)} ${unitLabel(product.unit)}` }) }}
    </p>
    <p
      v-if="error"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="saved"
      class="text-sm text-green-700"
      role="status"
    >
      {{ saved }}
    </p>
  </form>
</template>
