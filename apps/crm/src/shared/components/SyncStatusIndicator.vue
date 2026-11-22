<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/shared/composables/useFormat'
import { useSyncStore } from '@/shared/stores/sync.store'

// SYN-1: online or offline, unsynced changes, last sync time.
const { t } = useI18n()
const { dateTime } = useFormat()
const sync = useSyncStore()

const phase = computed(() => {
  switch (sync.status.phase) {
    case 'syncing':
      return { label: t('sync.status.syncing'), dot: 'bg-blue-500' }
    case 'offline':
      return { label: t('sync.status.offline'), dot: 'bg-gray-400' }
    case 'error':
      return { label: t('sync.status.error'), dot: 'bg-amber-500' }
    case 'signInRequired':
    case 'accessDenied':
      return { label: t('sync.status.stopped'), dot: 'bg-red-500' }
    case 'idle':
      return { label: t('sync.status.idle'), dot: 'bg-green-500' }
  }
})
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600"
    role="status"
  >
    <span class="flex items-center gap-1.5">
      <span
        class="size-2 rounded-full"
        :class="phase.dot"
      />
      {{ phase.label }}
    </span>
    <span
      v-if="sync.status.pendingCount > 0"
      class="font-medium text-amber-700"
    >
      {{ t('sync.status.pending', { count: sync.status.pendingCount }) }}
    </span>
    <span
      v-if="sync.status.rejectedCount > 0"
      class="font-medium text-red-700"
    >
      {{ t('sync.status.rejected', { count: sync.status.rejectedCount }) }}
    </span>
    <span v-if="sync.status.lastSyncedAt">
      {{ t('sync.status.lastSynced', { at: dateTime(sync.status.lastSyncedAt) }) }}
    </span>
  </div>
</template>
