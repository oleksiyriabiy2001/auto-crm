# auto-crm

An offline-capable inventory system for auto shops: multi-tenant, Ukrainian UI, prices in UAH. The app works against a local database in the browser and syncs with the backend (Supabase for now) when it's online.

[SPEC.md](SPEC.md) holds the requirements, architecture and roadmap. [CLAUDE.md](CLAUDE.md) is a short summary of the rules, written for AI coding assistants.

## Requirements

- **Node.js** `^22.18.0` or `>=24.12.0`. CI uses the version in [.nvmrc](.nvmrc), so with nvm, run `nvm use`.
- **pnpm** 12. The exact version is in `packageManager` in [package.json](package.json).
- **Git** 2.54 or newer, for the git hooks. Check with `git --version`.

## Getting started

```sh
pnpm install   # also installs the git hooks
pnpm dev       # http://localhost:5173
```

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

## Project structure

```
apps/crm/          Vue 3 app: Pinia, Vue Router, Tailwind CSS v4, vue-i18n
packages/core/     Domain types, business rules and interfaces. No Vue, no database code.
scripts/           Git hook scripts
.github/workflows/ CI
```

`packages/adapter-supabase` and `supabase/migrations` will be added as the roadmap reaches them.

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

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pushes to `main`, on pull requests and on manual runs. It installs from the lockfile, then runs lint, type-check, tests and the build.

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
