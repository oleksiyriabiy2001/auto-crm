import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient, isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthSession, GatewayErrorCode, RemoteGateway } from '@auto-crm/core'
import {
  BootstrapResponseSchema,
  GatewayError,
  PullResponseSchema,
  PushResponseSchema,
} from '@auto-crm/core'

export interface SupabaseGatewayConfig {
  url: string
  // The publishable (public) key. The secret key never ships in the app.
  publishableKey: string
  // Where the password reset email links to: the app's set-password screen.
  // Must be listed in the project's auth redirect URLs.
  passwordResetUrl?: string
  // Off in tests and scripts, which keep the session in memory only.
  persistSession?: boolean
}

const toAuthSession = (session: Session): AuthSession => ({
  userId: session.user.id,
  email: session.user.email ?? '',
  expiresAt: new Date((session.expires_at ?? Date.now() / 1000 + session.expires_in) * 1000).toISOString(),
})

const AUTH_ERROR_CODES: Partial<Record<string, GatewayErrorCode>> = {
  invalid_credentials: 'invalidCredentials',
  weak_password: 'weakPassword',
  same_password: 'samePassword',
}

const toGatewayError = (error: unknown): GatewayError => {
  if (isAuthRetryableFetchError(error)) return new GatewayError('network', { cause: error })
  const code = isAuthApiError(error) && error.code !== undefined ? AUTH_ERROR_CODES[error.code] : undefined
  return new GatewayError(code ?? 'unknown', { cause: error })
}

// How PostgREST reports a failed call. The returned `error` is plain JSON, not
// an Error instance, so the HTTP status decides:
// - 0: no response at all (offline, DNS, refused). postgrest-js catches the
//   fetch error and resolves with status 0.
// - 401: no valid user token. An expired or invalid JWT (PGRST30x), or no
//   token at all, which runs the call as `anon`, which has no grant (42501).
// - 403 with 42501: signed in, but the SQL function refused: no active
//   membership or a suspended shop.
const toRpcErrorCode = (status: number, code: string | undefined): GatewayErrorCode => {
  if (status === 0) return 'network'
  // TODO(phase 2, step 6): when the token refresh fails on a server error,
  // supabase-js sends the call with the publishable key, so a user whose
  // session is still stored gets 401 and the engine asks them to sign in
  // again. Check auth.getSession() before treating 401 as an expired session.
  if (status === 401) return 'sessionExpired'
  if (status === 403 && code === '42501') return 'accessDenied'
  return 'unknown'
}

// The three SQL functions return the contract's JSON as is; parsing here makes
// sure the app only ever sees data that matches the zod schemas in core.
const callRpc = async (client: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error, status } = await client.rpc(name, args)
  if (error) throw new GatewayError(toRpcErrorCode(status, error.code), { cause: error })
  return data
}

export const createSupabaseGateway = (config: SupabaseGatewayConfig): RemoteGateway => {
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: config.persistSession ?? true },
  })

  return {
    auth: {
      signIn: async (email, password) => {
        const { data, error } = await client.auth.signInWithPassword({ email, password })
        if (error) throw toGatewayError(error)
        return toAuthSession(data.session)
      },
      signOut: async () => {
        const { error } = await client.auth.signOut()
        if (error) throw toGatewayError(error)
      },
      getSession: async () => {
        const { data, error } = await client.auth.getSession()
        if (error) throw toGatewayError(error)
        return data.session ? toAuthSession(data.session) : null
      },
      requestPasswordReset: async (email) => {
        const options = config.passwordResetUrl === undefined ? {} : { redirectTo: config.passwordResetUrl }
        const { error } = await client.auth.resetPasswordForEmail(email, options)
        if (error) throw toGatewayError(error)
      },
      updatePassword: async (password) => {
        const { error } = await client.auth.updateUser({ password })
        if (error) throw toGatewayError(error)
      },
    },
    bootstrap: async () => BootstrapResponseSchema.parse(await callRpc(client, 'bootstrap')),
    pushOperations: async ({ operations }) =>
      PushResponseSchema.parse(await callRpc(client, 'push', { operations })),
    pullChanges: async ({ cursor }) =>
      PullResponseSchema.parse(await callRpc(client, 'pull', { cursor })),
  }
}
