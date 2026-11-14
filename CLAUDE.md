# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is an offline-capable, multi-tenant inventory system for auto shops: one-time license, Ukrainian only, UAH only. `SPEC.md` is the source of truth for requirements, architecture and the roadmap. Read the relevant section before designing anything non-trivial.

The repo is still the stock `create-vue` scaffold: a single Vite app in `src/`, with Pinia, Vue Router and the `@` → `./src` alias. None of the target architecture below exists yet. The spec plans a pnpm workspace with `apps/crm`, `packages/core`, `packages/adapter-supabase` and `supabase/migrations`. ESLint, Vitest, Playwright, Tailwind, Dexie, zod, vue-i18n and vite-plugin-pwa are planned but not installed. When you add them, update the commands section below.

## Commands

Use pnpm. Node must be `^22.18.0 || >=24.12.0`.

- `pnpm dev`: Vite dev server
- `pnpm build`: runs type-check and `vite build` in parallel
- `pnpm type-check`: `vue-tsc --build`
- `pnpm preview`: serve the production build

No lint or test tooling is set up yet.

TypeScript runs with `noUncheckedIndexedAccess`. Expect `T | undefined` from array and record lookups.

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
