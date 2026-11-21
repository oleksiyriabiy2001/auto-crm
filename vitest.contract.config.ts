import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'

// Contract tests run every RemoteGateway adapter against a real backend, so
// they are kept out of `pnpm test`. Run `supabase start`, then
// `pnpm test:contract`.

interface SupabaseStatus {
  API_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

const readStatus = (): SupabaseStatus => {
  try {
    return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as SupabaseStatus
  } catch (error) {
    throw new Error('Local Supabase is not running. Start it with `supabase start`.', { cause: error })
  }
}

const status = readStatus()

declare module 'vitest' {
  // Mirrors the declaration in packages/adapter-supabase/src/gateway.contract.test.ts.
  export interface ProvidedContext {
    supabase: { url: string, publishableKey: string, secretKey: string }
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'contract-supabase',
          root: 'packages/adapter-supabase',
          include: ['src/**/*.contract.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 30_000,
          provide: {
            supabase: { url: status.API_URL, publishableKey: status.PUBLISHABLE_KEY, secretKey: status.SECRET_KEY },
          },
        },
      },
    ],
  },
})
