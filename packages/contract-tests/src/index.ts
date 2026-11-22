// The shared RemoteGateway contract suite from SPEC.md ("Contract tests").
// Every adapter runs it against a real backend: Supabase now, the Node.js
// backend before cutover. It only talks to the gateway interface.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Operation, ProductFields, PullResponse, RemoteGateway } from '@auto-crm/core'

// Available in browsers and Node; declared here because this package has
// neither DOM nor Node types.
declare const crypto: { randomUUID: () => string }

export interface ContractUser {
  gateway: RemoteGateway // not signed in yet
  userId: string
  email: string
  password: string
}

export interface ContractShop {
  tenantId: string
  admin: ContractUser
  staff: ContractUser
}

export interface ContractHarness {
  // Provisions two new, empty shops, each with an active admin and staff.
  createShops: () => Promise<{ shopA: ContractShop, shopB: ContractShop }>
  // A gateway whose backend cannot be reached, as when the device is offline.
  createUnreachableGateway: () => RemoteGateway
  // Sets the shop's status to suspended, the platform owner's switch.
  suspendShop: (tenantId: string) => Promise<void>
}

const DEVICE_ID = '0190a5d0-0000-7000-8000-000000000001'

const newId = (): string => crypto.randomUUID()

const envelope = () => ({ id: newId(), clientTimestamp: new Date().toISOString(), deviceId: DEVICE_ID })

const productFields = (name: string, sku: string | null): ProductFields => ({
  sku,
  name,
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: 18_000,
  salePriceMinor: 25_000,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
})

const createProduct = (id: string, name: string, barcodes: string[] = [], sku: string | null = null): Operation => ({
  ...envelope(),
  type: 'product.create',
  payload: {
    id,
    ...productFields(name, sku),
    barcodes: barcodes.map((barcode) => ({ id: newId(), barcode, symbology: null })),
  },
})

const updateProduct = (id: string, name: string): Operation => ({
  ...envelope(),
  type: 'product.update',
  baseVersion: 1,
  payload: { id, changes: { name } },
})

const deleteProduct = (id: string): Operation => ({
  ...envelope(),
  type: 'product.delete',
  baseVersion: 1,
  payload: { id },
})

const createCategory = (id: string, name: string, parentId: string | null = null): Operation => ({
  ...envelope(),
  type: 'category.create',
  payload: { id, name, parentId },
})

const updateCategory = (id: string, changes: { name?: string, parentId?: string | null }): Operation => ({
  ...envelope(),
  type: 'category.update',
  baseVersion: 1,
  payload: { id, changes },
})

const moveStock = (productId: string, type: 'receive' | 'sale' | 'adjustment', quantityDelta: number, note: string | null = null): Operation => ({
  ...envelope(),
  type: 'stock.move',
  payload: {
    id: newId(),
    productId,
    type,
    quantityDelta,
    unitCostMinor: 18_000,
    unitPriceMinor: 25_000,
    currency: 'UAH',
    note,
    occurredAt: new Date().toISOString(),
  },
})

// "accepted", "duplicate" or the rejection reason of a single operation.
const outcome = async (gateway: RemoteGateway, operation: Operation): Promise<string | undefined> => {
  const { results } = await gateway.pushOperations({ operations: [operation] })
  const result = results[0]
  return result?.status === 'rejected' ? result.reason : result?.status
}

// Pulls every page from `cursor` and returns all batches.
const pullAll = async (gateway: RemoteGateway, cursor: string | null = null): Promise<PullResponse[]> => {
  const pages: PullResponse[] = []
  let page = await gateway.pullChanges({ cursor })
  pages.push(page)
  while (page.hasMore) {
    page = await gateway.pullChanges({ cursor: page.cursor })
    pages.push(page)
  }
  return pages
}

const productIds = (pages: PullResponse[]): string[] =>
  pages.flatMap((page) => page.changes.products.map((product) => product.id))

