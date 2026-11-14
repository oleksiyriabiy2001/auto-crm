# Auto Shop CRM: Technical Specification

## Overview and scope

The goal is an offline-capable inventory system for auto shops, sold to many shops as a one-time-license product, starting in Ukraine. Version 1 covers inventory only; everything else is parked but kept in mind so the design does not block it.

Terms used below: a **tenant** is one shop that bought the product, a **user** is a person working in that shop, and the **platform owner** is you. A shop's top account is its super admin.

### In scope for v1

- Inventory list with search, filters and sorting
- Admin-only edit and delete (delete is a soft delete)
- Adding and receiving stock with a barcode scanner (USB or Bluetooth scanner, and phone camera)
- A stock movement history: receive, sale or consume, adjustment, write-off
- Basic analytics on stock and movements
- Full offline use with automatic sync when the connection returns
- CSV import of a shop's existing product list, so onboarding a new shop is fast
- Multi-tenant data isolation, with accounts created manually by the platform owner after payment

### Out of scope for v1

Customers, vehicles and work orders; invoices and payments; the customer portal (online product reservations and service appointments); in-app billing or license checks; languages other than Ukrainian; currencies other than UAH; multiple warehouses or branches per shop.

### Key decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Tenancy | One shared database, every row carries `tenant_id`, isolation enforced by database rules | Cheapest to run and update across many shops |
| Offline | Local-first: the UI reads and writes a local browser database, a sync engine pushes and pulls in the background | The shop floor often has poor connectivity |
| Stock quantity | Append-only movement ledger; quantity is the sum of movements | Offline devices can never overwrite each other's counts |
| Backend swap | All server access goes through one small `RemoteGateway` interface and a documented sync API | Moving from Supabase to Node.js means writing one new adapter |
| Licensing | One-time license handled outside the app; you create the tenant and its first account by hand | No billing code to build or maintain |
| Locale | Ukrainian and UAH only, but text lives in i18n files and money carries a currency code | Adding languages and currencies later stays cheap |

### Assumptions

- Items are parts, fluids and consumables, not whole vehicles for sale.
- Each shop has a single stock location.
- Each user belongs to exactly one shop.

## Architecture

The app is a local-first Vue single-page app: screens only talk to a local database, and a sync engine is the only code that talks to the backend. That one rule keeps the offline requirement and the "switch backend later" requirement from fighting each other.

### Layers

1. **Views and components.** Vue 3 with `<script setup lang="ts">` and Tailwind.
2. **Pinia stores.** UI state only: filters, scan mode, current user. No server calls.
3. **Services.** One function per use case, such as `receiveStock`, `adjustStock`, `createProduct`. They enforce business rules from `core`.
4. **Repositories.** Interfaces defined in `core`, implemented on a local IndexedDB database (Dexie).
5. **Sync engine.** Keeps an outbox of pending operations, pushes them, pulls changes by cursor, retries with backoff.
6. **RemoteGateway.** An interface defined in `core` with `auth`, `pushOperations`, `pullChanges` and `bootstrap`. `adapter-supabase` implements it now; an HTTP adapter for Node.js implements it later.

Only adapter packages may import `@supabase/supabase-js`. An ESLint `no-restricted-imports` rule enforces this, so a Supabase call can never leak into a component or a store.

Screens call services, services call repositories, and repositories touch only the local database. The sync engine moves operations through RemoteGateway, so swapping the adapter swaps the backend.

### Repository layout

The project is a pnpm workspace. A solo start can use only the first two rows and add the rest when they are needed.

| Path | Contents |
| --- | --- |
| `apps/crm` | The staff Vue app |
| `packages/core` | Domain types, zod schemas, repository and gateway interfaces, pure business rules (stock math, permission checks) |
| `packages/adapter-supabase` | `RemoteGateway` for Supabase |
| `packages/adapter-http` (later) | `RemoteGateway` for the Node.js backend |
| `apps/portal` (later) | Customer portal, reusing `core` |
| `supabase/migrations` | Plain SQL: schema, access rules, functions |

