<script setup lang="ts">
import type { Id, ProductUnit } from '@auto-crm/core'
import { ProductUnitSchema } from '@auto-crm/core'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { useUnitLabel } from './composables/useUnitLabel'
import { categoryOptions } from './product-filter'
import { BarcodeTextSchema, invalidFields, ProductFormSchema, toMoneyText, toQuantityText } from './products.schema'
import { useCan } from '@/shared/composables/useCan'
import { useLiveQuery } from '@/shared/composables/useLiveQuery'
import { useServiceErrorMessage } from '@/shared/composables/useServiceErrorMessage'
import { categoryService } from '@/shared/services/category.service'
import { productService } from '@/shared/services/product.service'

// INV-3 (create, all roles) and INV-4 (edit, admins; the route checks it).
// Barcodes are added on create; afterwards they are managed on the product page.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const can = useCan()
const unitLabel = useUnitLabel()
const serviceErrorMessage = useServiceErrorMessage()

const editingId = computed<Id | null>(() => (route.name === 'product-edit' ? String(route.params.id) : null))
const showCost = computed(() => can('viewReports'))
const categories = useLiveQuery(() => categoryService.list())
const options = computed(() => categoryOptions(categories.data.value ?? []))

const name = ref('')
const sku = ref('')
const description = ref('')
const categoryId = ref<Id | null>(null)
const unit = ref<ProductUnit>('pcs')
const costPrice = ref('')
const salePrice = ref('')
const minStock = ref('')
const locationNote = ref('')
const barcodes = ref<string[]>([''])

const loading = ref(false)
const notFound = ref(false)
const invalid = ref<Partial<Record<string, true>>>({})
const error = ref<string | null>(null)
const submitting = ref(false)

// The form is filled once, not live, so a sync never overwrites what the
// user is typing.
onMounted(async () => {
  if (editingId.value === null) return
  loading.value = true
  try {
    const detail = await productService.get(editingId.value)
    if (!detail) {
      notFound.value = true
      return
    }
    const { product } = detail
    name.value = product.name
    sku.value = product.sku ?? ''
    description.value = product.description ?? ''
    categoryId.value = product.categoryId
    unit.value = product.unit
    costPrice.value = toMoneyText(product.costPriceMinor)
    salePrice.value = toMoneyText(product.salePriceMinor)
    minStock.value = toQuantityText(product.minStock)
    locationNote.value = product.locationNote ?? ''
  } catch (e) {
    error.value = serviceErrorMessage(e)
  } finally {
    loading.value = false
  }
})

const submit = async () => {
  error.value = null
  const form = ProductFormSchema.safeParse({
    name: name.value,
    sku: sku.value,
    description: description.value,
    categoryId: categoryId.value,
    unit: unit.value,
    costPrice: costPrice.value,
    salePrice: salePrice.value,
    minStock: minStock.value,
    locationNote: locationNote.value,
  })
  invalid.value = form.success ? {} : invalidFields(form.error)
  if (!form.success) return

  submitting.value = true
  try {
    let id = editingId.value
    if (id === null) {
      const codes = barcodes.value.flatMap((code) => {
        const parsed = BarcodeTextSchema.safeParse(code)
        return parsed.success ? [{ barcode: parsed.data, symbology: null }] : []
      })
      id = await productService.create({ ...form.data, currency: 'UAH', isActive: true, barcodes: codes })
    } else {
      await productService.update(id, form.data)
    }
    await router.replace({ name: 'product', params: { id } })
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
  <section class="max-w-2xl space-y-4">
    <RouterLink
      :to="editingId ? { name: 'product', params: { id: editingId } } : { name: 'products' }"
      class="
        text-sm text-blue-600
        hover:underline
      "
    >
      {{ t('products.form.back') }}
    </RouterLink>
    <h1 class="text-2xl font-semibold">
      {{ editingId ? t('products.form.editTitle') : t('products.form.createTitle') }}
    </h1>

    <p
      v-if="notFound"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ t('errors.service.notFound') }}
    </p>
    <p
      v-else-if="loading"
      class="text-gray-500"
    >
      {{ t('products.list.loading') }}
    </p>

    <form
      v-else
      class="space-y-4 rounded-xl bg-white p-4 ring-1 ring-gray-200"
      novalidate
      @submit.prevent="submit"
    >
      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('products.fields.name') }}</span>
        <input
          v-model="name"
          :class="inputClass"
          :aria-invalid="invalid.name"
        >
        <span
          v-if="invalid.name"
          class="mt-1 block text-sm text-red-600"
        >{{ t('products.validation.nameRequired') }}</span>
      </label>

      <div
        class="
          grid gap-4
          sm:grid-cols-2
        "
      >
        <label class="block">
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.sku') }}</span>
          <input
            v-model="sku"
            :class="inputClass"
          >
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.category') }}</span>
          <select
            v-model="categoryId"
            :class="inputClass"
          >
            <option :value="null">
              {{ t('products.fields.noCategory') }}
            </option>
            <option
              v-for="option in options"
              :key="option.id"
              :value="option.id"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.unit') }}</span>
          <select
            v-model="unit"
            :class="inputClass"
          >
            <option
              v-for="option in ProductUnitSchema.options"
              :key="option"
              :value="option"
            >
              {{ unitLabel(option) }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.minStock') }}</span>
          <input
            v-model="minStock"
            inputmode="decimal"
            :class="inputClass"
            :aria-invalid="invalid.minStock"
          >
          <span
            v-if="invalid.minStock"
            class="mt-1 block text-sm text-red-600"
          >{{ t('products.validation.quantity') }}</span>
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.salePrice') }}</span>
          <input
            v-model="salePrice"
            inputmode="decimal"
            :class="inputClass"
            :aria-invalid="invalid.salePrice"
          >
          <span
            v-if="invalid.salePrice"
            class="mt-1 block text-sm text-red-600"
          >{{ t('products.validation.money') }}</span>
        </label>
        <label
          v-if="showCost"
          class="block"
        >
          <span class="mb-1 block text-sm font-medium">{{ t('products.fields.costPrice') }}</span>
          <input
            v-model="costPrice"
            inputmode="decimal"
            :class="inputClass"
            :aria-invalid="invalid.costPrice"
          >
          <span
            v-if="invalid.costPrice"
            class="mt-1 block text-sm text-red-600"
          >{{ t('products.validation.money') }}</span>
        </label>
      </div>

      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('products.fields.locationNote') }}</span>
        <input
          v-model="locationNote"
          :class="inputClass"
        >
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">{{ t('products.fields.description') }}</span>
        <textarea
          v-model="description"
          rows="3"
          :class="inputClass"
        />
      </label>

      <fieldset
        v-if="!editingId"
        class="space-y-2"
      >
        <legend class="mb-1 text-sm font-medium">
          {{ t('products.fields.barcodes') }}
        </legend>
        <input
          v-for="(_, index) in barcodes"
          :key="index"
          v-model="barcodes[index]"
          inputmode="numeric"
          :class="inputClass"
          :aria-label="t('products.fields.barcode')"
        >
        <button
          type="button"
          class="
            text-sm text-blue-600
            hover:underline
          "
          @click="barcodes.push('')"
        >
          + {{ t('products.form.addBarcode') }}
        </button>
      </fieldset>

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
          rounded-lg bg-blue-600 px-4 py-2 font-medium text-white
          hover:bg-blue-700
          disabled:opacity-60
        "
        :disabled="submitting"
      >
        {{ editingId ? t('products.form.save') : t('products.form.create') }}
      </button>
    </form>
  </section>
</template>
