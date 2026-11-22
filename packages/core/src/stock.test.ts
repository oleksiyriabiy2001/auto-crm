import { describe, expect, it } from 'vitest'
import type { MovementType } from './stock'
import { isLowStock, isNegativeStock, sumStock, toQuantityDelta, validateMovement } from './stock'

describe('toQuantityDelta', () => {
  it.each<[MovementType, number, number]>([
    ['receive', 5, 5],
    ['initial', 2.5, 2.5],
    ['sale', 2, -2],
    ['consume', 0.25, -0.25],
    ['write_off', 1, -1],
    ['adjustment', -3, -3],
    ['adjustment', 3, 3],
  ])('turns %s of %d into %d', (type, quantity, delta) => {
    expect(toQuantityDelta(type, quantity)).toBe(delta)
  })

  it('leaves a typed negative for validateMovement to reject', () => {
    expect(validateMovement({ type: 'sale', quantityDelta: toQuantityDelta('sale', -2), note: null })).toBe('wrongSign')
  })
})

describe('validateMovement', () => {
  it.each<[MovementType, number]>([
    ['initial', 5],
    ['receive', 1.5],
    ['sale', -1],
    ['consume', -0.25],
    ['write_off', -2],
  ])('accepts %s with %s', (type, quantityDelta) => {
    expect(validateMovement({ type, quantityDelta, note: null })).toBeNull()
  })

  it.each<[MovementType, number]>([
    ['initial', -5],
    ['receive', -1],
    ['sale', 1],
    ['consume', 0.25],
    ['write_off', 2],
  ])('rejects %s with %s as the wrong sign', (type, quantityDelta) => {
    expect(validateMovement({ type, quantityDelta, note: null })).toBe('wrongSign')
  })

  it('rejects a zero quantity', () => {
    expect(validateMovement({ type: 'receive', quantityDelta: 0, note: null })).toBe('zeroQuantity')
  })

  it('allows an adjustment of either sign with a note', () => {
    expect(validateMovement({ type: 'adjustment', quantityDelta: 3, note: 'Перерахунок' })).toBeNull()
    expect(validateMovement({ type: 'adjustment', quantityDelta: -3, note: 'Брак' })).toBeNull()
  })

  it.each([null, '', '   '])('requires a note on an adjustment (%j)', (note) => {
    expect(validateMovement({ type: 'adjustment', quantityDelta: 1, note })).toBe('noteRequired')
  })
})

describe('sumStock', () => {
  it('is zero with no movements', () => {
    expect(sumStock([])).toBe(0)
  })

  it('sums without float drift', () => {
    expect(sumStock([{ quantityDelta: 0.1 }, { quantityDelta: 0.2 }])).toBe(0.3)
    expect(sumStock([{ quantityDelta: 1.005 }, { quantityDelta: -0.335 }])).toBe(0.67)
  })

  it('goes negative when more is sold than received', () => {
    expect(sumStock([{ quantityDelta: 2 }, { quantityDelta: -3 }])).toBe(-1)
  })
})

describe('isNegativeStock', () => {
  it('flags only quantities below zero', () => {
    expect(isNegativeStock(-0.001)).toBe(true)
    expect(isNegativeStock(0)).toBe(false)
  })
})

describe('isLowStock', () => {
  it('is low at or below the threshold', () => {
    expect(isLowStock(5, 5)).toBe(true)
    expect(isLowStock(4.999, 5)).toBe(true)
    expect(isLowStock(5.001, 5)).toBe(false)
  })

  it('is never low without a threshold', () => {
    expect(isLowStock(-10, null)).toBe(false)
  })
})
