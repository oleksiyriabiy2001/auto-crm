import { Dexie } from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EffectScope } from 'vue'
import { effectScope, ref } from 'vue'

import type { ProductInput } from '@/shared/services/product.service'
import { ProductService } from '@/shared/services/product.service'
import type { TestShop } from '@/shared/services/test-shop'
import { createTestShop, serverMovement, serverProduct, testId } from '@/shared/services/test-shop'

import { useLiveQuery } from './useLiveQuery'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const FILTER = testId(1)

const fields: ProductInput = {
  sku: null,
  name: 'Свічка',
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: null,
  salePriceMinor: null,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
  barcodes: [],
}

let shop: TestShop
let products: ProductService
let scope: EffectScope

beforeEach(async () => {
  // liveQuery does nothing without a global IndexedDB, which browsers have
  // and Node does not; the test databases get their own in-memory one.
  Dexie.dependencies.indexedDB = new IDBFactory()
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  shop = createTestShop('admin')
  products = new ProductService(shop.access)
  await shop.seed({ products: [serverProduct(FILTER, { name: 'Фільтр' })] })
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  shop.db.close()
})

// Runs useLiveQuery inside the test's effect scope.
const watchQuery = <T>(query: () => Promise<T>, sources: Parameters<typeof useLiveQuery>[1] = []) => {
  const result = scope.run(() => useLiveQuery(query, sources))
  if (!result) throw new Error('The effect scope is stopped')
  return result
}

const names = (data: { value: { name: string }[] | undefined }): string[] | undefined => data.value?.map((row) => row.name)

describe('useLiveQuery', () => {
  it('re-runs a service read after the user\'s own write', async () => {
    const { data } = watchQuery(() => products.list())
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Фільтр'])
    })

    await products.create(fields)
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Свічка', 'Фільтр'])
    })
  })

  it('re-runs after a pull writes a table directly', async () => {
    const { data } = watchQuery(() => products.list())
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Фільтр'])
    })

    await shop.context.repositories.products.put(serverProduct(testId(2), { name: 'Антифриз' }))
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Антифриз', 'Фільтр'])
    })
  })

  it('re-runs after a pull inside a transaction, as the sync engine writes', async () => {
    const { data } = watchQuery(() => products.list())
    await vi.waitFor(() => {
      expect(data.value?.[0]?.quantity).toBe(0)
    })

    await shop.context.transactions.run(async () => {
      await shop.context.repositories.movements.add(serverMovement(testId(30), FILTER, 4))
    })
    await vi.waitFor(() => {
      expect(data.value?.[0]?.quantity).toBe(4)
    })
  })

  it('re-runs when the outbox drops a rejected change', async () => {
    const { data } = watchQuery(() => products.list())
    await products.create(fields)
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Свічка', 'Фільтр'])
    })

    const [operation] = await shop.outbox()
    await shop.context.repositories.outbox.markRejected(operation?.id ?? '', 'forbidden')
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Фільтр'])
    })
  })

  it('starts over when a source changes', async () => {
    const id = ref(FILTER)
    const { data } = watchQuery(() => products.get(id.value), [id])
    await vi.waitFor(() => {
      expect(data.value?.product.name).toBe('Фільтр')
    })

    id.value = testId(99)
    await vi.waitFor(() => {
      expect(data.value).toBeUndefined()
    })
  })

  it('reports a failing read', async () => {
    shop.signOut()
    const { error } = watchQuery(() => products.list())
    await vi.waitFor(() => {
      expect(error.value).toMatchObject({ code: 'notSignedIn' })
    })
  })

  it('stops watching when its scope ends', async () => {
    const { data } = watchQuery(() => products.list())
    await vi.waitFor(() => {
      expect(names(data)).toStrictEqual(['Фільтр'])
    })
    scope.stop()

    await products.create(fields)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(data.value?.map((row) => row.name)).toStrictEqual(['Фільтр'])
  })
})
