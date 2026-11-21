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

// The three SQL functions return the contract's JSON as is; parsing here makes
// sure the app only ever sees data that matches the zod schemas in core.
const callRpc = async (client: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
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
