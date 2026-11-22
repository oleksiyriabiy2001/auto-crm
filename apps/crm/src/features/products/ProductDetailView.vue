<script setup lang="ts">
import type { Id } from '@auto-crm/core'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'

import MovementForm from './components/MovementForm.vue'
import { useMovementTypeLabel } from './composables/useMovementTypeLabel'
import { useUnitLabel } from './composables/useUnitLabel'
import { categoryOptions } from './product-filter'
import { BarcodeTextSchema } from './products.schema'
import PendingBadge from '@/shared/components/PendingBadge.vue'
import { useCan } from '@/shared/composables/useCan'
import { useFormat } from '@/shared/composables/useFormat'
import { useLiveQuery } from '@/shared/composables/useLiveQuery'
import { useServiceErrorMessage } from '@/shared/composables/useServiceErrorMessage'
import { categoryService } from '@/shared/services/category.service'
import { productService } from '@/shared/services/product.service'

// INV-2: a product with its stock, barcodes and movement history. Admins edit,
// delete and restore it (INV-4, INV-5) and remove barcodes; everyone adds them.
const { t } = useI18n()
const route = useRoute()
const { dateTime, money, quantity } = useFormat()
const unitLabel = useUnitLabel()
const movementTypeLabel = useMovementTypeLabel()
const can = useCan()
const serviceErrorMessage = useServiceErrorMessage()

const id = computed<Id>(() => String(route.params.id))
// Null once the product turns out not to exist; undefined while loading.
const detail = useLiveQuery(async () => (await productService.get(id.value)) ?? null, [id])
const categories = useLiveQuery(() => categoryService.list())

const product = computed(() => detail.data.value?.product)
const isDeleted = computed(() => (product.value?.deletedAt ?? null) !== null)
const categoryLabel = computed(() => {
  const categoryId = product.value?.categoryId
  if (!categoryId) return null
  return categoryOptions(categories.data.value ?? []).find((option) => option.id === categoryId)?.label ?? t('products.detail.deletedCategory')
})
const showCost = computed(() => can('viewReports'))

const newBarcode = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

const run = async (action: () => Promise<unknown>): Promise<boolean> => {
  error.value = null
  busy.value = true
  try {
    await action()
    return true
  } catch (e) {
    error.value = serviceErrorMessage(e)
    return false
  } finally {
    busy.value = false
  }
}

const addBarcode = async () => {
  const code = BarcodeTextSchema.safeParse(newBarcode.value)
  if (!code.success) return
  if (await run(() => productService.addBarcode(id.value, { barcode: code.data, symbology: null }))) newBarcode.value = ''
}

const removeBarcode = (barcodeId: Id) => run(() => productService.removeBarcode(barcodeId))

const remove = async () => {
  if (window.confirm(t('products.detail.confirmDelete'))) await run(() => productService.delete(id.value))
}

const restore = () => run(() => productService.restore(id.value))

const quantityClass = computed(() => {
  if (product.value?.isNegativeStock) return 'text-red-700'
  if (product.value?.isLowStock) return 'text-amber-700'
  return ''
})
</script>

