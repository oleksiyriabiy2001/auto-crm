<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <h1 class="text-2xl font-semibold">
    {{ t('products.list.title') }}
  </h1>
</template>
