# auto-crm

An offline-capable inventory system for auto shops: multi-tenant, Ukrainian UI, prices in UAH. The app works against a local database in the browser and syncs with the backend (Supabase for now) when it's online.

[SPEC.md](SPEC.md) holds the requirements, architecture and roadmap. [CLAUDE.md](CLAUDE.md) is a short summary of the rules, written for AI coding assistants. More detailed rules sit in `CLAUDE.md` files inside `apps/crm`, `packages` and `supabase`.

## Requirements

- **Node.js** `^22.18.0` or `>=24.12.0`. CI uses the version in [.nvmrc](.nvmrc), so with nvm, run `nvm use`.
- **pnpm** 12. The exact version is in `packageManager` in [package.json](package.json).
- **Git** 2.54 or newer, for the git hooks. Check with `git --version`.
- **Supabase CLI** and **Docker**, for the local backend. Docker must be running before `supabase start`.

## Getting started

```sh
pnpm install      # also installs the git hooks
supabase start    # local backend in Docker
supabase db reset # apply migrations and the demo seed
pnpm dev          # http://localhost:5173
```

The seed creates a demo shop with three accounts: `owner@example.com`, `admin@example.com` and `staff@example.com`, all with the password `password123`. Password reset emails land in Mailpit at http://127.0.0.1:54324. Local Supabase URL and key defaults are in `apps/crm/.env.development`.

## Scripts

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Type-check and build the app for production |
| `pnpm preview` | Serve the production build locally |
| `pnpm lint` | Lint everything. Any warning fails. |
| `pnpm lint:fix` | Fix lint issues and format the code |
| `pnpm type-check` | Type-check every package |
| `pnpm test` | Run the unit tests once |
| `pnpm test:watch` | Run the unit tests in watch mode |
| `pnpm test:contract` | Run the adapter contract tests against local Supabase (needs `supabase start`) |
| `supabase start` / `supabase stop` | Start or stop local Supabase in Docker |
| `supabase db reset` | Re-apply all migrations and `supabase/seed.sql` |
| `supabase test db` | Run the pgTAP database tests, including tenant isolation |

## Project structure

```
apps/crm/                   Vue 3 app: Pinia, Vue Router, Tailwind CSS v4, vue-i18n
packages/core/              Domain types, zod sync contract, interfaces and business rules. No Vue, no database code.
packages/adapter-supabase/  RemoteGateway implementation for Supabase
packages/contract-tests/    Shared test suite every RemoteGateway adapter must pass
supabase/                   Local Supabase project: SQL migrations, pgTAP tests, seed
scripts/                    Git hook scripts
.github/workflows/          CI
```

## Code style

ESLint checks the code and also formats it. There is no Prettier. Run `pnpm lint:fix`, or let VS Code fix files on save.

Open the repo in VS Code and install the recommended extensions when prompted: Vue (Official), ESLint and Tailwind CSS IntelliSense. The shared [.vscode/settings.json](.vscode/settings.json) turns on fix-on-save.

## Git hooks

The hooks use Git's built-in config-based hooks, so there's no husky. [.githooks.gitconfig](.githooks.gitconfig) defines them, and `pnpm install` connects that file to your local `.git/config`.

| Hook | Runs | Time |
| --- | --- | --- |
| pre-commit | ESLint on the staged files | about a second |
| pre-push | `pnpm type-check` and `pnpm test` | a few seconds |

Useful commands:

```sh
git hook list pre-commit       # show the active hooks
git hook run pre-commit        # run a hook without committing
git commit --no-verify         # skip the hooks once
sh scripts/setup-git-hooks.sh  # reconnect the hooks
```

Reconnecting is needed only if `git hook list` shows nothing. That happens in an existing clone if `pnpm install` had nothing to install and skipped the setup step.

**"pnpm: No such file or directory" when committing from VS Code or another git GUI.** These apps don't read `~/.zshrc`, where pnpm and nvm usually add themselves to `PATH`. The hook scripts handle this by loading your login shell's `PATH` ([scripts/hook-env.sh](scripts/hook-env.sh)). If that still fails, move the `PATH` setup for pnpm and Node from `~/.zshrc` to `~/.zprofile`.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pushes to `main`, on pull requests and on manual runs. It has two jobs:

- **Lint, type-check, test, build** installs from the lockfile and runs those four steps.
- **Database and contract tests** starts local Supabase, then runs the pgTAP tests and the contract tests.

### Updating a GitHub Action

Each action is pinned to the commit of a specific release, not to a tag like `v7`. A tag can be moved to different code, and a commit can't, so a hijacked action can't change what CI runs. The comment after each pin shows the release:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

To update one, find the new release on the action's GitHub page, get its commit, and replace both the SHA and the comment:

```sh
git ls-remote https://github.com/actions/checkout.git 'refs/tags/v7.0.2^{}' 'refs/tags/v7.0.2'
# Use the ^{} line if there is one. Otherwise use the plain tag line.
```

## Dependencies

- **New versions must be at least a day old.** pnpm refuses anything newer, which protects against compromised releases that are usually caught within hours. If an install fails for this reason, use the previous version. Don't add exceptions under `minimumReleaseAgeExclude`.
- **Install scripts are blocked by default.** To allow one, add it under `allowBuilds` in [pnpm-workspace.yaml](pnpm-workspace.yaml), and only when the package really needs it.
