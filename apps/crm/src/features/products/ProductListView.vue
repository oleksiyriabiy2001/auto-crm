<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useUnitLabel } from './composables/useUnitLabel'
import type { ProductSortKey } from './product-filter'
import { categoryOptions, filterProducts } from './product-filter'
import { useProductsStore } from './products.store'
import PendingBadge from '@/shared/components/PendingBadge.vue'
import { useCan } from '@/shared/composables/useCan'
import { useFormat } from '@/shared/composables/useFormat'
import { useLiveQuery } from '@/shared/composables/useLiveQuery'
import { useServiceErrorMessage } from '@/shared/composables/useServiceErrorMessage'
import { categoryService } from '@/shared/services/category.service'
import type { ProductView } from '@/shared/services/product.service'
import { productService } from '@/shared/services/product.service'

// INV-1: the product list with search, filters and sorting. INV-5: admins
// switch to deleted products and restore them.
const { t } = useI18n()
const { money, quantity } = useFormat()
const unitLabel = useUnitLabel()
const can = useCan()
const serviceErrorMessage = useServiceErrorMessage()
const store = useProductsStore()

const live = useLiveQuery(() => productService.list())
const deleted = useLiveQuery(() => productService.listDeleted())
const categories = useLiveQuery(() => categoryService.list())

const canRestore = computed(() => can('deleteProduct'))
const showingDeleted = computed(() => store.showDeleted && canRestore.value)
const source = computed(() => (showingDeleted.value ? deleted : live))
const options = computed(() => categoryOptions(categories.data.value ?? []))
const rows = computed(() => filterProducts(source.value.data.value ?? [], store.filter, categories.data.value ?? []))
const loadError = computed(() => (source.value.error.value ? serviceErrorMessage(source.value.error.value) : null))
const actionError = ref<string | null>(null)

const columns: { key: ProductSortKey, label: () => string, numeric: boolean }[] = [
  { key: 'name', label: () => t('products.list.columns.name'), numeric: false },
  { key: 'sku', label: () => t('products.list.columns.sku'), numeric: false },
  { key: 'quantity', label: () => t('products.list.columns.quantity'), numeric: true },
  { key: 'salePrice', label: () => t('products.list.columns.salePrice'), numeric: true },
]

const sortMark = (key: ProductSortKey): string => {
  if (store.filter.sortBy !== key) return ''
  return store.filter.descending ? '↓' : '↑'
}

const quantityClass = (product: ProductView): string => {
  if (product.isNegativeStock) return 'text-red-700 font-semibold'
  if (product.isLowStock) return 'text-amber-700 font-semibold'
  return ''
}

