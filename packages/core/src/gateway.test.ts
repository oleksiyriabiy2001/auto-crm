import { describe, expect, it } from 'vitest'
import { GatewayError } from './gateway'

describe('GatewayError', () => {
  it('carries its code and cause', () => {
    const cause = new Error('fetch failed')
    const error = new GatewayError('network', { cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('GatewayError')
    expect(error.code).toBe('network')
    expect(error.cause).toBe(cause)
  })
})