### Tenancy, roles and provisioning

Every tenant-owned table has a `tenant_id`, and database row-level security allows a user to touch only rows of their own tenant. Roles are `super_admin`, `admin` and `staff`, stored per membership. The `super_admin` is a shop's top account, created by you at provisioning. There is no platform-wide account inside the app.

After a shop pays you, provisioning is manual:

1. Create the tenant row.
2. Create the shop's first account and give it the `super_admin` role.
3. Hand over the credentials; the shop's super admin adds their own staff.

Each tenant has a `status` of `active` or `suspended`, checked by the server on every sync. It is a switch for you to use, not a license check, because the license is one-time and lives outside the app.

## Offline-first design

Every device keeps a full copy of its shop's catalog and records changes as operations, so work never waits for the network. The design is deliberately simple: stock changes are append-only, and only a few kinds of edits can conflict.

### How it works

1. On first sign-in the app downloads the shop's products, barcodes and movements into IndexedDB (`bootstrap`).
2. Every write is saved locally at once and appended to an outbox as an operation with a client-generated UUID.
3. When online, the sync engine pushes the outbox in order. The server applies each operation once, using the UUID to ignore repeats, and answers accepted or rejected per operation.
4. The engine then pulls everything changed since its last cursor and merges it into the local database.
5. The UI always reads the local database, so pending changes show immediately with a "not synced yet" mark.

### Conflict rules

| Data | Rule | Reason |
| --- | --- | --- |
| Stock movements | Append-only, never edited. Quantity is the sum of movements. | Two devices selling the same item offline both count; nothing is overwritten. |
| Product fields | Last write wins by server receive time. The overwritten edit stays in the audit log. | Only admins edit products, so real conflicts are rare. |
| Deletes | Soft delete with a tombstone. An admin can restore. | Past movements and analytics keep working. |
| Barcodes | Unique per `(tenant_id, barcode)`. If two offline devices attach one barcode to different products, the later push is rejected and lands in a "needs attention" list. | A barcode must point to one product. |
| Negative stock | Allowed and flagged. | A sale already happened in the real world; the app must not reject it. |
| Permissions | The server re-checks the role at push time. Operations from a user who lost rights while offline are rejected and listed in "needs attention". | Offline devices cannot bypass role changes. |

### Sessions while offline

The session is cached on the device, so the app opens and works without a connection. The offline window is limited; the proposed default is 14 days, configurable. After it, or after the server rejects the token, the user signs in online and the outbox is pushed.

Outbox entries belong to the account that created them. Signing out with unsynced changes shows a warning, and those changes are only pushed by the same account.

### App shell and scanning offline

- A service worker (`vite-plugin-pwa`) caches the app, so it installs on phones and tablets and loads without a network.
- Barcode lookups hit the local database, so both USB scanners and the camera work offline.
- Camera scanning uses the browser `BarcodeDetector` API where it exists and a WebAssembly decoder as fallback. Both run on the device.

### Storage risks

Browsers can evict IndexedDB. The app requests persistent storage and always shows a count of unsynced changes. Clearing browser data with unsynced changes loses them, so the warning is prominent. Local data is not encrypted at rest in v1; see the security notes later.

### Sync API contract

The whole backend surface for sync is two calls, defined as zod schemas in `core`:

- `push(operations)` returns one result per operation: accepted, duplicate, or rejected with a reason.
- `pull(cursor)` returns rows changed since the cursor, including tombstones, and the new cursor. Every synced row carries a monotonically increasing `server_seq`.

Operation types in v1: `product.create`, `product.update`, `product.delete`, `barcode.add`, `barcode.remove`, `stock.move`. Each operation carries `id`, `type`, `payload`, the version it was based on where relevant, the client timestamp and a device id.

## Data model

Eight tables cover v1. Stock is a ledger of movements, so the current quantity of a product is never typed in; it is always the sum of its movements.

