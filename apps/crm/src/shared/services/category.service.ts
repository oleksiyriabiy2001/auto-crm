import type { Category, Id, Overlaid, OverlaidCatalog } from '@auto-crm/core'
import { CategoryFieldsSchema, createsCategoryCycle } from '@auto-crm/core'
import type { z } from 'zod'

import { ServiceError } from './service-error'
import type { ShopAccess } from './shop-access'
import { shopAccess } from './shop-access'

export type CategoryInput = z.input<typeof CategoryFieldsSchema>

// A category as the screens show it: unsynced changes applied, with the names
// from the top of the tree down to it, e.g. ["Оливи", "Моторні"].
export type CategoryView = Overlaid<Category> & { path: string[] }

// Tree order: a category comes right before its subcategories.
const byPath = (a: CategoryView, b: CategoryView): number => {
  for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
    const order = (a.path[i] ?? '').localeCompare(b.path[i] ?? '', 'uk')
    if (order !== 0) return order
  }
  return a.path.length - b.path.length
}

// Paths run through deleted parents too, so a category keeps its place in the
// tree while its parent is deleted.
const withPaths = (categories: readonly Overlaid<Category>[]): CategoryView[] => {
  const byId = new Map(categories.map((category) => [category.id, category]))
  return categories.map((category) => {
    const path = [category.name]
    let parent = category.parentId === null ? undefined : byId.get(category.parentId)
    // Capped so a broken tree cannot loop.
    for (let steps = 0; parent && steps < categories.length; steps++) {
      path.unshift(parent.name)
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
    }
    return { ...category, path }
  })
}

const find = (catalog: OverlaidCatalog, id: Id): Overlaid<Category> => {
  const category = catalog.categories.find((row) => row.id === id)
  if (!category) throw new ServiceError('notFound')
  return category
}

// A new parent must be a live category of the shop.
const checkParent = (catalog: OverlaidCatalog, parentId: Id | null): void => {
  if (parentId !== null && find(catalog, parentId).deletedAt !== null) throw new ServiceError('notFound')
}

// Categories use cases. Writes go to the outbox; reads show the server's rows
// with the user's unsynced changes on top.
export class CategoryService {
  constructor(private readonly shop: ShopAccess) {}

  // Live categories, in tree order.
  async list(): Promise<CategoryView[]> {
    return (await this.all()).filter((row) => row.deletedAt === null).sort(byPath)
  }

  // Deleted categories an admin can restore, in tree order.
  async listDeleted(): Promise<CategoryView[]> {
    return (await this.all()).filter((row) => row.deletedAt !== null).sort(byPath)
  }

  // Returns the new category's id.
  async create(input: CategoryInput): Promise<Id> {
    const fields = this.shop.parse(CategoryFieldsSchema, input)
    const id = this.shop.newId()
    await this.shop.submit((_context, catalog) => {
      checkParent(catalog, fields.parentId)
      return { type: 'category.create', payload: { id, ...fields } }
    })
    return id
  }

  // Renames or moves a category. Sends only the fields that change; an edit
  // that changes nothing adds no operation.
  async update(id: Id, input: Partial<CategoryInput>): Promise<void> {
    const changes = this.shop.parse(CategoryFieldsSchema.partial(), input)
    await this.shop.submit((_context, catalog) => {
      const category = find(catalog, id)
      const changed: Partial<z.output<typeof CategoryFieldsSchema>> = {}
      if (changes.name !== undefined && changes.name !== category.name) changed.name = changes.name
      if (changes.parentId !== undefined && changes.parentId !== category.parentId) {
        checkParent(catalog, changes.parentId)
        if (createsCategoryCycle(catalog.categories, id, changes.parentId)) throw new ServiceError('categoryCycle')
        changed.parentId = changes.parentId
      }
      if (Object.keys(changed).length === 0) return null
      return { type: 'category.update', baseVersion: category.version, payload: { id, changes: changed } }
    })
  }

  // Products and subcategories keep pointing at it, so a restore brings the
  // tree back. Deleting a deleted category changes nothing.
  async delete(id: Id): Promise<void> {
    await this.shop.submit((_context, catalog) => {
      const category = find(catalog, id)
      if (category.deletedAt !== null) return null
      return { type: 'category.delete', baseVersion: category.version, payload: { id } }
    })
  }

  // Restoring a live category changes nothing.
  async restore(id: Id): Promise<void> {
    await this.shop.submit((_context, catalog) => {
      const category = find(catalog, id)
      if (category.deletedAt === null) return null
      return { type: 'category.restore', baseVersion: category.version, payload: { id } }
    })
  }

  private async all(): Promise<CategoryView[]> {
    const context = this.shop.context()
    return withPaths((await this.shop.catalog(context, await this.shop.unconfirmed(context))).categories)
  }
}

export const categoryService = new CategoryService(shopAccess)
