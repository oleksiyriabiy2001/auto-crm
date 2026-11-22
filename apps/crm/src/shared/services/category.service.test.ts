import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CategoryService } from './category.service'
import type { TestShop } from './test-shop'
import { createTestShop, serverCategory, TEST_DEVICE, TEST_NOW, testId } from './test-shop'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

// Оливи (1)
// └─ Моторні (2)
//    └─ Синтетика (3)
// Фільтри (4), deleted (5)
const OILS = testId(1)
const MOTOR = testId(2)
const SYNTHETIC = testId(3)
const FILTERS = testId(4)
const DELETED = testId(5)

let shop: TestShop
let service: CategoryService

beforeEach(async () => {
  shop = createTestShop('admin')
  service = new CategoryService(shop.access)
  await shop.seed({
    categories: [
      serverCategory(OILS, { name: 'Оливи' }),
      serverCategory(MOTOR, { name: 'Моторні', parentId: OILS }),
      serverCategory(SYNTHETIC, { name: 'Синтетика', parentId: MOTOR }),
      serverCategory(FILTERS, { name: 'Фільтри' }),
      serverCategory(DELETED, { name: 'Архів', deletedAt: '2026-11-21T09:00:00.000Z' }),
    ],
  })
})

afterEach(() => {
  shop.db.close()
})

describe('CategoryService', () => {
  it('creates a category: one operation in the outbox, a sync request, and the new row in the list', async () => {
    const id = await service.create({ name: '  Гальма  ', parentId: null })

    expect(await shop.outbox()).toStrictEqual([{
      id: expect.any(String),
      clientTimestamp: TEST_NOW,
      deviceId: TEST_DEVICE,
      type: 'category.create',
      payload: { id, name: 'Гальма', parentId: null },
    }])
    expect(shop.syncRequests()).toBe(1)
    expect((await service.list()).map((row) => [row.name, row.pending])).toStrictEqual([
      ['Гальма', true],
      ['Оливи', false],
      ['Моторні', false],
      ['Синтетика', false],
      ['Фільтри', false],
    ])
  })

  it('lists in tree order with each category\'s path, through deleted parents too', async () => {
    expect((await service.list()).map((row) => row.path)).toStrictEqual([
      ['Оливи'],
      ['Оливи', 'Моторні'],
      ['Оливи', 'Моторні', 'Синтетика'],
      ['Фільтри'],
    ])
    await service.delete(MOTOR)
    expect((await service.list()).find((row) => row.id === SYNTHETIC)?.path).toStrictEqual(['Оливи', 'Моторні', 'Синтетика'])
  })

  it('lists deleted categories apart from live ones', async () => {
    expect((await service.listDeleted()).map((row) => row.id)).toStrictEqual([DELETED])
  })

  it('refuses invalid input without touching the outbox', async () => {
    await expect(service.create({ name: '   ', parentId: null })).rejects.toMatchObject({ code: 'invalid' })
    expect(await shop.outbox()).toStrictEqual([])
    expect(shop.syncRequests()).toBe(0)
  })

  it('needs a live parent', async () => {
    await expect(service.create({ name: 'Нова', parentId: DELETED })).rejects.toMatchObject({ code: 'notFound' })
    await expect(service.create({ name: 'Нова', parentId: testId(99) })).rejects.toMatchObject({ code: 'notFound' })
  })

  it('accepts a parent created on this device that is not synced yet', async () => {
    const parent = await service.create({ name: 'Гальма', parentId: null })
    await service.create({ name: 'Колодки', parentId: parent })
    expect(await shop.outbox()).toHaveLength(2)
  })

  it('refuses staff', async () => {
    const staff = createTestShop('staff')
    await expect(new CategoryService(staff.access).create({ name: 'Гальма', parentId: null })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await staff.outbox()).toStrictEqual([])
    staff.db.close()
  })

  it('refuses when no shop is open', async () => {
    shop.signOut()
    await expect(service.list()).rejects.toMatchObject({ code: 'notSignedIn' })
  })

  it('sends only the fields that change, based on the row version', async () => {
    await service.update(FILTERS, { name: 'Фільтри', parentId: OILS })
    expect(await shop.outbox()).toStrictEqual([expect.objectContaining({
      type: 'category.update',
      baseVersion: 2,
      payload: { id: FILTERS, changes: { parentId: OILS } },
    })])
  })

  it('adds no operation for an edit that changes nothing', async () => {
    await service.update(FILTERS, { name: 'Фільтри' })
    expect(await shop.outbox()).toStrictEqual([])
    expect(shop.syncRequests()).toBe(0)
  })

  it('refuses a move under its own descendant', async () => {
    await expect(service.update(OILS, { parentId: SYNTHETIC })).rejects.toMatchObject({ code: 'categoryCycle' })
    await expect(service.update(OILS, { parentId: OILS })).rejects.toMatchObject({ code: 'categoryCycle' })
  })

  it('checks cycles against unsynced moves too', async () => {
    await service.update(FILTERS, { parentId: SYNTHETIC })
    await expect(service.update(OILS, { parentId: FILTERS })).rejects.toMatchObject({ code: 'categoryCycle' })
  })

  it('refuses to edit a category that does not exist', async () => {
    await expect(service.update(testId(99), { name: 'Нова' })).rejects.toMatchObject({ code: 'notFound' })
  })

  it('deletes and restores, and does nothing when already in that state', async () => {
    await service.delete(FILTERS)
    await service.delete(FILTERS)
    await service.restore(DELETED)
    await service.restore(DELETED)
    await service.restore(OILS)

    expect((await shop.outbox()).map((operation) => [operation.type, operation.payload.id])).toStrictEqual([
      ['category.delete', FILTERS],
      ['category.restore', DELETED],
    ])
    expect((await service.list()).map((row) => row.id)).toContain(DELETED)
    expect((await service.listDeleted()).map((row) => row.id)).toStrictEqual([FILTERS])
  })
})
