import type { AuthSession, BootstrapResponse, RemoteGateway } from '@auto-crm/core'

import { gateway } from '@/gateway'
import type { SyncService } from '@/sync/sync.service'
import { syncService } from '@/sync/sync.service'

// A signed-in user with their shop open: who they are, the shop and their role.
export interface SignedIn {
  session: AuthSession
  shop: BootstrapResponse
}

// Sign-in and password use cases, one method each. Auth is the only backend
// call outside the sync engine, because it has to happen online before any
// sync can. Every method rejects with a GatewayError from @auto-crm/core.
export class AuthService {
  constructor(
    private readonly gateway: RemoteGateway,
    private readonly sync: Pick<SyncService, 'start' | 'stop'>,
  ) {}

  async signIn(email: string, password: string): Promise<SignedIn> {
    return this.openShop(await this.gateway.auth.signIn(email, password))
  }

  // The stored session with its shop open, or null when signed out.
  async restore(): Promise<SignedIn | null> {
    const session = await this.gateway.auth.getSession()
    return session ? this.openShop(session) : null
  }

  // TODO(phase 2): warn when the outbox still has unsynced changes.
  async signOut(): Promise<void> {
    this.sync.stop()
    await this.gateway.auth.signOut()
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.gateway.auth.requestPasswordReset(email)
  }

  updatePassword(password: string): Promise<void> {
    return this.gateway.auth.updatePassword(password)
  }

  // Starts syncing the user's shop. If it cannot open (offline on this
  // device's first start, or access denied), signs out again, so the user is
  // never left half signed in.
  private async openShop(session: AuthSession): Promise<SignedIn> {
    try {
      return { session, shop: await this.sync.start(session) }
    } catch (error) {
      await this.gateway.auth.signOut().catch(() => undefined)
      throw error
    }
  }
}

export const authService = new AuthService(gateway, syncService)
