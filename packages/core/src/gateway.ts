import type { Id, UtcTimestamp } from './primitives'
import type {
  BootstrapResponse,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
} from './sync'

export interface AuthSession {
  userId: Id
  email: string
  expiresAt: UtcTimestamp
}

export interface RemoteAuth {
  signIn: (email: string, password: string) => Promise<AuthSession>
  signOut: () => Promise<void>
  // The cached session, or null when signed out. Works offline.
  getSession: () => Promise<AuthSession | null>
  requestPasswordReset: (email: string) => Promise<void>
}

// The whole backend surface. Only the sync engine calls it, and only adapter
// packages implement it, so swapping the adapter swaps the backend.
export interface RemoteGateway {
  auth: RemoteAuth
  bootstrap: () => Promise<BootstrapResponse>
  pushOperations: (request: PushRequest) => Promise<PushResponse>
  pullChanges: (request: PullRequest) => Promise<PullResponse>
}
