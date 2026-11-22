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

// Why a gateway call failed, independent of the backend. Adapters translate
// their own errors into these so screens can show the right message.
export type GatewayErrorCode
  = | 'invalidCredentials' // wrong email or password
    | 'weakPassword' // the new password is rejected as too weak
    | 'samePassword' // the new password equals the current one
    | 'network' // the backend could not be reached
    | 'sessionExpired' // not signed in, or the session is no longer valid
    | 'accessDenied' // no active membership, or the shop is suspended
    | 'unknown'

export class GatewayError extends Error {
  readonly code: GatewayErrorCode

  constructor(code: GatewayErrorCode, options?: { cause?: unknown }) {
    super(`Gateway error: ${code}`, options)
    this.name = 'GatewayError'
    this.code = code
  }
}

// Every method rejects with a GatewayError.
export interface RemoteAuth {
  signIn: (email: string, password: string) => Promise<AuthSession>
  signOut: () => Promise<void>
  // The cached session, or null when signed out. Works offline.
  getSession: () => Promise<AuthSession | null>
  // Emails a link that opens the app's set-password screen signed in.
  requestPasswordReset: (email: string) => Promise<void>
  // Sets a new password for the signed-in user, e.g. after the reset link.
  updatePassword: (password: string) => Promise<void>
}

// The whole backend surface. Only the sync engine calls it, and only adapter
// packages implement it, so swapping the adapter swaps the backend. Every
// method rejects with a GatewayError.
export interface RemoteGateway {
  auth: RemoteAuth
  bootstrap: () => Promise<BootstrapResponse>
  pushOperations: (request: PushRequest) => Promise<PushResponse>
  pullChanges: (request: PullRequest) => Promise<PullResponse>
}
