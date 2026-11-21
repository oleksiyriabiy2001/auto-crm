import { z } from 'zod'

export const MovementTypeSchema = z.enum([
  'initial',
  'receive',
  'sale',
  'consume',
  'adjustment',
  'write_off',
])
export type MovementType = z.infer<typeof MovementTypeSchema>

type Sign = 'positive' | 'negative' | 'either'

const SIGNS: Record<MovementType, Sign> = {
  initial: 'positive',
  receive: 'positive',
  sale: 'negative',
  consume: 'negative',
  adjustment: 'either',
  write_off: 'negative',
}

export type MovementError = 'zeroQuantity' | 'wrongSign' | 'noteRequired'

export interface MovementInput {
  type: MovementType
  quantityDelta: number
  note: string | null
}

// Returns why a movement breaks the ledger rules, or null if it is valid.
export const validateMovement = ({ type, quantityDelta, note }: MovementInput): MovementError | null => {
  if (quantityDelta === 0) return 'zeroQuantity'
  const sign = SIGNS[type]
  if (sign === 'positive' && quantityDelta < 0) return 'wrongSign'
  if (sign === 'negative' && quantityDelta > 0) return 'wrongSign'
  if (type === 'adjustment' && (note === null || note.trim() === '')) return 'noteRequired'
  return null
}

// Quantities have three decimals, so sums run on integer thousandths to avoid
// float drift (0.1 + 0.2 must be 0.3).
const SCALE = 1000
const toThousandths = (quantity: number): number => Math.round(quantity * SCALE)

export const sumStock = (movements: readonly { quantityDelta: number }[]): number =>
  movements.reduce((total, m) => total + toThousandths(m.quantityDelta), 0) / SCALE

// Negative stock is allowed and flagged, never rejected.
export const isNegativeStock = (quantity: number): boolean => quantity < 0

// At or below the threshold counts as low. No threshold means never low.
export const isLowStock = (quantity: number, minStock: number | null): boolean =>
  minStock !== null && quantity <= minStock
