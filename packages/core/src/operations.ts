import { z } from 'zod'
import {
  BarcodeFieldsSchema,
  CategoryFieldsSchema,
  MovementFieldsSchema,
  ProductFieldsSchema,
} from './entities'
import { IdSchema, UtcTimestampSchema } from './primitives'
import type { Capability } from './roles'
import type { MovementType } from './stock'
import { validateMovement } from './stock'

// Fields every outbox operation carries. The server dedupes on `id`.
// `tenant_id` is never sent: the server takes it from the user's membership.
const envelope = {
  id: IdSchema,
  clientTimestamp: UtcTimestampSchema,
  deviceId: IdSchema,
}

// The version of the row the edit was based on. Product edits are last write
// wins, so the server uses it for the audit log, not to reject.
const baseVersion = z.int().positive()

// Barcodes go with the create, so a product made from an unknown scan arrives
// in one operation.
const ProductCreateSchema = z.object({
  ...envelope,
  type: z.literal('product.create'),
  payload: z.object({
    id: IdSchema,
    ...ProductFieldsSchema.shape,
    barcodes: z.array(z.object({ id: IdSchema, ...BarcodeFieldsSchema.shape })),
  }),
})

const ProductUpdateSchema = z.object({
  ...envelope,
  type: z.literal('product.update'),
  baseVersion,
  payload: z.object({
    id: IdSchema,
    changes: ProductFieldsSchema.partial().refine(
      (changes) => Object.keys(changes).length > 0,
      { message: 'An update must change at least one field' },
    ),
  }),
})

const ProductDeleteSchema = z.object({
  ...envelope,
  type: z.literal('product.delete'),
  baseVersion,
  payload: z.object({ id: IdSchema }),
})

const ProductRestoreSchema = z.object({
  ...envelope,
  type: z.literal('product.restore'),
  baseVersion,
  payload: z.object({ id: IdSchema }),
})

const BarcodeAddSchema = z.object({
  ...envelope,
  type: z.literal('barcode.add'),
  payload: z.object({ id: IdSchema, productId: IdSchema, ...BarcodeFieldsSchema.shape }),
})

const BarcodeRemoveSchema = z.object({
  ...envelope,
  type: z.literal('barcode.remove'),
  payload: z.object({ id: IdSchema }),
})

const StockMoveSchema = z.object({
  ...envelope,
  type: z.literal('stock.move'),
  payload: z
    .object({ id: IdSchema, ...MovementFieldsSchema.shape })
    .superRefine((movement, ctx) => {
      const error = validateMovement(movement)
      if (error !== null) ctx.addIssue({ code: 'custom', message: error, path: ['quantityDelta'] })
    }),
})

const CategoryCreateSchema = z.object({
  ...envelope,
  type: z.literal('category.create'),
  payload: z.object({ id: IdSchema, ...CategoryFieldsSchema.shape }),
})

// Edits are last write wins like products. A move that would put a category
// under one of its own descendants needs the whole tree, so the service checks
// it with createsCategoryCycle and the server re-checks it at push time.
const CategoryUpdateSchema = z.object({
  ...envelope,
  type: z.literal('category.update'),
  baseVersion,
  payload: z
    .object({
      id: IdSchema,
      changes: CategoryFieldsSchema.partial().refine(
        (changes) => Object.keys(changes).length > 0,
        { message: 'An update must change at least one field' },
      ),
    })
    .refine(({ id, changes }) => changes.parentId !== id, {
      message: 'A category cannot be its own parent',
      path: ['changes', 'parentId'],
    }),
})

// Products and subcategories keep pointing at a deleted category, so a
// restore brings the tree back as it was.
const CategoryDeleteSchema = z.object({
  ...envelope,
  type: z.literal('category.delete'),
  baseVersion,
  payload: z.object({ id: IdSchema }),
})

const CategoryRestoreSchema = z.object({
  ...envelope,
  type: z.literal('category.restore'),
  baseVersion,
  payload: z.object({ id: IdSchema }),
})

export const OperationSchema = z.discriminatedUnion('type', [
  CategoryCreateSchema,
  CategoryUpdateSchema,
  CategoryDeleteSchema,
  CategoryRestoreSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  ProductDeleteSchema,
  ProductRestoreSchema,
  BarcodeAddSchema,
  BarcodeRemoveSchema,
  StockMoveSchema,
])
export type Operation = z.infer<typeof OperationSchema>
export type OperationType = Operation['type']

const MOVEMENT_CAPABILITY: Record<MovementType, Capability> = {
  receive: 'recordMovement',
  sale: 'recordMovement',
  consume: 'recordMovement',
  // Setting a starting count can stand in for an adjustment, so it is
  // admin-only. Staff record new stock as `receive`.
  initial: 'adjustStock',
  adjustment: 'adjustStock',
  write_off: 'adjustStock',
}

// The capability the server checks at push time before applying `operation`.
export const requiredCapability = (operation: Operation): Capability => {
  switch (operation.type) {
    case 'category.create':
    case 'category.update':
    case 'category.delete':
    case 'category.restore':
      return 'manageCategories'
    case 'product.create':
      return 'createProduct'
    case 'barcode.add':
      return 'addBarcode'
    case 'product.update':
    case 'barcode.remove':
      return 'editProduct'
    case 'product.delete':
    case 'product.restore':
      return 'deleteProduct'
    case 'stock.move':
      return MOVEMENT_CAPABILITY[operation.payload.type]
  }
}
