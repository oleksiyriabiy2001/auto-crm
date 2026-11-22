import type { Category, Id, Overlaid, OverlaidCatalog } from '@auto-crm/core'
import { CategoryFieldsSchema, createsCategoryCycle } from '@auto-crm/core'
import type { z } from 'zod'

import { ServiceError } from './service-error'
import type { ShopAccess } from './shop-access'
import { shopAccess } from './shop-access'

export type CategoryInput = z.input<typeof CategoryFieldsSchema>

const byName = (a: Category, b: Category): number => a.name.localeCompare(b.name, 'uk')

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

  // Live categories, by name.
  async list(): Promise<Overlaid<Category>[]> {
    return (await this.all()).filter((row) => row.deletedAt === null).sort(byName)
  }

  // Deleted categories an admin can restore, by name.
  async listDeleted(): Promise<Overlaid<Category>[]> {
    return (await this.all()).filter((row) => row.deletedAt !== null).sort(byName)
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

  private async all(): Promise<Overlaid<Category>[]> {
    const context = this.shop.context()
    return (await this.shop.catalog(context, await this.shop.unconfirmed(context))).categories
  }
}

export const categoryService = new CategoryService(shopAccess)
