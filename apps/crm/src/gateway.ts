import { createSupabaseGateway } from '@auto-crm/adapter-supabase'
import type { RemoteGateway } from '@auto-crm/core'
import { z } from 'zod'

// The one place the app picks its backend. Only services and the sync engine
// may import this module.

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

const env = EnvSchema.parse(import.meta.env)

export const gateway: RemoteGateway = createSupabaseGateway({
  url: env.VITE_SUPABASE_URL,
  publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  passwordResetUrl: new URL(`${import.meta.env.BASE_URL}set-password`, window.location.origin).href,
})
