import type {
  BootstrapResponse,
  Operation,
  Product,
  PullResponse,
  PushResult,
  RemoteGateway,
  StockMovement,
} from '@auto-crm/core'
import { GatewayError, ProductSchema } from '@auto-crm/core'

// An in-memory backend for sync tests. It applies `product.create` and
// `stock.move` (enough to check what reaches the device), dedupes on the
// operation id like the real server, and can fail on cue.

export const FAKE_TENANT = '0190a5d0-0000-7000-8000-00000000000a'
export const FAKE_USER = '0190a5d0-0000-7000-8000-0000000000a1'
const AT = '2026-11-22T10:00:00.000000Z'

type ServerRow
  = | { seq: number, kind: 'products', row: Product }
    | { seq: number, kind: 'stockMovements', row: StockMovement }

export class FakeGateway implements RemoteGateway {
  readonly pushed: Operation[][] = []
  readonly pulledCursors: (string | null)[] = []
  pageSize = 1000
  // Decides a result other than "accepted" for an operation.
  decide: (operation: Operation) => PushResult | undefined = () => undefined
  private readonly applied = new Set<string>()
  private readonly rows: ServerRow[] = []
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
    if ('quantityDelta' in row) this.rows.push({ seq: this.rows.length + 1, kind: 'stockMovements', row })
    else this.rows.push({ seq: this.rows.length + 1, kind: 'products', row })
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
    const newer = this.rows.filter((row) => row.seq > after)
    const page = newer.slice(0, this.pageSize)
    const last = page.at(-1)
    return Promise.resolve({
      changes: {
        categories: [],
        products: page.flatMap((row) => (row.kind === 'products' ? [row.row] : [])),
        productBarcodes: [],
        stockMovements: page.flatMap((row) => (row.kind === 'stockMovements' ? [row.row] : [])),
      },
      cursor: String(last?.seq ?? after),
      hasMore: newer.length > page.length,
    })
  }

  private apply(operation: Operation): PushResult {
    if (this.applied.has(operation.id)) return { operationId: operation.id, status: 'duplicate' }
    const decided = this.decide(operation)
    if (decided) return decided

    this.applied.add(operation.id)
    const synced = { tenantId: FAKE_TENANT, createdAt: AT, updatedAt: AT, deletedAt: null, version: 1 }
    if (operation.type === 'product.create') {
      // Parsing drops the barcodes, which are rows of their own.
      this.addRow(ProductSchema.parse({ ...synced, ...operation.payload }))
    } else if (operation.type === 'stock.move') {
      this.addRow({
        ...synced,
        ...operation.payload,
        createdBy: FAKE_USER,
        deviceId: operation.deviceId,
        sourceType: null,
        sourceId: null,
      })
    }
    return { operationId: operation.id, status: 'accepted' }
  }

  private takeFailure(method: 'push' | 'pull') {
    const index = this.failures.findIndex((failure) => failure.method === method)
    return index === -1 ? undefined : this.failures.splice(index, 1)[0]
  }
}
