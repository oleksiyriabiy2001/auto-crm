import type {
  BootstrapResponse,
  Category,
  Operation,
  Product,
  ProductBarcode,
  PullResponse,
  PushResult,
  RemoteGateway,
  StockMovement,
} from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'

// An in-memory backend for sync tests. It applies every operation type the
// way the real server does (new rows at version 1, each change bumps the
// version and the row's sequence number, edits of a missing row are rejected
// as notFound), dedupes on the operation id, and can fail on cue. It does not
// check roles or uniqueness: use `decide` for those rejections.

export const FAKE_TENANT = '0190a5d0-0000-7000-8000-00000000000a'
export const FAKE_USER = '0190a5d0-0000-7000-8000-0000000000a1'
const AT = '2026-11-22T10:00:00.000000Z'

interface Tables {
  categories: Category
  products: Product
  productBarcodes: ProductBarcode
  stockMovements: StockMovement
}
type Kind = keyof Tables
type ServerRow = { [K in Kind]: { seq: number, kind: K, row: Tables[K] } }[Kind]

export class FakeGateway implements RemoteGateway {
  readonly pushed: Operation[][] = []
  readonly pulledCursors: (string | null)[] = []
  pageSize = 1000
  // Decides a result other than "accepted" for an operation.
  decide: (operation: Operation) => PushResult | undefined = () => undefined
  private readonly applied = new Set<string>()
  // The current version of each row, keyed `kind:id`, in sequence order.
  private readonly rows = new Map<string, ServerRow>()
  private seq = 0
  private readonly failures: { method: 'push' | 'pull', error: Error, afterApplying: boolean }[] = []

  auth: RemoteGateway['auth'] = {
    signIn: () => Promise.reject(new Error('not used')),
    signOut: () => Promise.resolve(),
    getSession: () => Promise.resolve(null),
    requestPasswordReset: () => Promise.resolve(),
    updatePassword: () => Promise.resolve(),
  }

  bootstrapResponse: BootstrapResponse = {
    tenant: { id: FAKE_TENANT, name: 'Shop A', status: 'active' },
    profile: { id: FAKE_USER, displayName: 'Staff' },
    membership: { id: '0190a5d0-0000-7000-8000-0000000000b1', tenantId: FAKE_TENANT, userId: FAKE_USER, role: 'staff', isActive: true },
  }

  bootstrap(): Promise<BootstrapResponse> {
    return Promise.resolve(this.bootstrapResponse)
  }

  // The next call to `method` fails with `error`. With `afterApplying`, a push
  // is applied first and only the response is lost.
  failNext(method: 'push' | 'pull', error: Error = new GatewayError('network'), afterApplying = false): void {
    this.failures.push({ method, error, afterApplying })
  }

  // A change made on another device.
  addRow(row: Product | StockMovement): void {
    if ('quantityDelta' in row) this.save('stockMovements', row)
    else this.save('products', row)
  }

  pushOperations({ operations }: { operations: Operation[] }): Promise<{ results: PushResult[] }> {
    this.pushed.push(operations)
    const failure = this.takeFailure('push')
    if (failure && !failure.afterApplying) return Promise.reject(failure.error)

    const results = operations.map((operation) => this.apply(operation))
    return failure ? Promise.reject(failure.error) : Promise.resolve({ results })
  }

  pullChanges({ cursor }: { cursor: string | null }): Promise<PullResponse> {
    this.pulledCursors.push(cursor)
    const failure = this.takeFailure('pull')
    if (failure) return Promise.reject(failure.error)

    const after = Number(cursor ?? 0)
    const newer = [...this.rows.values()].filter((row) => row.seq > after)
    const page = newer.slice(0, this.pageSize)
    const last = page.at(-1)
    const of = <K extends Kind>(kind: K): Tables[K][] =>
      page.flatMap((row) => (row.kind === kind ? [row.row as Tables[K]] : []))
    return Promise.resolve({
      changes: {
        categories: of('categories'),
        products: of('products'),
        productBarcodes: of('productBarcodes'),
        stockMovements: of('stockMovements'),
      },
      cursor: String(last?.seq ?? after),
      hasMore: newer.length > page.length,
    })
  }

  private apply(operation: Operation): PushResult {
    if (this.applied.has(operation.id)) return { operationId: operation.id, status: 'duplicate' }
    const decided = this.decide(operation)
    if (decided) return decided

    // Like the server, a rejected operation is not recorded, so it can be
    // pushed again under the same id.
    const applied = this.applyChange(operation)
    if (!applied) return { operationId: operation.id, status: 'rejected', reason: 'notFound' }
    this.applied.add(operation.id)
    return { operationId: operation.id, status: 'accepted' }
  }

  // Returns false when the row the operation needs does not exist.
  private applyChange(operation: Operation): boolean {
    const created = (id: string) => ({ id, tenantId: FAKE_TENANT, createdAt: AT, updatedAt: AT, deletedAt: null, version: 1 })
    switch (operation.type) {
      case 'category.create':
        this.save('categories', { ...created(operation.payload.id), ...operation.payload })
        return true
      case 'category.update':
        return this.change('categories', operation.payload.id, operation.payload.changes)
      case 'category.delete':
        return this.change('categories', operation.payload.id, { deletedAt: AT })
      case 'category.restore':
        return this.change('categories', operation.payload.id, { deletedAt: null })
      case 'product.create': {
        const { barcodes, ...fields } = operation.payload
        this.save('products', { ...created(fields.id), ...fields })
        for (const barcode of barcodes) {
          this.save('productBarcodes', { ...created(barcode.id), productId: fields.id, ...barcode })
        }
        return true
      }
      case 'product.update':
        return this.change('products', operation.payload.id, operation.payload.changes)
      case 'product.delete':
        return this.change('products', operation.payload.id, { deletedAt: AT })
      case 'product.restore':
        return this.change('products', operation.payload.id, { deletedAt: null })
      case 'barcode.add':
        if (!this.get('products', operation.payload.productId)) return false
        this.save('productBarcodes', { ...created(operation.payload.id), ...operation.payload })
        return true
      case 'barcode.remove':
        return this.change('productBarcodes', operation.payload.id, { deletedAt: AT })
      case 'stock.move':
        if (!this.get('products', operation.payload.productId)) return false
        this.save('stockMovements', {
          ...created(operation.payload.id),
          ...operation.payload,
          createdBy: FAKE_USER,
          deviceId: operation.deviceId,
          sourceType: null,
          sourceId: null,
        })
        return true
    }
  }

  private get<K extends Kind>(kind: K, id: string): Tables[K] | undefined {
    return this.rows.get(`${kind}:${id}`)?.row as Tables[K] | undefined
  }

  // Stores the row's new version at the end of the sequence.
  private save<K extends Kind>(kind: K, row: Tables[K]): void {
    const key = `${kind}:${row.id}`
    this.rows.delete(key)
    this.rows.set(key, { seq: ++this.seq, kind, row } as ServerRow)
  }

  private change<K extends Kind>(kind: K, id: string, changes: Partial<Tables[K]>): boolean {
    const row = this.get(kind, id)
    if (!row) return false
    this.save(kind, { ...row, ...changes, updatedAt: AT, version: row.version + 1 })
    return true
  }

  private takeFailure(method: 'push' | 'pull') {
    const index = this.failures.findIndex((failure) => failure.method === method)
    return index === -1 ? undefined : this.failures.splice(index, 1)[0]
  }
}
