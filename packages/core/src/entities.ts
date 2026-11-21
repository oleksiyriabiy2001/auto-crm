import { z } from 'zod'
import {
  CurrencySchema,
  IdSchema,
  MoneyMinorSchema,
  QuantitySchema,
  TextSchema,
  UtcTimestampSchema,
} from './primitives'
import { RoleSchema } from './roles'
import { MovementTypeSchema } from './stock'

// Columns every synced table carries. `server_seq` stays in the database and
// the adapter: core only sees it through the opaque pull cursor.
const syncedRow = {
  id: IdSchema,
  tenantId: IdSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  deletedAt: UtcTimestampSchema.nullable(),
  version: z.int().positive(),
}

export const TenantSchema = z.object({
  id: IdSchema,
  name: TextSchema,
  status: z.enum(['active', 'suspended']),
})
export type Tenant = z.infer<typeof TenantSchema>

export const ProfileSchema = z.object({
  id: IdSchema,
  displayName: TextSchema,
})
export type Profile = z.infer<typeof ProfileSchema>

export const MembershipSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  userId: IdSchema,
  role: RoleSchema,
  isActive: z.boolean(),
})
export type Membership = z.infer<typeof MembershipSchema>

export const CategorySchema = z.object({
  ...syncedRow,
  name: TextSchema,
  parentId: IdSchema.nullable(),
})
export type Category = z.infer<typeof CategorySchema>

export const ProductUnitSchema = z.enum(['pcs', 'l', 'kg', 'set', 'm'])
export type ProductUnit = z.infer<typeof ProductUnitSchema>

// The fields a user edits. Shared by the product row and its operations.
export const ProductFieldsSchema = z.object({
  sku: TextSchema.nullable(),
  name: TextSchema,
  description: TextSchema.nullable(),
  categoryId: IdSchema.nullable(),
  unit: ProductUnitSchema,
  costPriceMinor: MoneyMinorSchema.nullable(),
  salePriceMinor: MoneyMinorSchema.nullable(),
  currency: CurrencySchema,
  minStock: QuantitySchema.min(0).nullable(),
  locationNote: TextSchema.nullable(),
  isActive: z.boolean(),
})
export type ProductFields = z.infer<typeof ProductFieldsSchema>

export const ProductSchema = z.object({
  ...syncedRow,
  ...ProductFieldsSchema.shape,
})
export type Product = z.infer<typeof ProductSchema>

export const BarcodeSymbologySchema = z.enum(['ean13', 'ean8', 'upca', 'code128'])

// The fields of a barcode. Shared by the barcode row and its operations.
export const BarcodeFieldsSchema = z.object({
  barcode: TextSchema,
  // Null when unknown, e.g. imported from CSV.
  symbology: BarcodeSymbologySchema.nullable(),
})

export const ProductBarcodeSchema = z.object({
  ...syncedRow,
  productId: IdSchema,
  ...BarcodeFieldsSchema.shape,
})
export type ProductBarcode = z.infer<typeof ProductBarcodeSchema>

// The fields a device records for a movement. Price and cost are copied in,
// so history stays correct when the product changes later.
export const MovementFieldsSchema = z.object({
  productId: IdSchema,
  type: MovementTypeSchema,
  quantityDelta: QuantitySchema,
  unitCostMinor: MoneyMinorSchema.nullable(),
  unitPriceMinor: MoneyMinorSchema.nullable(),
  currency: CurrencySchema,
  note: TextSchema.nullable(),
  occurredAt: UtcTimestampSchema,
})

export const StockMovementSchema = z.object({
  ...syncedRow,
  ...MovementFieldsSchema.shape,
  createdBy: IdSchema,
  deviceId: IdSchema,
  // Empty in v1. Later a work order points its consumed parts here.
  sourceType: TextSchema.nullable(),
  sourceId: IdSchema.nullable(),
})
export type StockMovement = z.infer<typeof StockMovementSchema>

// Written by the server only.
export const AuditLogEntrySchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  actorId: IdSchema,
  entity: TextSchema,
  entityId: IdSchema,
  action: TextSchema,
  changes: z.record(z.string(), z.unknown()),
  at: UtcTimestampSchema,
})
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>
