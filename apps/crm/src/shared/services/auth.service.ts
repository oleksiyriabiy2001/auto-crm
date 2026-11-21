import type { AuthSession, RemoteGateway } from '@auto-crm/core'

import { gateway } from '@/gateway'

// Sign-in and password use cases, one method each. Auth is the only backend
// call outside the sync engine, because it has to happen online before any
// sync can. Every method rejects with a GatewayError from @auto-crm/core.
export class AuthService {
  constructor(private readonly gateway: RemoteGateway) {}

  signIn(email: string, password: string): Promise<AuthSession> {
    return this.gateway.auth.signIn(email, password)
  }

  // TODO(phase 2): warn when the outbox still has unsynced changes.
  signOut(): Promise<void> {
    return this.gateway.auth.signOut()
  }

  getSession(): Promise<AuthSession | null> {
    return this.gateway.auth.getSession()
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.gateway.auth.requestPasswordReset(email)
  }

  updatePassword(password: string): Promise<void> {
    return this.gateway.auth.updatePassword(password)
  }
}

export const authService = new AuthService(gateway)
