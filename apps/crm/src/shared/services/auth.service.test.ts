import type { AuthSession } from '@auto-crm/core'
import { GatewayError } from '@auto-crm/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FAKE_USER, FakeGateway } from '@/sync/fake-gateway'

import { AuthService } from './auth.service'

// The real gateway reads Vite env vars and `window`, which tests don't have.
vi.mock('@/gateway', () => ({ gateway: {} }))

const session: AuthSession = { userId: FAKE_USER, email: 'staff@example.com', expiresAt: '2026-11-23T10:00:00.000Z' }

let gateway: FakeGateway
let calls: string[]
let start: (session: AuthSession) => Promise<unknown>
let service: AuthService

beforeEach(() => {
  gateway = new FakeGateway()
  calls = []
  start = () => Promise.resolve(gateway.bootstrapResponse)
  gateway.auth = {
    ...gateway.auth,
    signIn: () => Promise.resolve(session),
    getSession: () => Promise.resolve(session),
    signOut: () => {
      calls.push('signOut')
      return Promise.resolve()
    },
  }
  service = new AuthService(gateway, {
    start: async (s) => {
      calls.push('start')
      await start(s)
      return gateway.bootstrapResponse
    },
    stop: () => {
      calls.push('stop')
    },
  })
})

describe('AuthService', () => {
  it('signs in and opens the shop', async () => {
    expect(await service.signIn('staff@example.com', 'password123')).toStrictEqual({ session, shop: gateway.bootstrapResponse })
    expect(calls).toStrictEqual(['start'])
  })

  it('restores the stored session with its shop, or nothing when signed out', async () => {
    expect((await service.restore())?.shop.membership.role).toBe('staff')
    gateway.auth.getSession = () => Promise.resolve(null)
    expect(await service.restore()).toBeNull()
  })

  it('signs out again when the shop cannot open, and passes the reason on', async () => {
    start = () => Promise.reject(new GatewayError('accessDenied'))
    await expect(service.signIn('staff@example.com', 'password123')).rejects.toMatchObject({ code: 'accessDenied' })
    await expect(service.restore()).rejects.toMatchObject({ code: 'accessDenied' })
    expect(calls).toStrictEqual(['start', 'signOut', 'start', 'signOut'])
  })

  it('keeps the original reason when signing out fails too', async () => {
    start = () => Promise.reject(new GatewayError('network'))
    gateway.auth.signOut = () => Promise.reject(new GatewayError('network'))
    await expect(service.signIn('staff@example.com', 'password123')).rejects.toMatchObject({ code: 'network' })
  })

  it('stops syncing before signing out', async () => {
    await service.signOut()
    expect(calls).toStrictEqual(['stop', 'signOut'])
  })
})
