import { defineConfig } from 'vitest/config'

// One runner for the whole workspace. Each package is a Vitest project, so
// `pnpm test` runs everything and `pnpm test --project core` runs one package.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: 'packages/core',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
})