export const describeGatewayContract = (harness: ContractHarness): void => {
  describe('RemoteGateway contract', () => {
    let shopA: ContractShop
    let shopB: ContractShop

    beforeAll(async () => {
      ({ shopA, shopB } = await harness.createShops())
      for (const user of [shopA.admin, shopA.staff, shopB.admin, shopB.staff]) {
        await user.gateway.auth.signIn(user.email, user.password)
      }
    })

    describe('auth', () => {
      it('returns the signed-in session', async () => {
        const session = await shopA.staff.gateway.auth.getSession()
        expect(session?.userId).toBe(shopA.staff.userId)
        expect(session?.email).toBe(shopA.staff.email)
      })

      it('rejects a wrong password as invalid credentials', async () => {
        await expect(shopB.staff.gateway.auth.signIn(shopB.staff.email, 'wrong-password'))
          .rejects.toMatchObject({ name: 'GatewayError', code: 'invalidCredentials' })
      })

      it('changes the password of the signed-in user', async () => {
        const { gateway, email, password } = shopB.admin
        const newPassword = `${password}-new`
        await expect(gateway.auth.updatePassword(password)).rejects.toMatchObject({ code: 'samePassword' })
        await gateway.auth.updatePassword(newPassword)
        await expect(gateway.auth.signIn(email, password)).rejects.toMatchObject({ code: 'invalidCredentials' })
        await gateway.auth.signIn(email, newPassword)
        shopB.admin.password = newPassword
      })

      it('has no session after signing out, and can sign in again', async () => {
        const { gateway, email, password } = shopB.staff
        await gateway.auth.signOut()
        expect(await gateway.auth.getSession()).toBeNull()
        await expect(gateway.pullChanges({ cursor: null })).rejects.toMatchObject({ code: 'sessionExpired' })
        await expect(gateway.pushOperations({ operations: [createProduct(newId(), 'Signed out')] }))
          .rejects.toMatchObject({ code: 'sessionExpired' })
        await gateway.auth.signIn(email, password)
        expect((await gateway.auth.getSession())?.userId).toBe(shopB.staff.userId)
      })
    })

    describe('errors', () => {
      it('reports an unreachable backend as a network error', async () => {
        await expect(harness.createUnreachableGateway().pullChanges({ cursor: null }))
          .rejects.toMatchObject({ name: 'GatewayError', code: 'network' })
      })

      it('reports a suspended shop as access denied', async () => {
        const { shopA: suspended } = await harness.createShops()
        await suspended.staff.gateway.auth.signIn(suspended.staff.email, suspended.staff.password)
        await harness.suspendShop(suspended.tenantId)
        await expect(suspended.staff.gateway.pullChanges({ cursor: null }))
          .rejects.toMatchObject({ name: 'GatewayError', code: 'accessDenied' })
      })
    })

    describe('bootstrap', () => {
      it('returns the caller\'s shop, profile and role', async () => {
        const { tenant, profile, membership } = await shopA.staff.gateway.bootstrap()
        expect(tenant.id).toBe(shopA.tenantId)
        expect(profile.id).toBe(shopA.staff.userId)
        expect(membership.role).toBe('staff')
      })
    })

    describe('tenant isolation', () => {
      const productA = newId()
      const productB = newId()

      beforeAll(async () => {
        expect(await outcome(shopA.admin.gateway, createProduct(productA, 'Product A'))).toBe('accepted')
        expect(await outcome(shopB.admin.gateway, createProduct(productB, 'Product B'))).toBe('accepted')
      })

      it('a user of shop A never reads shop B', async () => {
        const ids = productIds(await pullAll(shopA.staff.gateway))
        expect(ids).toContain(productA)
        expect(ids).not.toContain(productB)
      })

      it('a user of shop B never reads shop A', async () => {
        const ids = productIds(await pullAll(shopB.staff.gateway))
        expect(ids).toContain(productB)
        expect(ids).not.toContain(productA)
      })

      it('a user of shop A cannot change shop B', async () => {
        expect(await outcome(shopA.admin.gateway, updateProduct(productB, 'Hacked'))).toBe('notFound')
        expect(await outcome(shopA.admin.gateway, moveStock(productB, 'receive', 1))).toBe('notFound')
        const productInB = (await pullAll(shopB.admin.gateway)).flatMap((page) => page.changes.products).find((p) => p.id === productB)
        expect(productInB?.name).toBe('Product B')
      })
    })

    describe('role table', () => {
      const productId = newId()

      beforeAll(async () => {
        expect(await outcome(shopA.admin.gateway, createProduct(productId, 'Role test'))).toBe('accepted')
      })

      it.each([
        ['staff', 'creates a product', 'accepted', () => createProduct(newId(), 'By staff')],
        ['staff', 'records a sale', 'accepted', () => moveStock(productId, 'sale', -1)],
        ['staff', 'edits a product', 'forbidden', () => updateProduct(productId, 'Edited')],
        ['staff', 'deletes a product', 'forbidden', () => deleteProduct(productId)],
        ['staff', 'records an adjustment', 'forbidden', () => moveStock(productId, 'adjustment', 1, 'Перерахунок')],
        ['staff', 'creates a category', 'forbidden', () => createCategory(newId(), 'By staff')],
        ['admin', 'creates a category', 'accepted', () => createCategory(newId(), 'By admin')],
        ['admin', 'edits a product', 'accepted', () => updateProduct(productId, 'Edited')],
        ['admin', 'records an adjustment', 'accepted', () => moveStock(productId, 'adjustment', 1, 'Перерахунок')],
      ] as const)('%s %s: %s', async (role, _, expected, operation) => {
        expect(await outcome(shopA[role].gateway, operation())).toBe(expected)
      })
    })

    describe('categories', () => {
      it('a nested category arrives through pull', async () => {
        const parent = newId()
        const child = newId()
        expect(await outcome(shopA.admin.gateway, createCategory(parent, 'Оливи'))).toBe('accepted')
        expect(await outcome(shopA.admin.gateway, createCategory(child, 'Моторні', parent))).toBe('accepted')

        const categories = (await pullAll(shopA.staff.gateway)).flatMap((page) => page.changes.categories)
        expect(categories.find((category) => category.id === child)?.parentId).toBe(parent)
      })

      it('rejects a move under the category\'s own descendant', async () => {
        const parent = newId()
        const child = newId()
        await outcome(shopA.admin.gateway, createCategory(parent, 'Фільтри'))
        await outcome(shopA.admin.gateway, createCategory(child, 'Масляні', parent))
        expect(await outcome(shopA.admin.gateway, updateCategory(parent, { parentId: child }))).toBe('categoryCycle')
      })

      it('a user of shop A cannot read or change shop B categories', async () => {
        const categoryB = newId()
        expect(await outcome(shopB.admin.gateway, createCategory(categoryB, 'Category B'))).toBe('accepted')
        expect(await outcome(shopA.admin.gateway, updateCategory(categoryB, { name: 'Hacked' }))).toBe('notFound')
        expect(await outcome(shopA.admin.gateway, createCategory(newId(), 'Sneaky', categoryB))).toBe('notFound')
        const idsInA = (await pullAll(shopA.staff.gateway)).flatMap((page) => page.changes.categories.map((category) => category.id))
        expect(idsInA).not.toContain(categoryB)
      })
    })

    describe('repeated operations', () => {
      it('applies an operation once and reports repeats as duplicates', async () => {
        const productId = newId()
        await outcome(shopA.admin.gateway, createProduct(productId, 'Duplicate test'))
        const receive = moveStock(productId, 'receive', 3)

        expect(await outcome(shopA.staff.gateway, receive)).toBe('accepted')
        expect(await outcome(shopA.staff.gateway, receive)).toBe('duplicate')

        const movements = (await pullAll(shopA.staff.gateway))
          .flatMap((page) => page.changes.stockMovements)
          .filter((movement) => movement.productId === productId)
        expect(movements).toHaveLength(1)
      })
    })

    describe('tombstones', () => {
      it('a deleted product arrives as a tombstone after the cursor', async () => {
        const productId = newId()
        await outcome(shopA.admin.gateway, createProduct(productId, 'Tombstone test'))
        const { cursor } = (await pullAll(shopA.staff.gateway)).at(-1) ?? { cursor: null }

        expect(await outcome(shopA.admin.gateway, deleteProduct(productId))).toBe('accepted')

        const changed = (await pullAll(shopA.staff.gateway, cursor)).flatMap((page) => page.changes.products)
        expect(changed).toHaveLength(1)
        expect(changed[0]?.id).toBe(productId)
        expect(changed[0]?.deletedAt).not.toBeNull()
      })
    })

    describe('barcode conflicts', () => {
      it('rejects a barcode that already belongs to another product', async () => {
        expect(await outcome(shopA.admin.gateway, createProduct(newId(), 'First', ['4820000000017']))).toBe('accepted')
        expect(await outcome(shopA.staff.gateway, createProduct(newId(), 'Second', ['4820000000017']))).toBe('barcodeConflict')
      })

      it('allows the same barcode in another shop', async () => {
        expect(await outcome(shopB.admin.gateway, createProduct(newId(), 'Other shop', ['4820000000017']))).toBe('accepted')
      })
    })

    describe('cursor paging', () => {
      it('pages through more rows than one batch without gaps or repeats', async () => {
        const created = Array.from({ length: 1001 }, () => newId())
        const { results } = await shopB.admin.gateway.pushOperations({
          operations: created.map((id, i) => createProduct(id, `Paging ${String(i)}`)),
        })
        expect(results.every((result) => result.status === 'accepted')).toBe(true)

        const pages = await pullAll(shopB.staff.gateway)
        expect(pages.length).toBeGreaterThan(1)
        const ids = productIds(pages)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toEqual(expect.arrayContaining(created))

        const last = pages.at(-1)
        const empty = await shopB.staff.gateway.pullChanges({ cursor: last?.cursor ?? null })
        expect(empty.hasMore).toBe(false)
        expect(empty.cursor).toBe(last?.cursor)
        expect(empty.changes.products).toHaveLength(0)
      })
    })
  })
}
