import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { SyncStatus } from '@/sync/sync-engine'
import { syncService } from '@/sync/sync.service'

// The sync status for the indicator and banners: phase, unsynced and
// rejected counts, and when the last full sync finished.
export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatus>(syncService.getStatus())
  syncService.subscribe((next) => {
    status.value = next
  })
  return { status }
})
