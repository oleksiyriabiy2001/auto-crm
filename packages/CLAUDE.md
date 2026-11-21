# packages

- **core**: source-only (`exports` → `src/index.ts`, no build step). No DOM or Node types; adds `exactOptionalPropertyTypes`. Uses zod 4 (`import { z } from 'zod'`). Schemas are named `XSchema` with inferred type `X`. Fields are camelCase.
- **adapter-supabase**: `createSupabaseGateway({ url, publishableKey })`. Validates every response with the core schemas. Same tsconfig as core plus DOM types.
- **contract-tests**: `describeGatewayContract(harness)`, the suite every adapter must pass (SPEC.md "Contract tests"). Each adapter runs it from a `*.contract.test.ts` file with a harness that provisions two shops, registered in `vitest.contract.config.ts`.
