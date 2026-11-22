import type { Id } from '@auto-crm/core'
import { IdSchema, MovementTypeSchema, QuantitySchema, toQuantityDelta } from '@auto-crm/core'
import { z } from 'zod'

import { ServiceError } from './service-error'
import type { ShopAccess } from './shop-access'
import { shopAccess } from './shop-access'

// The quantity is what the user typed: how much was received, sold, consumed
// or written off. Only an adjustment carries its own sign. A blank note is no
// note.
const MovementInputSchema = z.object({
  productId: IdSchema,
  type: MovementTypeSchema,
  quantity: QuantitySchema,
  note: z.string().trim().nullable().transform((note) => (note === '' ? null : note)),
})
export type MovementInput = z.input<typeof MovementInputSchema>

// Stock use cases. The ledger is append-only, so recording is the only write.
export class StockService {
  constructor(private readonly shop: ShopAccess) {}

  // Records a movement with the product's current price and cost copied in,
  // so history stays correct when the product changes later. Negative stock
  // is allowed. Returns the movement's id.
  async recordMovement(input: MovementInput): Promise<Id> {
    const { productId, type, quantity, note } = this.shop.parse(MovementInputSchema, input)
    const id = this.shop.newId()
    await this.shop.submit((_context, catalog) => {
      // A sale of a deleted product still happened, so deleted products count.
      const product = catalog.products.find((row) => row.id === productId)
      if (!product) throw new ServiceError('notFound')
      return {
        type: 'stock.move',
        payload: {
          id,
          productId,
          type,
          quantityDelta: toQuantityDelta(type, quantity),
          unitCostMinor: product.costPriceMinor,
          unitPriceMinor: product.salePriceMinor,
          currency: product.currency,
          note,
          occurredAt: this.shop.now().toISOString(),
        },
      }
    })
    return id
  }
}

export const stockService = new StockService(shopAccess)