### Conventions

- IDs are UUIDs generated on the client (UUIDv7 preferred), so devices can create records offline.
- Money is an integer in minor units (kopiykas) next to a `currency` column that defaults to `UAH`.
- Quantities are decimals with three places, because fluids are sold by the litre.
- Every synced table has `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version` and a server-assigned `server_seq`.
- All timestamps are UTC.

### Tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `tenants` | `id`, `name`, `status` (active, suspended) | Created by hand |
| `profiles` | `id` (same as the login id), `display_name` | One per login |
| `memberships` | `id`, `tenant_id`, `user_id`, `role` (`super_admin`, `admin`, `staff`), `is_active` | v1: one per user |
| `categories` | `id`, `tenant_id`, `name`, `parent_id` | Optional simple tree |
| `products` | `id`, `tenant_id`, `sku`, `name`, `description`, `category_id`, `unit` (pcs, l, kg, set, m), `cost_price_minor`, `sale_price_minor`, `currency`, `min_stock`, `location_note`, `is_active` | `sku` unique per tenant when set |
| `product_barcodes` | `id`, `tenant_id`, `product_id`, `barcode`, `symbology` | Unique per `(tenant_id, barcode)`; several barcodes per product allowed |
| `stock_movements` | `id`, `tenant_id`, `product_id`, `type`, `quantity_delta`, `unit_cost_minor`, `unit_price_minor`, `note`, `occurred_at`, `created_by`, `device_id`, `source_type`, `source_id` | Never edited or deleted |
| `audit_log` | `id`, `tenant_id`, `actor_id`, `entity`, `entity_id`, `action`, `changes`, `at` | Written by the server only |

Several barcodes per product matter in practice: a part has the manufacturer's code, and the shop often adds its own label.

### Movement rules

- Types are `initial`, `receive`, `sale`, `consume`, `adjustment` and `write_off`.
- `receive` and `initial` are positive; `sale`, `consume` and `write_off` are negative; `adjustment` can be either and requires a note.
- Price and cost are copied onto the movement, so history stays correct when a product's price changes later.
- Current stock per product is a derived value: a database view on the server and an incrementally updated cache in the local database.

### Room for parked modules

`source_type` and `source_id` on movements stay empty in v1. A later work order can write its consumed parts as `consume` movements pointing back at it. Customers, vehicles (VIN, plate, mileage) and work orders become new tables beside these; product reservations for the portal become holds that reduce available stock without touching on-hand stock.

## Functional requirements

Version 1 is done when a shop can receive, find, sell and count stock with a scanner, online or offline, with roles enforced. Priorities use Must (needed for v1) and Should (planned for v1, first to cut if time runs short).

### Roles and permissions

Staff permissions are a proposed default; see the open questions.

| Capability | Staff | Admin | Super admin |
| --- | --- | --- | --- |
| View products, stock and history | Yes | Yes | Yes |
| Scan and look up | Yes | Yes | Yes |
| Record receive, sale and consume movements | Yes | Yes | Yes |
| Create products, including from a scan | Yes | Yes | Yes |
| Edit existing products and barcodes | No | Yes | Yes |
| Delete and restore products | No | Yes | Yes |
| Adjustments and write-offs | No | Yes | Yes |
| See cost prices, analytics and the audit log | No | Yes | Yes |
| Import and export CSV | No | Yes | Yes |
| Manage the shop's users | No | No | Yes |

### Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| INV-1 | Product list with search by name, SKU and barcode; filters for category and low stock; sortable columns | Must |
| INV-2 | Product detail with current stock, barcodes and movement history | Must |
| INV-3 | Create a product (all roles) | Must |
| INV-4 | Edit a product (admin and super admin) | Must |
| INV-5 | Soft delete and restore (admin and super admin); deleted products disappear from lists and scans but stay in history | Must |
| INV-6 | Simple categories | Should |
| INV-7 | CSV import with column mapping and a preview before saving; rows matched to existing products by SKU or barcode | Should |
| INV-8 | CSV export of products and current stock | Should |
| SCN-1 | Hardware scanner support: fast key bursts ending in Enter are treated as a scan anywhere in the app, without focusing a field | Must |
| SCN-2 | Camera scanning on phones and tablets | Must |
| SCN-3 | Scan modes: lookup, receive (each scan adds one, quantity editable) and sale or consume | Must |
| SCN-4 | Unknown barcode offers two choices: create a product with the barcode filled in, or attach it to an existing product | Must |
| SCN-5 | Formats EAN-13, EAN-8, UPC-A and Code 128; QR and Data Matrix later | Must |
| SCN-6 | Sound and colour feedback on every scan | Should |
| STK-1 | Record a movement with type, quantity and optional note | Must |
| STK-2 | Negative stock is allowed and flagged | Must |
| STK-3 | Adjustments require a note and the admin role | Must |
| STK-4 | Low-stock threshold per product | Must |
| STK-5 | Stocktake mode: scan everything counted, review the differences, then apply them as adjustments | Should |
| SYN-1 | Status indicator: online or offline, number of unsynced changes, last sync time | Must |
| SYN-2 | "Needs attention" list for rejected operations, with retry and discard | Must |
| USR-1 | Email and password sign-in with password reset | Must |
| USR-2 | Super admin adds and deactivates the shop's staff accounts in the app. Until then you create accounts by hand. | Should |
| AUD-1 | Audit log of product edits, deletes and adjustments, visible to admin and super admin | Must |

### Analytics

Reports are computed on the device from the local movement ledger, so they work offline and behave the same on any backend. All reports can be filtered by date range and category.

- **Stock overview:** number of products, units on hand, stock value at cost and at sale price.
- **Low and out of stock:** products at or below their threshold.
- **Movements by period:** received versus sold or consumed, per week or month, as a chart.
- **Top movers:** products with the most outgoing quantity in the period.
- **Slow stock:** products with no outgoing movement for a chosen number of days.
- **Data quality:** negative stock, products without a barcode, products without a price.

If a shop's history grows too large to compute on the device, the same reports move behind the gateway as server-side queries without changing the screens.

### Platform owner tasks

In v1 these are done with a documented script or the Supabase dashboard: create a tenant, create its super admin account, suspend or reactivate a tenant. You have no account inside the app, so these tasks never go through it. A small internal screen is a later option.

## Backend migration strategy

Moving from Supabase to Node.js should mean writing one new adapter and, if needed, re-hosting the database, not rewriting the app. Four rules make that true, and a shared test suite proves it.

### What is Supabase-specific

| Piece | Used for | On Node.js |
| --- | --- | --- |
| Supabase Auth | Sign-in and tokens | Any auth library or identity provider, exposed through `RemoteGateway.auth` |
| Row-level security | Tenant isolation and roles | Authorization middleware implementing the permission table above; RLS can stay as a second layer |
| Auto-generated table API and RPC | Reading and writing data | REST endpoints for `bootstrap`, `push` and `pull` |
| SQL or edge functions | Applying pushed operations, inviting users | Route handlers |
| Dashboard | Provisioning tenants | A script or an internal admin screen |

### Four rules

1. The app imports nothing from Supabase outside the adapter package; lint enforces it.
2. The sync contract (`bootstrap`, `push`, `pull`) is defined once in `core` as zod schemas. It is also the source of the API description the Node backend must follow.
3. Business rules live in two places only: pure functions in `core`, and one server-side unit that applies pushed operations (a single SQL function now, a route handler later). Database triggers are limited to `server_seq`, `updated_at` and the audit log.
4. The schema is plain SQL migrations for standard PostgreSQL, with no Supabase-only features in table design.

### Contract tests

One test suite runs the same scenarios against any `RemoteGateway`: tenant isolation (a user of shop A never reads shop B), the role table, repeated operations ignored, tombstones, barcode conflict rejection and cursor paging. The Supabase adapter passes it from the start; the Node adapter must pass it before cutover.

