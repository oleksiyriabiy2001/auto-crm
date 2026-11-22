import type { Id, Operation, Overlaid, OverlaidCatalog, StockMovement } from '@auto-crm/core'
import { can, OperationSchema, pendingMovements, replayCatalog, requiredCapability } from '@auto-crm/core'
import { v7 } from 'uuid'
import type { z } from 'zod'

import type { ShopContext } from '@/sync/sync.service'
import { syncService } from '@/sync/sync.service'

import { ServiceError } from './service-error'

export interface ShopAccessDeps {
  getContext: () => ShopContext | null
  requestSync: () => void
  newId: () => Id
  now: () => Date
}

// An operation before the envelope is added. Distributes over the union, so
// each operation type keeps its own payload.
export type OperationDraft = Operation extends infer O
  ? O extends Operation ? Omit<O, 'id' | 'clientTimestamp' | 'deviceId'> : never
  : never

// What every service needs from the open shop: the overlaid view of its
// data, and one way to add an operation to the outbox.
export class ShopAccess {
  constructor(private readonly deps: ShopAccessDeps) {}

  context(): ShopContext {
    const context = this.deps.getContext()
    if (!context) throw new ServiceError('notSignedIn')
    return context
  }

  newId(): Id {
    return this.deps.newId()
  }

  now(): Date {
    return this.deps.now()
  }

  requestSync(): void {
    this.deps.requestSync()
  }

  // Validates input at the service boundary. Text comes back trimmed.
  parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
    const result = schema.safeParse(input)
    if (!result.success) throw new ServiceError('invalid', { cause: result.error })
    return result.data
  }

  async unconfirmed(context: ShopContext): Promise<Operation[]> {
    return (await context.repositories.outbox.listUnconfirmed(context.userId)).map((entry) => entry.operation)
  }

  // The server's catalog with the user's unconfirmed operations on top.
  async catalog(context: ShopContext, operations: readonly Operation[]): Promise<OverlaidCatalog> {
    const { categories, products, barcodes } = context.repositories
    const [categoryRows, productRows, barcodeRows] = await Promise.all([categories.list(), products.list(), barcodes.list()])
    return replayCatalog({ categories: categoryRows, products: productRows, barcodes: barcodeRows }, operations, context)
  }

  // The user's movements the local ledger does not hold yet.
  async pendingMovements(context: ShopContext, operations: readonly Operation[]): Promise<Overlaid<StockMovement>[]> {
    const known = new Set<Id>()
    for (const operation of operations) {
      if (operation.type === 'stock.move' && await context.repositories.movements.has(operation.payload.id)) {
        known.add(operation.payload.id)
      }
    }
    return pendingMovements(operations, known, context)
  }

  // Runs `build` and adds the operation it returns to the outbox, in one
  // transaction, so the checks and the write see the same data. `build` may
  // read through the repositories and throws a ServiceError to refuse; it
  // returns null when there is nothing to change. Returns the operation added.
  async submit(build: (context: ShopContext, catalog: OverlaidCatalog) => OperationDraft | null): Promise<Operation | null> {
    const context = this.context()
    const operation = await context.transactions.run(async () => {
      const catalog = await this.catalog(context, await this.unconfirmed(context))
      const draft = build(context, catalog)
      if (draft === null) return null
      const parsed = this.parse(OperationSchema, {
        ...draft,
        id: this.deps.newId(),
        clientTimestamp: this.deps.now().toISOString(),
        deviceId: context.deviceId,
      })
      if (!can(context.role, requiredCapability(parsed))) throw new ServiceError('forbidden')
      await context.repositories.outbox.add({ operation: parsed, userId: context.userId, status: 'pending' })
      return parsed
    })
    if (operation) this.deps.requestSync()
    return operation
  }
}

export const shopAccess = new ShopAccess({
  getContext: () => syncService.getContext(),
  requestSync: () => {
    syncService.requestSync()
  },
  newId: v7,
  now: () => new Date(),
})
