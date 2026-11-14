import stylistic from '@stylistic/eslint-plugin'
import { vueTsConfigs, withVueTs } from '@vue/eslint-config-typescript'
import type { Linter } from 'eslint'
import pluginVue from 'eslint-plugin-vue'

interface RestrictedPattern { group: string[], message: string }

// Boundary rules from SPEC.md, enforced at import time.
const supabaseOnlyInAdapters: RestrictedPattern = {
  group: ['@supabase/*'],
  message: 'Only packages/adapter-* may import Supabase. Use the RemoteGateway interface from @auto-crm/core.',
}
const noDeepPackageImports: RestrictedPattern = {
  group: ['@auto-crm/*/*'],
  message: 'Import workspace packages from their public entry, e.g. `@auto-crm/core`.',
}
const coreStaysPure: RestrictedPattern[] = [
  {
    group: ['vue', 'vue/*', 'vue-router', 'pinia', 'dexie', 'node:*'],
    message: '@auto-crm/core must stay framework-free: no Vue, Pinia, Dexie or Node built-ins.',
  },
  {
    group: ['@auto-crm/*', '**/apps/**', '**/adapter-*/**'],
    message: '@auto-crm/core is the bottom layer and must not import apps or adapters.',
  },
]

// `no-restricted-imports` options don't merge across config blocks (the last
// block wins), so every scope lists its full set of patterns.
const restrictImports = (patterns: RestrictedPattern[]): Linter.RulesRecord => ({
  'no-restricted-imports': ['error', { patterns }],
})

export default withVueTs(
  { rootDir: import.meta.dirname },

  {
    name: 'auto-crm/ignores',
    ignores: ['**/dist/**', '**/coverage/**', '.agents/**', '.claude/**'],
  },

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,

  // Formatting: ESLint is the only formatter. Run `pnpm lint:fix` or fix on save.
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: false,
    commaDangle: 'always-multiline',
    braceStyle: '1tbs',
    arrowParens: true,
  }),

  {
    name: 'auto-crm/typescript',
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'eqeqeq': ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    name: 'auto-crm/vue',
    files: ['**/*.vue'],
    rules: {
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': 'error',
      'vue/padding-line-between-blocks': 'error',
      // All UI text goes through vue-i18n.
      'vue/no-bare-strings-in-template': 'error',
      // Formatting of expressions inside <template>, matching the script style.
      'vue/arrow-spacing': 'error',
      'vue/block-spacing': 'error',
      'vue/brace-style': ['error', '1tbs'],
      'vue/comma-dangle': ['error', 'always-multiline'],
      'vue/comma-spacing': 'error',
      'vue/key-spacing': 'error',
      'vue/keyword-spacing': 'error',
      'vue/object-curly-spacing': ['error', 'always'],
      'vue/quote-props': ['error', 'consistent-as-needed'],
      'vue/space-infix-ops': 'error',
      'vue/space-unary-ops': 'error',
      'vue/template-curly-spacing': 'error',
    },
  },

  {
    name: 'auto-crm/boundaries',
    rules: restrictImports([supabaseOnlyInAdapters, noDeepPackageImports]),
  },
  {
    name: 'auto-crm/boundaries/core',
    files: ['packages/core/**'],
    rules: restrictImports([supabaseOnlyInAdapters, noDeepPackageImports, ...coreStaysPure]),
  },
  {
    name: 'auto-crm/boundaries/adapters',
    files: ['packages/adapter-*/**'],
    rules: restrictImports([noDeepPackageImports]),
  },
)
