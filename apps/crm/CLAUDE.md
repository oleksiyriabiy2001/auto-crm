# apps/crm

- `@` → `apps/crm/src`.
- `src/gateway.ts` is the composition root and the only place that picks the backend. Only services and the sync engine import it.
- Supabase URL and publishable key come from `VITE_SUPABASE_*` env vars (`.env.development` holds local defaults).
- Routes need a session unless `meta.public` is set.
- Vitest project `crm` (`pnpm test --project crm`) runs `src/**/*.test.ts` in Node. Tests of `src/data/` pass an in-memory IndexedDB from `fake-indexeddb` to `LocalDatabase`, a fresh `IDBFactory` per test. UI code is still verified with `pnpm type-check` and by running the app.

## UI

- Views and components use `<script setup lang="ts">` and Tailwind.
- Tailwind v4 has no `tailwind.config.js`. Theme tokens go in `@theme` in `src/styles/main.css`.
- All UI text goes through `t()`. Messages live in `src/i18n/locales/uk.json` with camelCase keys nested by feature (`products.form.name`). Format dates and numbers with `Intl`, and money from its currency code.

## Project structure

Code is grouped by feature. There are no app-wide `stores/`, `services/` or `components/` folders outside `src/shared/`.

```
src/
  features/<feature>/         a page or a group of related pages
    <Name>View.vue            pages
    <feature>.routes.ts       exports `<feature>Routes: RouteRecordRaw[]`
    <feature>.service.ts      class + exported instance
    <feature>.store.ts        Pinia store
    <feature>.types.ts / <feature>.schema.ts (zod form schemas)
    components/               PascalCase .vue
    composables/              use<Name>.ts
  shared/                     used by several features: services/ stores/ components/ composables/
  data/                       Dexie: LocalDatabase (one per shop) and the core repository interfaces
  sync/                       (phase 2) the sync engine
  router/index.ts             combines feature routes, guards sign-in
  gateway.ts                  picks the backend
```

- A feature owns its folder; create only the files it needs. Related pages that share code (login, forgot password, set password) are one feature.
- Inside a feature, import its own files relatively. A feature never imports another feature, and `src/shared/` never imports a feature; move shared code to `src/shared/`. ESLint enforces both.
- File names: `<name>.store.ts`, `<name>.service.ts`, etc., named after the feature or shared concern (`session.store.ts`). Pages end in `View.vue`.
- **Services** are classes with one method per use case, dependencies through the constructor, and one exported instance so tests can build their own with fakes:
  ```ts
  export class AuthService {
    constructor(private readonly gateway: RemoteGateway) {}
    signIn(email: string, password: string) { return this.gateway.auth.signIn(email, password) }
  }
  export const authService = new AuthService(gateway)
  ```
- **Local database:** only services and the sync engine use `src/data/`. Inside `DexieTransactionRunner.run`, await only repository calls: a network call or timer inside an IndexedDB transaction lets it commit early. IndexedDB can't index booleans or null, so filter `deletedAt` and `isActive` in code. A schema change is a new `this.version(n)` in `LocalDatabase`; never edit a shipped version.
- **Stores** use the setup-function form of `defineStore`, export `use<Name>Store`, and call services, never the gateway.
