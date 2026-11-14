# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is an offline-capable, multi-tenant inventory system for auto shops: one-time license, Ukrainian only, UAH only. `SPEC.md` is the source of truth for requirements, architecture and the roadmap. Read the relevant section before designing anything non-trivial.

The repo is a pnpm workspace:
- `apps/crm`: the Vue app, with Pinia, Vue Router, Tailwind v4, vue-i18n and the `@` → `apps/crm/src` alias. It is an empty shell so far.
- `packages/core`: a source-only package (`exports` points at `src/index.ts`, no build step). It is empty so far.

`packages/adapter-supabase` and `supabase/migrations` don't exist yet. Playwright, Dexie, zod and vite-plugin-pwa are planned but not installed. When you add them, update the commands section below.

## Commands

Use pnpm. Node must be `^22.18.0 || >=24.12.0`.

pnpm enforces a minimum release age of one day, a supply-chain guard. If a fresh version is rejected, pin the newest version older than a day. Don't add `minimumReleaseAgeExclude` entries. Install scripts are opt-in through `allowBuilds` in `pnpm-workspace.yaml`. `esbuild` is denied there because its prebuilt binary arrives as an optional dependency.

Run these from the repo root:

- `pnpm dev`: Vite dev server for `apps/crm`
- `pnpm build`: type-check and build `apps/crm`
- `pnpm type-check`: root config files, then every package (`pnpm -r type-check`)
- `pnpm lint`: ESLint with `--max-warnings 0`
- `pnpm lint:fix`: ESLint autofix. This is also the formatter.
- `pnpm test`: Vitest, run once across all workspace projects
- `pnpm test:watch`: Vitest in watch mode
- `pnpm test --project core`: one project only. Add `-t "name"` to filter by test name.
- `pnpm preview`: serve the production build

Vitest runs from the root `vitest.config.ts`, and each package is an entry in `test.projects`. Only `core` is registered for now (Node environment, `src/**/*.test.ts`). When `apps/crm` needs tests, add a project with the Vue plugin and a DOM environment. Put tests next to the code as `*.test.ts` and import `describe`/`it`/`expect` from `vitest`, since globals are off. Write `it`, not `test`. The lint rules ban `.only` and require `toStrictEqual`.

TypeScript runs with `noUncheckedIndexedAccess`. Expect `T | undefined` from array and record lookups. `packages/core` also enables `exactOptionalPropertyTypes` and has no DOM or Node types.

## Linting and formatting

ESLint is the only formatter, and there is no Prettier. `eslint.config.ts` combines:
- `eslint-plugin-vue` recommended rules
- `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`
- `@stylistic`: 2 spaces, single quotes, no semicolons, trailing commas on multiline

VS Code fixes on save through `.vscode/settings.json`.

Import boundaries are enforced with `no-restricted-imports`:
- `@supabase/*` is allowed only in `packages/adapter-*`.
- Deep imports into workspace packages (`@auto-crm/core/src/...`) are banned.
- `packages/core` may not import Vue, Pinia, Dexie, `node:*`, apps or adapters.

Tailwind classes are linted by `eslint-plugin-better-tailwindcss`, which reads the theme from `apps/crm/src/styles/main.css`. Autofix sorts classes and removes duplicates. Unknown and conflicting classes are errors with no autofix.

Tailwind v4 has no `tailwind.config.js`. Put theme tokens in `@theme` in `apps/crm/src/styles/main.css`, and load Tailwind through the `@tailwindcss/vite` plugin.

## i18n

- **Setup:** vue-i18n runs in Composition API mode (`useI18n()`, `t()`). It's configured in `apps/crm/src/i18n/index.ts`, and the messages live in `apps/crm/src/i18n/locales/uk.json`.
- **Build:** `@intlify/unplugin-vue-i18n` precompiles the JSON, so the app ships the runtime-only build with no message compiler.
- **Keys:** nest them by feature (`products.form.name`), in camelCase.
- **Missing keys:** `t()` accepts any string, so TypeScript won't catch a misspelled key. ESLint does, through `no-missing-keys`. `no-unused-keys` flags keys nothing uses. HTML in messages and `v-html` are banned.
- **Bare text:** `vue/no-bare-strings-in-template` fails on template text that doesn't go through `t()`.

