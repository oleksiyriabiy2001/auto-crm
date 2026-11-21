import { z } from 'zod'

// Client-generated UUID (v7 preferred). Login ids come from the auth provider
// and may be other versions, so any UUID is accepted.
export const IdSchema = z.uuid()
export type Id = z.infer<typeof IdSchema>

// ISO 8601 in UTC with a trailing `Z`. Offsets are rejected; adapters
// normalise server timestamps before they reach core.
export const UtcTimestampSchema = z.iso.datetime()
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>

// Money is an integer in minor units (kopiykas).
export const MoneyMinorSchema = z.int().nonnegative()

export const CurrencySchema = z.enum(['UAH'])
export type Currency = z.infer<typeof CurrencySchema>

// Quantities have at most three decimals and fit Postgres numeric(12,3).
const QUANTITY_LIMIT = 999_999_999.999
const hasAtMostThreeDecimals = (value: number): boolean => Number(value.toFixed(3)) === value

export const QuantitySchema = z
  .number()
  .min(-QUANTITY_LIMIT)
  .max(QUANTITY_LIMIT)
  .refine(hasAtMostThreeDecimals, { message: 'Quantity has more than three decimals' })

// A trimmed, non-empty string.
export const TextSchema = z.string().trim().min(1)
