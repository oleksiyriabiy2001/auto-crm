<script setup lang="ts">
import type { Id } from '@auto-crm/core'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { operationLabel, reasonLabel } from './attention.labels'
import { useLiveQuery } from '@/shared/composables/useLiveQuery'
import { formatDateTime, formatQuantity } from '@/shared/format'
import { movementTypeLabel, serviceErrorMessage } from '@/shared/labels'
import type { AttentionItem } from '@/shared/services/outbox.service'
import { outboxService } from '@/shared/services/outbox.service'

// SYN-2: changes the server refused, with retry and discard. A refused change
// is not shown anywhere else, so this is where the user decides about it.
const { t } = useI18n()

const items = useLiveQuery(() => outboxService.listRejected())
const error = ref<string | null>(null)
const busy = ref(false)

const run = async (action: () => Promise<unknown>) => {
  error.value = null
  busy.value = true
  try {
    await action()
  } catch (e) {
    error.value = serviceErrorMessage(e)
  } finally {
    busy.value = false
  }
}

const retry = (id: Id) => run(() => outboxService.retry(id))

const discard = async (id: Id) => {
  if (window.confirm(t('attention.confirmDiscard'))) await run(() => outboxService.discard(id))
}

// The movement itself for stock changes, e.g. "Продаж −2".
const movement = (item: AttentionItem): string | null => {
  const { operation } = item
  if (operation.type !== 'stock.move') return null
  const { type, quantityDelta } = operation.payload
  return `${movementTypeLabel(type)} ${quantityDelta > 0 ? '+' : ''}${formatQuantity(quantityDelta)}`
}
</script>

<template>
  <section class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">
      {{ t('attention.title') }}
    </h1>
    <p class="text-sm text-gray-600">
      {{ t('attention.hint') }}
    </p>

    <p
      v-if="error || items.error.value"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ error ?? serviceErrorMessage(items.error.value) }}
    </p>

    <p
      v-if="items.data.value?.length === 0"
      class="rounded-lg bg-white p-6 text-center text-gray-500 ring-1 ring-gray-200"
    >
      {{ t('attention.empty') }}
    </p>
    <ul
      v-else
      class="space-y-2"
    >
      <li
        v-for="item in items.data.value ?? []"
        :key="item.operation.id"
        class="rounded-xl bg-white p-4 ring-1 ring-gray-200"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="font-medium">{{ operationLabel(item.operation.type) }}</span>
          <span v-if="item.name">{{ item.name }}</span>
          <span
            v-if="item.barcode"
            class="font-mono text-sm"
          >{{ item.barcode }}</span>
          <span
            v-if="movement(item)"
            class="text-sm"
          >{{ movement(item) }}</span>
          <span class="ml-auto text-sm text-gray-500">{{ formatDateTime(item.operation.clientTimestamp) }}</span>
        </div>
        <p class="mt-1 text-sm text-red-700">
          {{ reasonLabel(item.reason) }}
        </p>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="
              rounded-lg border border-gray-300 px-3 py-1.5 text-sm
              hover:bg-gray-50
            "
            :disabled="busy"
            @click="retry(item.operation.id)"
          >
            {{ t('attention.retry') }}
          </button>
          <button
            type="button"
            class="
              rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700
              hover:bg-red-50
            "
            :disabled="busy"
            @click="discard(item.operation.id)"
          >
            {{ t('attention.discard') }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