When you add a layer rule, extend the pattern lists in `eslint.config.ts`. Options don't merge across config blocks, so each scope lists its full set.

## Architecture rules (from SPEC.md)

The app is local-first. Screens talk only to a local database, and the sync engine is the only code that talks to the backend. Both the offline requirement and the planned Supabase-to-Node.js migration depend on this rule.

Layers, top to bottom. Each layer calls only the layer below it:
1. **Views and components.** `<script setup lang="ts">` and Tailwind.
2. **Pinia stores.** UI state only, such as filters, scan mode and current user. Stores never call the server.
3. **Services.** One function per use case (`receiveStock`, `adjustStock`, `createProduct`), enforcing rules from `core`.
4. **Repositories.** Interfaces live in `core`; implementations run on Dexie/IndexedDB.
5. **Sync engine.** Holds the outbox, pushes operations in order, pulls by cursor and retries with backoff.
6. **`RemoteGateway`.** Interface in `core` with `auth`, `pushOperations`, `pullChanges` and `bootstrap`. Only adapter packages implement it.

Hard rules:
- **Only adapter packages may import `@supabase/supabase-js`.** ESLint `no-restricted-imports` will enforce this.
- **Business rules live in exactly two places.** One is pure functions in `packages/core`. The other is the single server-side unit that applies pushed operations (one SQL function now). DB triggers handle only `server_seq`, `updated_at` and the audit log.
- **The sync contract is defined once, as zod schemas in `core`.** It consists of `bootstrap`, `push(operations)` (returns accepted, duplicate or rejected per op) and `pull(cursor)` (returns changed rows including tombstones, plus the new cursor).
- **Migrations are plain SQL for standard PostgreSQL.** Don't use Supabase-only features in table design.
- **Only the public key ships in the client.** The service-role key appears only in server functions and provisioning scripts.
- **Validate with zod at every boundary:** forms, scanner input, CSV rows and server-side sync payloads.
- **All UI text goes through `vue-i18n`.** Format dates and numbers with `Intl`, and format money from its currency code.

## Data model invariants

- **Tenancy:** every tenant-owned row has `tenant_id`, and RLS isolates tenants. Cross-tenant isolation tests are the phase 1 gate.
- **Roles:** `super_admin`, `admin` and `staff`, stored per membership. The permission table is in SPEC.md under "Roles and permissions". The server re-checks the role at push time.
- **IDs:** client-generated UUIDs (UUIDv7 preferred), so records can be created offline. Every outbox operation carries `id`, `type`, `payload`, its base version, a client timestamp and a `device_id`. The server dedupes on the operation `id`.
- **Synced table columns:** `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version` and the server-assigned monotonic `server_seq`. All timestamps are UTC.
- **Stock is an append-only ledger.** `stock_movements` rows are never edited or deleted. Current quantity is always the sum of movements: a view on the server and an incrementally updated cache locally. Never store an editable quantity.
- **Movement types and signs:**
  - `initial` and `receive` are positive.
  - `sale`, `consume` and `write_off` are negative.
  - `adjustment` can be either sign and requires a note and the admin role.
  - Copy price and cost onto each movement.
- **Negative stock is allowed and flagged, never rejected.**
- **Money** is an integer in minor units (`*_minor`, kopiykas) with a `currency` column defaulting to `UAH`.
- **Quantities** are decimals with 3 places.
- **Conflicts:**
  - Product fields: last write wins by server receive time; the overwritten edit is kept in `audit_log`.
  - Deletes are soft (tombstones) and can be restored.
  - Barcodes are unique per `(tenant_id, barcode)`. A conflicting push is rejected into the "needs attention" list.
- **`audit_log` is written by the server only.**
- **Analytics** are computed on the device from the local ledger.

## Supabase

`.mcp.json` configures the Supabase MCP server in **read-only** mode against one project. Use it to inspect schema, logs and advisors. Schema changes go through SQL files in `supabase/migrations`, not through the MCP. Supabase skills are vendored under `.agents/skills/`, with symlinks in `.claude/skills/`. Load `supabase-postgres-best-practices` before writing schema, RLS or SQL functions.
