import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import stylistic from '@stylistic/eslint-plugin'
import vitest from '@vitest/eslint-plugin'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { vueTsConfigs, withVueTs } from '@vue/eslint-config-typescript'
import type { Linter } from 'eslint'
import * as jsoncParser from 'jsonc-eslint-parser'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

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

const codeFiles = ['**/*.{ts,mts,vue}']

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
  {
    ...stylistic.configs.customize({
      indent: 2,
      quotes: 'single',
      semi: false,
      commaDangle: 'always-multiline',
      braceStyle: '1tbs',
      arrowParens: true,
    }),
    files: codeFiles,
  },

  {
    name: 'auto-crm/typescript',
    files: codeFiles,
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
    name: 'auto-crm/tailwind',
    files: ['apps/crm/**/*.{vue,ts}'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    rules: {
      // Class order, duplicates and wrapping are formatting: ESLint fixes them.
      // Unknown and conflicting classes are real errors.
      ...betterTailwindcss.configs['recommended-error'].rules,
      'better-tailwindcss/enforce-consistent-line-wrapping': ['error', { printWidth: 100 }],
    },
    settings: {
      'better-tailwindcss': { entryPoint: 'apps/crm/src/styles/main.css' },
    },
  },

  {
    name: 'auto-crm/i18n',
    files: ['apps/crm/**/*.{vue,ts}', 'apps/crm/src/i18n/locales/*.json'],
    plugins: { '@intlify/vue-i18n': vueI18n },
    rules: {
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/no-unused-keys': ['error', { src: 'apps/crm/src', extensions: ['.ts', '.vue'] }],
      '@intlify/vue-i18n/no-v-html': 'error',
      '@intlify/vue-i18n/key-format-style': ['error', 'camelCase'],
      '@intlify/vue-i18n/no-html-messages': 'error',
      '@intlify/vue-i18n/valid-message-syntax': 'error',
    },
    settings: {
      'vue-i18n': {
        localeDir: 'apps/crm/src/i18n/locales/*.json',
        messageSyntaxVersion: '^11.0.0',
      },
    },
  },
  {
    name: 'auto-crm/i18n/locales',
    files: ['apps/crm/src/i18n/locales/*.json'],
    languageOptions: { parser: jsoncParser },
    // The typescript-eslint presets apply to every file; JSON has no types.
    rules: tseslint.configs.disableTypeChecked.rules,
  },

  {
    name: 'auto-crm/tests',
    files: ['**/*.test.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/no-focused-tests': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/require-to-throw-message': 'error',
    },
    settings: { vitest: { typecheck: true } },
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
