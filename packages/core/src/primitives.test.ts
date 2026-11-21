import { describe, expect, it } from 'vitest'
import {
  CurrencySchema,
  IdSchema,
  MoneyMinorSchema,
  QuantitySchema,
  TextSchema,
  UtcTimestampSchema,
} from './primitives'

describe('IdSchema', () => {
  it('accepts a UUIDv7', () => {
    expect(IdSchema.safeParse('01890a5d-ac96-774b-bcce-b302099a8057').success).toBe(true)
  })

  it('rejects a non-UUID', () => {
    expect(IdSchema.safeParse('product-1').success).toBe(false)
  })
})

describe('UtcTimestampSchema', () => {
  it('accepts UTC with Z', () => {
    expect(UtcTimestampSchema.safeParse('2026-11-21T10:15:30.123Z').success).toBe(true)
  })

  it.each(['2026-11-21T12:15:30+02:00', '2026-11-21T10:15:30', '2026-11-21'])(
    'rejects %s',
    (value) => {
      expect(UtcTimestampSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('MoneyMinorSchema', () => {
  it('accepts whole kopiykas', () => {
    expect(MoneyMinorSchema.safeParse(12_550).success).toBe(true)
  })

  it.each([12.5, -1])('rejects %s', (value) => {
    expect(MoneyMinorSchema.safeParse(value).success).toBe(false)
  })
})

describe('CurrencySchema', () => {
  it('accepts only UAH', () => {
    expect(CurrencySchema.safeParse('UAH').success).toBe(true)
    expect(CurrencySchema.safeParse('USD').success).toBe(false)
  })
})

describe('QuantitySchema', () => {
  it.each([1, 0.5, 1.005, -2.125, 999_999_999.999])('accepts %s', (value) => {
    expect(QuantitySchema.safeParse(value).success).toBe(true)
  })

  it.each([1.0005, 0.1 + 0.2, 1_000_000_000, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s',
    (value) => {
      expect(QuantitySchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('TextSchema', () => {
  it('trims and rejects blank text', () => {
    expect(TextSchema.parse('  Масло  ')).toBe('Масло')
    expect(TextSchema.safeParse('   ').success).toBe(false)
  })
})
