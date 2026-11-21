import { describe, expect, it } from 'vitest'
import type { Operation } from './operations'
import { OperationSchema, requiredCapability } from './operations'

const envelope = {
  id: '01890a5d-ac96-774b-bcce-b302099a8060',
  clientTimestamp: '2026-11-21T10:00:00Z',
  deviceId: '01890a5d-ac96-774b-bcce-b302099a8061',
}
const productId = '01890a5d-ac96-774b-bcce-b302099a8062'

const productFields = {
  sku: null,
  name: 'Фільтр масляний',
  description: null,
  categoryId: null,
  unit: 'pcs',
  costPriceMinor: null,
  salePriceMinor: 25_000,
  currency: 'UAH',
  minStock: null,
  locationNote: null,
  isActive: true,
}

const stockMove = (type: string, quantityDelta: number, note: string | null = null) => ({
  ...envelope,
  type: 'stock.move',
  payload: {
    id: '01890a5d-ac96-774b-bcce-b302099a8063',
    productId,
    type,
    quantityDelta,
    unitCostMinor: null,
    unitPriceMinor: 25_000,
    currency: 'UAH',
    note,
    occurredAt: '2026-11-21T10:00:00Z',
  },
})

const parse = (input: unknown): Operation => OperationSchema.parse(input)

describe('OperationSchema', () => {
  it('accepts a product create with barcodes', () => {
    const op = parse({
      ...envelope,
      type: 'product.create',
      payload: {
        id: productId,
        ...productFields,
        barcodes: [{ id: '01890a5d-ac96-774b-bcce-b302099a8064', barcode: '4820000000017', symbology: 'ean13' }],
      },
    })
    expect(op.type).toBe('product.create')
  })

  it('requires a base version on a product update', () => {
    const update = { ...envelope, type: 'product.update', payload: { id: productId, changes: { name: 'Нова назва' } } }
    expect(OperationSchema.safeParse(update).success).toBe(false)
    expect(OperationSchema.safeParse({ ...update, baseVersion: 3 }).success).toBe(true)
  })

  it('rejects an update that changes nothing', () => {
    const update = { ...envelope, type: 'product.update', baseVersion: 3, payload: { id: productId, changes: {} } }
    expect(OperationSchema.safeParse(update).success).toBe(false)
  })

  it('applies the movement rules to stock.move', () => {
    expect(OperationSchema.safeParse(stockMove('sale', -1)).success).toBe(true)
    expect(OperationSchema.safeParse(stockMove('sale', 1)).success).toBe(false)
    expect(OperationSchema.safeParse(stockMove('adjustment', 2)).success).toBe(false)
    expect(OperationSchema.safeParse(stockMove('adjustment', 2, 'Перерахунок')).success).toBe(true)
  })

  it('requires a base version on a product restore', () => {
    const restore = { ...envelope, type: 'product.restore', payload: { id: productId } }
    expect(OperationSchema.safeParse(restore).success).toBe(false)
    expect(OperationSchema.safeParse({ ...restore, baseVersion: 2 }).success).toBe(true)
  })

  it('rejects an unknown operation type', () => {
    expect(OperationSchema.safeParse({ ...envelope, type: 'product.merge', payload: { id: productId } }).success).toBe(false)
  })
})

describe('requiredCapability', () => {
  it.each([
    [{ ...envelope, type: 'product.create', payload: { id: productId, ...productFields, barcodes: [] } }, 'createProduct'],
    [{ ...envelope, type: 'product.update', baseVersion: 1, payload: { id: productId, changes: { isActive: false } } }, 'editProduct'],
    [{ ...envelope, type: 'product.delete', baseVersion: 1, payload: { id: productId } }, 'deleteProduct'],
    [{ ...envelope, type: 'product.restore', baseVersion: 2, payload: { id: productId } }, 'deleteProduct'],
    [{ ...envelope, type: 'barcode.add', payload: { id: productId, productId, barcode: '123', symbology: null } }, 'addBarcode'],
    [{ ...envelope, type: 'barcode.remove', payload: { id: productId } }, 'editProduct'],
    [stockMove('receive', 1), 'recordMovement'],
    [stockMove('sale', -1), 'recordMovement'],
    [stockMove('consume', -1), 'recordMovement'],
    [stockMove('initial', 1), 'adjustStock'],
    [stockMove('adjustment', -1, 'Брак'), 'adjustStock'],
    [stockMove('write_off', -1), 'adjustStock'],
  ])('%#: needs %s', (input, capability) => {
    expect(requiredCapability(parse(input))).toBe(capability)
  })
})
