# supabase

Load the `supabase-postgres-best-practices` skill before writing schema, RLS or SQL functions.

- `migrations/` holds plain SQL for standard PostgreSQL. No Supabase-only features in table design.
- `tests/database/` holds pgTAP tests, including the tenant isolation gate.
- The sync API is three SQL functions (`public.push`, `public.pull`, `public.bootstrap`) that take and return exactly the camelCase JSON of the zod contract in `core`; columns are snake_case.
- `push` can't run zod, so it re-checks every payload itself and rejects malformed operations as `invalidPayload`.
- Clients only read tables (RLS) and write only through `push`. Grants are explicit allow-lists: a new table or function gets no client access until its migration grants it.
- `.mcp.json` configures the Supabase MCP server read-only. Use it to inspect schema, logs and advisors; schema changes go through migration files, never the MCP.

## Commands (need Docker)

- `supabase start` / `supabase stop`
- `supabase db reset`: re-apply migrations and `seed.sql` (demo shop; `owner@`, `admin@` and `staff@example.com`, password `password123`). Password reset emails land in Mailpit at http://127.0.0.1:54324.
- `supabase test db`: run the pgTAP tests
