// Runs the shared contract suite against the local Supabase stack.
// Run with `pnpm test:contract` (needs `supabase start`).
import { createClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import type { ContractHarness, ContractShop } from '@auto-crm/contract-tests'
import { describeGatewayContract } from '@auto-crm/contract-tests'
import { createSupabaseGateway } from './gateway'

declare module 'vitest' {
  // Provided by vitest.contract.config.ts from `supabase status`.
  export interface ProvidedContext {
    supabase: { url: string, publishableKey: string, secretKey: string }
  }
}

const { url, publishableKey, secretKey } = inject('supabase')

// The secret key is used only here, to provision test accounts and shops the
// way the provisioning script will. It never reaches the gateway.
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

const must = async <T>(request: PromiseLike<{ data: T, error: unknown }>): Promise<T> => {
  const { data, error } = await request
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
  return data
}

const createShop = async (name: string): Promise<ContractShop> => {
  const runId = crypto.randomUUID()
  const tenantId = crypto.randomUUID()
  await must(admin.from('tenants').insert({ id: tenantId, name }))

  const createUser = async (role: 'admin' | 'staff') => {
    const email = `${role}-${runId}@contract.test`
    const password = crypto.randomUUID()
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    const { user } = data
    await must(admin.from('profiles').insert({ id: user.id, display_name: `${name} ${role}` }))
    await must(admin.from('memberships').insert({ tenant_id: tenantId, user_id: user.id, role }))
    return {
      gateway: createSupabaseGateway({ url, publishableKey, persistSession: false }),
      userId: user.id,
      email,
      password,
    }
  }

  return { tenantId, admin: await createUser('admin'), staff: await createUser('staff') }
}

const harness: ContractHarness = {
  createShops: async () => ({ shopA: await createShop('Shop A'), shopB: await createShop('Shop B') }),
  // Port 9 (discard) has nothing listening locally, so the connection is refused.
  createUnreachableGateway: () => createSupabaseGateway({ url: 'http://127.0.0.1:9', publishableKey, persistSession: false }),
  suspendShop: async (tenantId) => {
    await must(admin.from('tenants').update({ status: 'suspended' }).eq('id', tenantId))
  },
}

describeGatewayContract(harness)