<template>
  <section class="space-y-4">
    <RouterLink
      :to="{ name: 'products' }"
      class="
        text-sm text-blue-600
        hover:underline
      "
    >
      {{ t('products.detail.back') }}
    </RouterLink>

    <p
      v-if="detail.error.value"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ serviceErrorMessage(detail.error.value) }}
    </p>
    <p
      v-else-if="detail.data.value === undefined"
      class="text-gray-500"
    >
      {{ t('products.list.loading') }}
    </p>
    <p
      v-else-if="detail.data.value === null"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ t('errors.service.notFound') }}
    </p>

    <template v-if="product && detail.data.value">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">
          {{ product.name }}
        </h1>
        <PendingBadge v-if="product.pending" />
        <span
          v-if="isDeleted"
          class="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
        >
          {{ t('products.detail.deleted') }}
        </span>
        <div class="ml-auto flex gap-2">
          <RouterLink
            v-if="can('editProduct')"
            :to="{ name: 'product-edit', params: { id } }"
            class="
              rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
              hover:bg-gray-50
            "
          >
            {{ t('products.detail.edit') }}
          </RouterLink>
          <template v-if="can('deleteProduct')">
            <button
              v-if="isDeleted"
              type="button"
              class="
                rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                hover:bg-gray-50
              "
              :disabled="busy"
              @click="restore"
            >
              {{ t('products.list.restore') }}
            </button>
            <button
              v-else
              type="button"
              class="
                rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700
                hover:bg-red-50
              "
              :disabled="busy"
              @click="remove"
            >
              {{ t('products.detail.delete') }}
            </button>
          </template>
        </div>
      </div>

      <p
        v-if="error"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        role="alert"
      >
        {{ error }}
      </p>

      <div
        class="
          grid gap-4
          md:grid-cols-3
        "
      >
        <div class="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <p class="text-sm text-gray-600">
            {{ t('products.detail.stock') }}
          </p>
          <p
            class="mt-1 text-3xl font-semibold"
            :class="quantityClass"
          >
            {{ quantity(product.quantity) }} {{ unitLabel(product.unit) }}
          </p>
          <p
            v-if="product.isNegativeStock"
            class="mt-1 text-sm text-red-700"
          >
            {{ t('products.detail.negativeStock') }}
          </p>
          <p
            v-else-if="product.isLowStock"
            class="mt-1 text-sm text-amber-700"
          >
            {{ t('products.detail.lowStock') }}
          </p>
        </div>

        <dl
          class="
            grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white p-4 text-sm ring-1 ring-gray-200
            md:col-span-2
          "
        >
          <dt class="text-gray-600">
            {{ t('products.fields.sku') }}
          </dt>
          <dd>{{ product.sku ?? '—' }}</dd>
          <dt class="text-gray-600">
            {{ t('products.fields.category') }}
          </dt>
          <dd>{{ categoryLabel ?? '—' }}</dd>
          <dt class="text-gray-600">
            {{ t('products.fields.salePrice') }}
          </dt>
          <dd>{{ product.salePriceMinor === null ? '—' : money(product.salePriceMinor, product.currency) }}</dd>
          <template v-if="showCost">
            <dt class="text-gray-600">
              {{ t('products.fields.costPrice') }}
            </dt>
            <dd>{{ product.costPriceMinor === null ? '—' : money(product.costPriceMinor, product.currency) }}</dd>
          </template>
          <dt class="text-gray-600">
            {{ t('products.fields.minStock') }}
          </dt>
          <dd>{{ product.minStock === null ? '—' : `${quantity(product.minStock)} ${unitLabel(product.unit)}` }}</dd>
          <dt class="text-gray-600">
            {{ t('products.fields.locationNote') }}
          </dt>
          <dd>{{ product.locationNote ?? '—' }}</dd>
          <template v-if="product.description">
            <dt class="text-gray-600">
              {{ t('products.fields.description') }}
            </dt>
            <dd class="whitespace-pre-line">
              {{ product.description }}
            </dd>
          </template>
        </dl>
      </div>

      <MovementForm :product="product" />

      <div class="rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">
          {{ t('products.fields.barcodes') }}
        </h2>
        <p
          v-if="detail.data.value.barcodes.length === 0"
          class="text-sm text-gray-500"
        >
          {{ t('products.detail.noBarcodes') }}
        </p>
        <ul class="divide-y divide-gray-100">
          <li
            v-for="barcode in detail.data.value.barcodes"
            :key="barcode.id"
            class="flex items-center gap-3 py-1.5"
          >
            <span class="font-mono">{{ barcode.barcode }}</span>
            <PendingBadge v-if="barcode.pending" />
            <button
              v-if="can('editProduct')"
              type="button"
              class="
                ml-auto text-sm text-red-700
                hover:underline
              "
              :disabled="busy"
              @click="removeBarcode(barcode.id)"
            >
              {{ t('products.detail.removeBarcode') }}
            </button>
          </li>
        </ul>
        <form
          v-if="can('addBarcode') && !isDeleted"
          class="mt-3 flex gap-2"
          @submit.prevent="addBarcode"
        >
          <input
            v-model="newBarcode"
            inputmode="numeric"
            :aria-label="t('products.fields.barcode')"
            :placeholder="t('products.fields.barcode')"
            class="
              min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2
              focus:border-blue-500 focus:outline-none
            "
          >
          <button
            type="submit"
            class="
              rounded-lg border border-gray-300 px-3 py-2 text-sm
              hover:bg-gray-50
            "
            :disabled="busy"
          >
            {{ t('products.detail.addBarcode') }}
          </button>
        </form>
      </div>

      <div class="rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">
          {{ t('products.detail.history') }}
        </h2>
        <p
          v-if="detail.data.value.movements.length === 0"
          class="text-sm text-gray-500"
        >
          {{ t('products.detail.noMovements') }}
        </p>
        <div
          v-else
          class="overflow-x-auto"
        >
          <table class="w-full text-sm">
            <thead class="text-left text-gray-600">
              <tr>
                <th class="py-1.5 pr-4 font-medium">
                  {{ t('products.detail.columns.date') }}
                </th>
                <th class="py-1.5 pr-4 font-medium">
                  {{ t('products.detail.columns.type') }}
                </th>
                <th class="py-1.5 pr-4 text-right font-medium">
                  {{ t('products.detail.columns.quantity') }}
                </th>
                <th class="py-1.5 pr-4 text-right font-medium">
                  {{ t('products.detail.columns.price') }}
                </th>
                <th
                  v-if="showCost"
                  class="py-1.5 pr-4 text-right font-medium"
                >
                  {{ t('products.detail.columns.cost') }}
                </th>
                <th class="py-1.5 font-medium">
                  {{ t('products.detail.columns.note') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="movement in detail.data.value.movements"
                :key="movement.id"
              >
                <td class="py-1.5 pr-4 whitespace-nowrap">
                  {{ dateTime(movement.occurredAt) }}
                </td>
                <td class="py-1.5 pr-4">
                  <span class="flex flex-wrap items-center gap-2">
                    {{ movementTypeLabel(movement.type) }}
                    <PendingBadge v-if="movement.pending" />
                  </span>
                </td>
                <td
                  class="py-1.5 pr-4 text-right whitespace-nowrap"
                  :class="movement.quantityDelta < 0 ? 'text-red-700' : 'text-green-700'"
                >
                  {{ movement.quantityDelta > 0 ? '+' : '' }}{{ quantity(movement.quantityDelta) }}
                </td>
                <td class="py-1.5 pr-4 text-right whitespace-nowrap">
                  {{ movement.unitPriceMinor === null ? '—' : money(movement.unitPriceMinor, movement.currency) }}
                </td>
                <td
                  v-if="showCost"
                  class="py-1.5 pr-4 text-right whitespace-nowrap"
                >
                  {{ movement.unitCostMinor === null ? '—' : money(movement.unitCostMinor, movement.currency) }}
                </td>
                <td class="py-1.5 text-gray-600">
                  {{ movement.note ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>
