<script setup lang="ts">
import type { Id } from '@auto-crm/core'
import { createsCategoryCycle } from '@auto-crm/core'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PendingBadge from '@/shared/components/PendingBadge.vue'
import { useLiveQuery } from '@/shared/composables/useLiveQuery'
import { serviceErrorMessage } from '@/shared/labels'
import type { CategoryView } from '@/shared/services/category.service'
import { categoryService } from '@/shared/services/category.service'

// INV-6: admins create, rename, move, delete and restore categories (the route
// checks the role). Products and subcategories keep pointing at a deleted
// category, so a restore brings the tree back.
const { t } = useI18n()

const live = useLiveQuery(() => categoryService.list())
const deleted = useLiveQuery(() => categoryService.listDeleted())

const newName = ref('')
const newParentId = ref<Id | null>(null)
const editing = ref<{ id: Id, name: string, parentId: Id | null } | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

const label = (category: CategoryView): string => category.path.join(' / ')

// Parents a category may move under: not itself and not one of its own
// subcategories.
const parentOptions = computed(() => {
  const all = live.data.value ?? []
  const id = editing.value?.id
  return id === undefined ? all : all.filter((option) => !createsCategoryCycle(all, id, option.id))
})

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

const create = async () => {
  if (newName.value.trim() === '') return
  if (await run(() => categoryService.create({ name: newName.value, parentId: newParentId.value }))) {
    newName.value = ''
  }
}

const startEditing = (category: CategoryView) => {
  error.value = null
  editing.value = { id: category.id, name: category.name, parentId: category.parentId }
}

const save = async () => {
  const draft = editing.value
  if (!draft) return
  if (await run(() => categoryService.update(draft.id, { name: draft.name, parentId: draft.parentId }))) {
    editing.value = null
  }
}

const remove = async (category: CategoryView) => {
  if (window.confirm(t('categories.confirmDelete', { name: category.name }))) {
    await run(() => categoryService.delete(category.id))
  }
}

const restore = (category: CategoryView) => run(() => categoryService.restore(category.id))

const inputClass = `
  rounded-lg border border-gray-300 bg-white px-3 py-2
  focus:border-blue-500 focus:outline-none
`
</script>

<template>
  <section class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">
      {{ t('categories.title') }}
    </h1>

    <form
      class="flex flex-wrap gap-2 rounded-xl bg-white p-4 ring-1 ring-gray-200"
      @submit.prevent="create"
    >
      <input
        v-model="newName"
        :placeholder="t('categories.name')"
        :aria-label="t('categories.name')"
        class="min-w-48 flex-1"
        :class="inputClass"
      >
      <select
        v-model="newParentId"
        :aria-label="t('categories.parent')"
        :class="inputClass"
      >
        <option :value="null">
          {{ t('categories.topLevel') }}
        </option>
        <option
          v-for="option in live.data.value ?? []"
          :key="option.id"
          :value="option.id"
        >
          {{ label(option) }}
        </option>
      </select>
      <button
        type="submit"
        class="
          rounded-lg bg-blue-600 px-4 py-2 font-medium text-white
          hover:bg-blue-700
          disabled:opacity-60
        "
        :disabled="busy"
      >
        {{ t('categories.add') }}
      </button>
    </form>

    <p
      v-if="error || live.error.value"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {{ error ?? serviceErrorMessage(live.error.value) }}
    </p>

    <p
      v-if="live.data.value?.length === 0"
      class="rounded-lg bg-white p-6 text-center text-gray-500 ring-1 ring-gray-200"
    >
      {{ t('categories.empty') }}
    </p>
    <ul
      v-else
      class="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-200"
    >
      <li
        v-for="category in live.data.value ?? []"
        :key="category.id"
        class="px-4 py-2"
      >
        <form
          v-if="editing?.id === category.id"
          class="flex flex-wrap gap-2"
          @submit.prevent="save"
        >
          <input
            v-model="editing.name"
            :aria-label="t('categories.name')"
            class="min-w-48 flex-1"
            :class="inputClass"
          >
          <select
            v-model="editing.parentId"
            :aria-label="t('categories.parent')"
            :class="inputClass"
          >
            <option :value="null">
              {{ t('categories.topLevel') }}
            </option>
            <option
              v-for="option in parentOptions"
              :key="option.id"
              :value="option.id"
            >
              {{ label(option) }}
            </option>
          </select>
          <button
            type="submit"
            class="
              rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white
              hover:bg-blue-700
            "
            :disabled="busy"
          >
            {{ t('categories.save') }}
          </button>
          <button
            type="button"
            class="
              rounded-lg border border-gray-300 px-3 py-2 text-sm
              hover:bg-gray-50
            "
            @click="editing = null"
          >
            {{ t('categories.cancel') }}
          </button>
        </form>
        <div
          v-else
          class="flex flex-wrap items-center gap-3"
          :style="{ paddingLeft: `${(category.path.length - 1) * 1.5}rem` }"
        >
          <span>{{ category.name }}</span>
          <PendingBadge v-if="category.pending" />
          <span class="ml-auto flex gap-3 text-sm">
            <button
              type="button"
              class="
                text-blue-600
                hover:underline
              "
              @click="startEditing(category)"
            >
              {{ t('categories.edit') }}
            </button>
            <button
              type="button"
              class="
                text-red-700
                hover:underline
              "
              :disabled="busy"
              @click="remove(category)"
            >
              {{ t('categories.delete') }}
            </button>
          </span>
        </div>
      </li>
    </ul>

    <template v-if="deleted.data.value?.length">
      <h2 class="pt-2 font-semibold">
        {{ t('categories.deleted') }}
      </h2>
      <ul class="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-200">
        <li
          v-for="category in deleted.data.value"
          :key="category.id"
          class="flex flex-wrap items-center gap-3 px-4 py-2 text-gray-600"
        >
          <span>{{ label(category) }}</span>
          <PendingBadge v-if="category.pending" />
          <button
            type="button"
            class="
              ml-auto text-sm text-blue-600
              hover:underline
            "
            :disabled="busy"
            @click="restore(category)"
          >
            {{ t('categories.restore') }}
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>
