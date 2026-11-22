import { describe, expect, it } from 'vitest'

import type { ProductForm } from './products.schema'
import { invalidFields, ProductFormSchema, toMoneyText, toQuantityText } from './products.schema'

const form: ProductForm = {
  name: ' Фільтр масляний ',
  sku: '',
  description: '  ',
  categoryId: null,
  unit: 'pcs',
  costPrice: '',
  salePrice: '250,50',
  minStock: '',
  locationNote: '',
}

const parse = (fields: Partial<ProductForm>) => ProductFormSchema.safeParse({ ...form, ...fields })

describe('ProductFormSchema', () => {
  it('trims text, turns blanks into null and hryvnias into kopiykas', () => {
    expect(parse({}).data).toStrictEqual({
      name: 'Фільтр масляний',
      sku: null,
      description: null,
      categoryId: null,
      unit: 'pcs',
      minStock: null,
      locationNote: null,
      costPriceMinor: null,
      salePriceMinor: 25_050,
    })
  })

  it.each<[string, number]>([
    ['250', 25_000],
    ['250.5', 25_050],
    ['0,07', 7],
    ['1 250,00', 125_000], // grouping spaces, as Intl writes them
    ['1 250', 125_000], // narrow no-break space
  ])('reads the price "%s"', (salePrice, minor) => {
    expect(parse({ salePrice }).data?.salePriceMinor).toBe(minor)
  })

  it.each(['-5', '2,505', 'abc', '1,2,3'])('refuses the price "%s"', (salePrice) => {
    const result = parse({ salePrice })
    expect(result.success).toBe(false)
    expect(result.error && invalidFields(result.error)).toStrictEqual({ salePrice: true })
  })

  it('reads quantities with up to three decimals', () => {
    expect(parse({ minStock: '1,5' }).data?.minStock).toBe(1.5)
    expect(parse({ minStock: '0,125' }).data?.minStock).toBe(0.125)
    expect(parse({ minStock: '0,1255' }).success).toBe(false)
  })

  it('needs a name', () => {
    const result = parse({ name: '   ' })
    expect(result.error && invalidFields(result.error)).toStrictEqual({ name: true })
  })
})

describe('form text from stored values', () => {
  it('writes kopiykas as hryvnias and quantities with a comma', () => {
    expect(toMoneyText(25_050)).toBe('250,50')
    expect(toMoneyText(7)).toBe('0,07')
    expect(toMoneyText(null)).toBe('')
    expect(toQuantityText(1.5)).toBe('1,5')
    expect(toQuantityText(null)).toBe('')
  })

  it('reads back what it writes', () => {
    expect(parse({ salePrice: toMoneyText(123_456), minStock: toQuantityText(2.25) }).data)
      .toMatchObject({ salePriceMinor: 123_456, minStock: 2.25 })
  })
})
