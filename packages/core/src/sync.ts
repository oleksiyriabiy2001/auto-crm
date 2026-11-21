import { z } from 'zod'
import {
  CategorySchema,
  MembershipSchema,
  ProductBarcodeSchema,
  ProductSchema,
  ProfileSchema,
  StockMovementSchema,
  TenantSchema,
} from './entities'
import { IdSchema } from './primitives'
import { OperationSchema } from './operations'

// The sync contract from SPEC.md. Adapters and the server-side unit that
// applies operations both validate against these schemas.

export const PushRequestSchema = z.object({
  operations: z.array(OperationSchema).min(1),
})
export type PushRequest = z.infer<typeof PushRequestSchema>

export const RejectReasonSchema = z.enum([
  'forbidden', // the role does not allow it (re-checked at push time)
  'tenantSuspended',
  'barcodeConflict', // the barcode already belongs to another product
  'skuConflict', // another product in the shop already has this SKU
  'notFound',
  'invalidPayload',
])
export type RejectReason = z.infer<typeof RejectReasonSchema>

export const PushResultSchema = z.discriminatedUnion('status', [
  z.object({ operationId: IdSchema, status: z.literal('accepted') }),
  z.object({ operationId: IdSchema, status: z.literal('duplicate') }),
  z.object({ operationId: IdSchema, status: z.literal('rejected'), reason: RejectReasonSchema }),
])
export type PushResult = z.infer<typeof PushResultSchema>

export const PushResponseSchema = z.object({
  results: z.array(PushResultSchema),
})
export type PushResponse = z.infer<typeof PushResponseSchema>

// Opaque to the device: it stores the cursor and sends it back. Each backend
// encodes it its own way (Supabase: the last `server_seq`).
export const CursorSchema = z.string().min(1)
export type Cursor = z.infer<typeof CursorSchema>

export const PullRequestSchema = z.object({
  // Null pulls from the beginning, which is how a new device downloads the shop.
  cursor: CursorSchema.nullable(),
})
export type PullRequest = z.infer<typeof PullRequestSchema>

// Changed rows since the cursor, tombstones included (`deletedAt` set).
// `hasMore` means the server capped the batch: pull again with the new cursor.
export const PullResponseSchema = z.object({
  changes: z.object({
    categories: z.array(CategorySchema),
    products: z.array(ProductSchema),
    productBarcodes: z.array(ProductBarcodeSchema),
    stockMovements: z.array(StockMovementSchema),
  }),
  cursor: CursorSchema,
  hasMore: z.boolean(),
})
export type PullResponse = z.infer<typeof PullResponseSchema>

// Who the signed-in user is and which shop they work in. The shop's data
// then arrives through `pull` starting from a null cursor.
export const BootstrapResponseSchema = z.object({
  tenant: TenantSchema,
  profile: ProfileSchema,
  membership: MembershipSchema,
})
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>