### Migration path

1. Build the Node API on top of the same PostgreSQL database, plus `adapter-http`, and make the contract tests pass.
2. Decide on auth. Either the Node API keeps validating Supabase tokens for a while, or accounts move to another provider once step 1 is stable.
3. Select the adapter with a build-time setting, so the app switches without code changes.
4. Move the database to a new host only if there is a reason; the schema travels as plain SQL.

### When to switch

Switch for a concrete reason, not because Node.js feels more serious. Good reasons: a rule that cannot be expressed cleanly in row-level security or SQL functions; cost or usage limits; a customer requirement about where data is hosted; integrations that need a long-running server.

## Non-functional requirements

Tenant isolation comes first, because one mistake would show one shop's stock and prices to another. Speed and offline behaviour come second.

### Security

- Row-level security on every tenant table, covered by automated tests that try to cross tenants.
- Only the public key ships in the app. The service-role key exists only in server-side functions and provisioning scripts.
- All input is validated with zod at the boundaries: forms, scanner input, CSV rows, and sync payloads on the server.
- The audit log is written by the server and cannot be edited by clients.
- Local data is not encrypted at rest in v1, and a lost device cannot be wiped remotely. Deactivating the user blocks further sync. Both are known limits for later.

### Performance

- Lists and search read the local database, so they respond instantly regardless of network.
- Target to confirm with a real shop's data: a catalog of tens of thousands of products searches without visible delay, using Dexie indexes plus an in-memory text index for name search.
- Large tables use list virtualization.
- The first download is paged with a progress bar; later syncs are incremental.

### Compatibility and usability

- Current desktop browsers, Chrome on Android and Safari on iOS, as an installable PWA. Safari can clear site data for sites that are not installed, so installing to the home screen is recommended on iOS.
- Responsive layout: a dense table on desktop and a scanning screen with large buttons on phones.
- Desk work is keyboard-friendly.
- Text lives in `vue-i18n` files with Ukrainian as the only language in v1. Dates and numbers use `Intl`, and money is formatted from its currency code.

### Tooling

| Area | Choice |
| --- | --- |
| Framework | Vue 3, TypeScript in strict mode, Vite |
| Packages | pnpm workspace |
| State and routing | Pinia, Vue Router |
| Local database | Dexie (IndexedDB) |
| Validation | zod |
| Styling | Tailwind CSS |
| PWA and i18n | `vite-plugin-pwa`, `vue-i18n` |
| Lint | ESLint with TypeScript and Vue rules |
| Unit tests | Vitest |
| End-to-end tests | Playwright, including offline scenarios: go offline, record work, reconnect, check sync |
| Database tests | The shared contract suite, plus tests of the role table |
| CI | Lint, type check, unit, contract and end-to-end tests on every push |

Keep a `CLAUDE.md` at the repository root that summarises the rules in this document.

### Operations

- Separate development, staging and production Supabase projects.
- Database backups with a documented restore, plus per-shop CSV export as a second safety net.
- Error tracking in production, so a failed sync on a shop's device is visible to you.

## Roadmap

Build in four phases, each ending in a gate that must hold before the next one starts. Offline sync is built in phase 1, not added at the end, because retrofitting it would be the costliest change in this design.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1. Foundation | Workspace and core types, database schema and tenants, sign-in and roles, contract tests | The tenant isolation tests pass |
| 2. Offline inventory | Local database, sync engine, products and stock, audit log | The app works offline and syncs without losing data |
| 3. Scanner and reports | Hardware and camera scanning, scan modes, analytics reports, CSV import and export, stocktake | Scanning and reports work offline |
| 4. Pilot shop | One real shop using it, fixes from what turns up, the provisioning script, backup and restore | Ready to sell to other shops |

After v1, not scheduled: work orders and customers, the customer portal, more languages and currencies, and the Node.js backend if it is needed.