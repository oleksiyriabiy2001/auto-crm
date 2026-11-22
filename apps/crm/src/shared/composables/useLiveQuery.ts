import { liveQuery } from 'dexie'
import type { Ref, WatchSource } from 'vue'
import { onScopeDispose, shallowRef, watch } from 'vue'

export interface LiveQuery<T> {
  data: Ref<T | undefined> // undefined until the first result
  error: Ref<unknown> // the last failure, cleared by the next result
}

// Runs a service read and runs it again whenever the local data it read
// changes: the user's own writes, a pull, or another tab's sync. Dexie tracks
// every database call made while `query` runs, so `query` must await only
// service and repository calls, never the network or a timer. When a value in
// `sources` changes (a route param, say), the query starts over with it.
export const useLiveQuery = <T>(query: () => Promise<T>, sources: WatchSource[] = []): LiveQuery<T> => {
  const data = shallowRef<T>()
  const error = shallowRef<unknown>(null)
  let subscription: { unsubscribe: () => void } | undefined

  watch(sources, () => {
    subscription?.unsubscribe()
    // Dexie follows native awaits only when the querier itself is an async
    // function, so wrap `query`: otherwise reads after its first await (a
    // service reads the outbox, then the tables) go unwatched.
    subscription = liveQuery(async () => await query()).subscribe({
      next: (value) => {
        data.value = value
        error.value = null
      },
      error: (failure: unknown) => {
        error.value = failure
      },
    })
  }, { immediate: true })

  onScopeDispose(() => {
    subscription?.unsubscribe()
  })

  return { data, error }
}
