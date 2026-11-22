# CLAUDE.md

Offline-capable, multi-tenant inventory system for auto shops: one-time license, Ukrainian only, UAH only. `SPEC.md` is the source of truth for requirements, architecture and the roadmap. Read the relevant section before designing anything non-trivial.

Before using any third-party library, check its current official docs with the docs-explorer subagent.

More rules live next to the code and load when you work there: `apps/crm/CLAUDE.md`, `packages/CLAUDE.md`, `supabase/CLAUDE.md`.

## Repo

pnpm workspace:
- `apps/crm`: the Vue app (Pinia, Vue Router, Tailwind v4, vue-i18n).
- `packages/core`: domain types, zod contract, repository and gateway interfaces, pure business rules.
- `packages/adapter-supabase`: the Supabase `RemoteGateway`.
- `packages/contract-tests`: the shared suite every adapter must pass.
- `supabase/`: local Supabase project (SQL migrations, pgTAP tests, seed).

Playwright and vite-plugin-pwa are planned but not installed. When you add tooling, update the relevant CLAUDE.md.

## Commands

Run from the repo root:
- `pnpm dev` / `pnpm build`
- `pnpm lint` / `pnpm lint:fix`: ESLint is also the formatter. There is no Prettier.
- `pnpm type-check`
- `pnpm test`, or `pnpm test --project core -t "name"` for one project or test
- `supabase start` / `supabase stop` / `supabase db reset` / `supabase test db`: see `supabase/CLAUDE.md`
- `pnpm test:contract`: contract suite against local Supabase (needs `supabase start`; not part of `pnpm test`)

Git hooks (`.githooks.gitconfig`): pre-commit lints staged files, pre-push runs type-check and tests. CI (`.github/workflows/ci.yml`) runs lint, type-check, test and build, plus a job with local Supabase for pgTAP and contract tests. Actions are pinned to commit SHAs; keep them pinned.

## Dependencies

- pnpm refuses versions less than a day old. Pin the newest version older than a day. Never add `minimumReleaseAgeExclude` entries.
- Install scripts are allowed only through `allowBuilds` in `pnpm-workspace.yaml`.

## Conventions

- `noUncheckedIndexedAccess` is on: expect `T | undefined` from array and record lookups.
- Tests sit next to the code as `*.test.ts` and import from `vitest` (globals are off). Register new packages in `test.projects` in the root `vitest.config.ts`.
- ESLint boundaries are `no-restricted-imports` pattern lists in `eslint.config.ts`. Options don't merge across config blocks, so each scope must list its full set.

## Architecture rules

The app is local-first: screens talk only to a local database, and the sync engine is the only code that talks to the backend. The offline requirement and the planned Supabase-to-Node.js migration both depend on this. Layers, each calling only the one below (details in SPEC.md "Architecture"):

1. Views and components
2. Pinia stores: UI state only, never call the server
3. Services: one method per use case, enforcing rules from `core`
4. Repositories: interfaces in `core`, implemented on Dexie/IndexedDB
5. Sync engine: outbox, ordered push, cursor pull, retry with backoff
6. `RemoteGateway`: interface in `core` (`auth`, `pushOperations`, `pullChanges`, `bootstrap`), implemented only by adapter packages

Hard rules (ESLint enforces the import ones):
- Only `packages/adapter-*` may import `@supabase/*`. `packages/core` may not import Vue, Pinia, Dexie, `node:*`, apps or adapters. Import workspace packages only from their entry point.
- Business rules live in exactly two places: pure functions in `core`, and the single server-side unit that applies pushed operations (one SQL function now). DB triggers handle only `server_seq`, `updated_at` and the audit log.
- The sync contract (`bootstrap`, `push`, `pull`) is defined once, as zod schemas in `core`.
- Validate with zod at every boundary: forms, scanner input, CSV rows, sync payloads.
- Only the public key ships in the client. The service-role key appears only in server functions and provisioning scripts.

## Data model invariants

Full model and conflict rules: SPEC.md "Data model" and "Conflict rules".

- Every tenant-owned row has `tenant_id`; RLS isolates tenants. Cross-tenant isolation tests are the phase 1 gate.
- Roles `super_admin`, `admin`, `staff` are stored per membership (permission table: SPEC.md "Roles and permissions"). The server re-checks the role at push time.
- IDs are client-generated UUIDs (v7 preferred). Each outbox operation carries `id`, `type`, `payload`, base version, client timestamp and `device_id`; the server dedupes on `id`.
- Synced tables have `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version`, `server_seq`. Timestamps are UTC.
- Stock is an append-only ledger: `stock_movements` are never edited or deleted, and quantity is always the sum of movements. Never store an editable quantity.
- `initial`/`receive` are positive; `sale`/`consume`/`write_off` negative; `adjustment` either sign, needs a note and the admin role. Copy price and cost onto each movement. Negative stock is flagged, never rejected.
- Money is integer minor units (`*_minor`) with a `currency` column defaulting to `UAH`. Quantities are decimals with 3 places.
- Product fields: last write wins by server receive time, the loser kept in `audit_log`. Deletes are soft and restorable. Barcodes are unique per `(tenant_id, barcode)`; a conflicting push goes to "needs attention".
- `audit_log` is written by the server only. Analytics are computed on the device from the local ledger.

## Working style

Where these overlap with the rules above, the rules above win.

- **Think first.** Check SPEC.md and these files; ask only when they don't answer. State assumptions, surface competing interpretations and simpler alternatives, and stop to ask when something is unclear.
- **Simplicity.** Minimum code for the request: no speculative features, abstractions or configurability. Structure the architecture rules require is not speculative, so build it even with one implementation: repository and gateway interfaces, adapter packages, i18n, `currency` columns, zod at every boundary.
- **Surgical changes.** Every changed line traces to the request. Don't reformat or refactor adjacent code; style is whatever `pnpm lint:fix` produces. Remove orphans your change created; mention unrelated dead code instead of deleting it.
- **Verify.** Turn tasks into checks (a failing test first for bugs and validation). Done means `pnpm lint`, `pnpm type-check` and `pnpm test` pass. For multi-step work, state a short plan with a check per step.
