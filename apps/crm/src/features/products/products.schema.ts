import { IdSchema, ProductUnitSchema } from '@auto-crm/core'
import { z } from 'zod'

// zod schemas for the product forms: they turn what the user typed into the
// product service's input. The service validates again.

// Spaces (including the narrow ones Intl puts in numbers) are ignored, and a
// comma or a dot separates the decimals.
const numberText = (maxDecimals: number) =>
  z.string().transform((text) => text.replace(/\s/g, '').replace(',', '.'))
    .refine((text) => text === '' || new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`).test(text))

// Hryvnias as typed, e.g. "250,50", to kopiykas. Blank is no price.
const MoneyText = numberText(2).transform((text) => {
  if (text === '') return null
  const [whole = '0', fraction = ''] = text.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
})

// A quantity with up to three decimals. Blank is none.
const QuantityText = numberText(3).transform((text) => (text === '' ? null : Number(text)))

// Trimmed text; blank is none.
const OptionalText = z.string().trim().transform((text) => (text === '' ? null : text))

export const ProductFormSchema = z.object({
  name: z.string().trim().min(1),
  sku: OptionalText,
  description: OptionalText,
  categoryId: IdSchema.nullable(),
  unit: ProductUnitSchema,
  costPrice: MoneyText,
  salePrice: MoneyText,
  minStock: QuantityText,
  locationNote: OptionalText,
}).transform(({ costPrice, salePrice, ...fields }) => ({
  ...fields,
  costPriceMinor: costPrice,
  salePriceMinor: salePrice,
}))

export type ProductForm = z.input<typeof ProductFormSchema>

export const BarcodeTextSchema = z.string().trim().min(1)

// The form's fields as text, for editing an existing product.
export const toMoneyText = (minor: number | null): string =>
  minor === null ? '' : `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, '0')}`

export const toQuantityText = (quantity: number | null): string =>
  quantity === null ? '' : String(quantity).replace('.', ',')

// The names of the fields that failed, e.g. { salePrice: true }.
export const invalidFields = (error: z.ZodError): Partial<Record<string, true>> =>
  Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), true]))