const restore = async (product: ProductView) => {
  actionError.value = null
  try {
    await productService.restore(product.id)
  } catch (error) {
    actionError.value = serviceErrorMessage(error)
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-2xl font-semibold">
        {{ t('products.list.title') }}
      </h1>
      <div
        v-if="canRestore"
        class="flex rounded-lg border border-gray-300 bg-white p-0.5 text-sm"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          class="rounded-md px-3 py-1"
          :class="!store.showDeleted ? 'bg-gray-900 text-white' : 'text-gray-700'"
          :aria-selected="!store.showDeleted"
          @click="store.showDeleted = false"
        >
          {{ t('products.list.active') }}
        </button>
        <button
          type="button"
          role="tab"
          class="rounded-md px-3 py-1"
          :class="store.showDeleted ? 'bg-gray-900 text-white' : 'text-gray-700'"
          :aria-selected="store.showDeleted"
          @click="store.showDeleted = true"
        >
          {{ t('products.list.deleted') }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-56 flex-1">
        <span class="sr-only">{{ t('products.list.search') }}</span>
        <input
          v-model="store.filter.search"
          type="search"
          :placeholder="t('products.list.search')"
          class="
            w-full rounded-lg border border-gray-300 bg-white px-3 py-2
            focus:border-blue-500 focus:outline-none
          "
        >
      </label>
      <label>
        <span class="sr-only">{{ t('products.list.category') }}</span>
        <select
          v-model="store.filter.categoryId"
          class="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option :value="null">
            {{ t('products.list.allCategories') }}
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
      <label class="flex items-center gap-2 py-2 text-sm">
        <input
          v-model="store.filter.lowStockOnly"
          type="checkbox"
          class="size-4"
        >
        {{ t('products.list.lowStockOnly') }}
      </label>
    </div>

    <p
      v-if="loadError || actionError"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ loadError ?? actionError }}
    </p>
    <p
      v-else-if="source.data.value === undefined"
      class="text-gray-500"
    >
      {{ t('products.list.loading') }}
    </p>
    <p
      v-else-if="rows.length === 0"
      class="rounded-lg bg-white p-6 text-center text-gray-500 ring-1 ring-gray-200"
    >
      {{ source.data.value.length === 0 ? t('products.list.empty') : t('products.list.noMatches') }}
    </p>

    <template v-else>
      <!-- Wide screens: a sortable table. -->
      <table
        class="
          hidden w-full overflow-hidden rounded-xl bg-white text-sm ring-1 ring-gray-200
          md:table
        "
      >
        <thead class="bg-gray-50 text-left text-gray-600">
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              class="px-4 py-2 font-medium"
              :class="column.numeric && 'text-right'"
              :aria-sort="store.filter.sortBy === column.key ? (store.filter.descending ? 'descending' : 'ascending') : undefined"
            >
              <button
                type="button"
                class="hover:text-gray-900"
                @click="store.sortBy(column.key)"
              >
                {{ column.label() }} {{ sortMark(column.key) }}
              </button>
            </th>
            <th
              v-if="showingDeleted"
              class="px-4 py-2"
            />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="product in rows"
            :key="product.id"
          >
            <td class="px-4 py-2">
              <span class="flex flex-wrap items-center gap-2">
                {{ product.name }}
                <PendingBadge v-if="product.pending" />
              </span>
            </td>
            <td class="px-4 py-2 text-gray-600">
              {{ product.sku ?? '—' }}
            </td>
            <td
              class="px-4 py-2 text-right whitespace-nowrap"
              :class="quantityClass(product)"
            >
              {{ quantity(product.quantity) }} {{ unitLabel(product.unit) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              {{ product.salePriceMinor === null ? '—' : money(product.salePriceMinor, product.currency) }}
            </td>
            <td
              v-if="showingDeleted"
              class="px-4 py-2 text-right"
            >
              <button
                type="button"
                class="
                  text-blue-600
                  hover:underline
                "
                @click="restore(product)"
              >
                {{ t('products.list.restore') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Phones: cards. Sorting stays as chosen on a wide screen. -->
      <ul
        class="
          space-y-2
          md:hidden
        "
      >
        <li
          v-for="product in rows"
          :key="product.id"
          class="rounded-xl bg-white p-3 ring-1 ring-gray-200"
        >
          <div class="flex items-start justify-between gap-3">
            <span class="flex flex-wrap items-center gap-2 font-medium">
              {{ product.name }}
              <PendingBadge v-if="product.pending" />
            </span>
            <span
              class="whitespace-nowrap"
              :class="quantityClass(product)"
            >
              {{ quantity(product.quantity) }} {{ unitLabel(product.unit) }}
            </span>
          </div>
          <div class="mt-1 flex justify-between gap-3 text-sm text-gray-600">
            <span>{{ product.sku ?? '' }}</span>
            <span>{{ product.salePriceMinor === null ? '' : money(product.salePriceMinor, product.currency) }}</span>
          </div>
          <button
            v-if="showingDeleted"
            type="button"
            class="
              mt-2 text-sm text-blue-600
              hover:underline
            "
            @click="restore(product)"
          >
            {{ t('products.list.restore') }}
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>
