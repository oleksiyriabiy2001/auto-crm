<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// Marks a row the server has not confirmed yet.
const { t } = useI18n()
</script>

<template>
  <span
    class="
      rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800
    "
    :title="t('sync.pendingHint')"
  >
    {{ t('sync.pending') }}
  </span>
</template>
