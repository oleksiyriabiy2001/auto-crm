# CLAUDE.md

Offline-capable, multi-tenant inventory system for auto shops: one-time license, Ukrainian only, UAH only. `SPEC.md` is the source of truth for requirements, architecture and the roadmap. Read the relevant section before designing anything non-trivial.

Whenever working with any third-party library or something similar, you MUST look up the official documentation to ensure that you are working with up-to-date information.
Use the docs-explorer subagent for efficient documentation lookup.

## Repo

pnpm workspace:
- `apps/crm`: the Vue app (Pinia, Vue Router, Tailwind v4, vue-i18n). `@` → `apps/crm/src`.
- `packages/core`: source-only package (`exports` → `src/index.ts`, no build step). It has no DOM or Node types and adds `exactOptionalPropertyTypes`. Uses zod 4 (`import { z } from 'zod'`). Schemas are named `XSchema` with their inferred type `X`. Fields are camelCase; adapters map them to snake_case columns.

Not built yet: `packages/adapter-supabase` and `supabase/migrations`. Playwright, Dexie and vite-plugin-pwa are planned but not installed. When you add tooling, update this file.

## Commands

Run from the repo root:
- `pnpm dev` / `pnpm build`
- `pnpm lint` / `pnpm lint:fix`: ESLint is also the formatter. There is no Prettier.
- `pnpm type-check`
- `pnpm test`, or `pnpm test --project core -t "name"` for one project or test

Git hooks are native config-based hooks in `.githooks.gitconfig`: pre-commit lints staged files, and pre-push runs type-check and tests. CI (`.github/workflows/ci.yml`) runs lint, type-check, test and build on `main` and on PRs. Actions there are pinned to commit SHAs, so keep them pinned.

## Dependencies

- **Release age:** pnpm refuses versions less than a day old. If a fresh version is rejected, pin the newest version older than a day. Never add `minimumReleaseAgeExclude` entries.
- **Install scripts:** allowed only through `allowBuilds` in `pnpm-workspace.yaml`.

## Conventions

- **TypeScript:** `noUncheckedIndexedAccess` is on, so expect `T | undefined` from array and record lookups.
- **Tests:** put them next to the code as `*.test.ts`, and import from `vitest` because globals are off. Register new packages in `test.projects` in the root `vitest.config.ts`.
- **Tailwind v4:** there is no `tailwind.config.js`. Theme tokens go in `@theme` in `apps/crm/src/styles/main.css`.
- **i18n:** messages live in `apps/crm/src/i18n/locales/uk.json`. Use camelCase keys nested by feature (`products.form.name`). All UI text goes through `t()`. Format dates and numbers with `Intl`, and money from its currency code.
- **ESLint boundaries:** they are `no-restricted-imports` pattern lists in `eslint.config.ts`. Options don't merge across config blocks, so each scope must list its full set.

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
- **Imports.** Only `packages/adapter-*` may import `@supabase/*`. `packages/core` may not import Vue, Pinia, Dexie, `node:*`, apps or adapters. Import workspace packages only from their entry point. ESLint enforces all of this.
- **Business rules live in exactly two places.** One is pure functions in `packages/core`. The other is the single server-side unit that applies pushed operations (one SQL function now). DB triggers handle only `server_seq`, `updated_at` and the audit log.
- **The sync contract is defined once, as zod schemas in `core`.** It consists of `bootstrap`, `push(operations)` (returns accepted, duplicate or rejected per op) and `pull(cursor)` (returns changed rows including tombstones, plus the new cursor).
- **Migrations are plain SQL for standard PostgreSQL.** Don't use Supabase-only features in table design.
- **Only the public key ships in the client.** The service-role key appears only in server functions and provisioning scripts.
- **Validate with zod at every boundary:** forms, scanner input, CSV rows and server-side sync payloads.

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

`.mcp.json` configures the Supabase MCP server in **read-only** mode. Use it to inspect schema, logs and advisors. Schema changes go through SQL files in `supabase/migrations`, never through the MCP. Load the `supabase-postgres-best-practices` skill before writing schema, RLS or SQL functions.

## Working style

Behavioral guidelines to reduce common LLM coding mistakes. Where they overlap with the project rules above, the project rules win.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- Check SPEC.md and this file first. Ask only when they don't answer the question.
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Structure the architecture rules require is not speculative. Build it even when it looks like overkill today:
- repository and `RemoteGateway` interfaces, even with one implementation
- adapter packages
- i18n for all text, even with one language
- `currency` columns, even with one currency
- zod validation at every boundary, even for data that looks trusted

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently. Style means whatever `pnpm lint:fix` produces. The tree is lint-clean, so running it touches only your lines.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

Done means `pnpm lint`, `pnpm type-check` and `pnpm test` all pass. Unit tests currently run only in `packages/core`. Until `apps/crm` has a Vitest project, verify app code with type-check and by running the app.

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---
