import { describe, expect, it } from 'vitest'
import {
  PullRequestSchema,
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
} from './sync'

const operationId = '01890a5d-ac96-774b-bcce-b302099a8070'

describe('PushRequestSchema', () => {
  it('rejects an empty push', () => {
    expect(PushRequestSchema.safeParse({ operations: [] }).success).toBe(false)
  })
})

describe('PushResponseSchema', () => {
  it('accepts each result status', () => {
    const response = {
      results: [
        { operationId, status: 'accepted' },
        { operationId, status: 'duplicate' },
        { operationId, status: 'rejected', reason: 'barcodeConflict' },
        { operationId, status: 'rejected', reason: 'skuConflict' },
        { operationId, status: 'rejected', reason: 'categoryCycle' },
      ],
    }
    expect(PushResponseSchema.parse(response)).toStrictEqual(response)
  })

  it('requires a known reason on a rejection', () => {
    expect(PushResponseSchema.safeParse({ results: [{ operationId, status: 'rejected' }] }).success).toBe(false)
    expect(
      PushResponseSchema.safeParse({ results: [{ operationId, status: 'rejected', reason: 'versionConflict' }] }).success,
    ).toBe(false)
  })
})

describe('PullRequestSchema', () => {
  it('accepts a null cursor for a first pull and rejects an empty one', () => {
    expect(PullRequestSchema.safeParse({ cursor: null }).success).toBe(true)
    expect(PullRequestSchema.safeParse({ cursor: '1042' }).success).toBe(true)
    expect(PullRequestSchema.safeParse({ cursor: '' }).success).toBe(false)
  })
})

describe('PullResponseSchema', () => {
  it('accepts an empty batch', () => {
    const response = {
      changes: { categories: [], products: [], productBarcodes: [], stockMovements: [] },
      cursor: '1042',
      hasMore: false,
    }
    expect(PullResponseSchema.parse(response)).toStrictEqual(response)
  })
})
