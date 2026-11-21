<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h1 class="mb-6 text-xl font-semibold">
        {{ title }}
      </h1>
      <slot />
    </div>
  </main>
</template>
