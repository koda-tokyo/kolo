# Repository guidelines for contributors and coding agents

This file is read by people and by coding agents. It describes how the repository is organised and the rules that keep it shippable. Nothing here is specific to any person or machine.

## Layout

- `src/` — TypeScript (ESM). CLI wiring in `src/cli`, commands in `src/commands`, gateway in `src/gateway`, agents in `src/agents`, config in `src/config`, infrastructure in `src/infra`, channels in `src/channels` and per-channel directories.
- Tests are colocated as `*.test.ts`; end-to-end tests as `*.e2e.test.ts`.
- `packages/client` — generated `@kodasoken/kurahi-client`. Regenerate with `pnpm client:gen`; `pnpm client:check` fails CI on drift.
- `openapi/` — committed OpenAPI document generated from `src/gateway/http-routes.ts`; `pnpm openapi:check` fails CI on drift.
- `extensions/*` — workspace packages (channels, providers). Plugin-only dependencies belong in the extension's `package.json`, never in the root. Avoid `workspace:*` in a plugin's `dependencies`.
- `docs/` — documentation source (Mintlify), published at the docs URL in `src/config/product-urls.ts`. Internal links are root-relative without `.md`.
- `scripts/` — build, release, install and check scripts. `private/` is a git-ignored overlay for operator-specific material; the only code that may look there is `src/infra/private-overlay.ts`, which loads optional `private/overlay/<name>.cjs` hooks and returns null on a clean checkout.

## Commands

- Install: `pnpm install --frozen-lockfile` (Node 22.12+, pnpm 10)
- Build: `pnpm build`; typecheck only: `npx tsc --noEmit -p tsconfig.json`
- Checks: `pnpm check` (typecheck, lint, format, OpenAPI and client drift)
- Tests: `pnpm test` (unit), `pnpm smoke` (throwaway gateway on a free port), `pnpm release:check`, `pnpm pack:check`
- Run the CLI from the build: `node kolo.mjs <command>`

Always run development gateways against an isolated `KOLO_HOME` (for example `KOLO_HOME=/tmp/kolo-dev node kolo.mjs gateway --allow-unconfigured --port 18880`). Never start, stop or restart a gateway that someone else operates. Stop processes by explicit PID; do not pattern-kill.

## Rules that keep the product shippable

- **No machine paths.** State is resolved through `KOLO_HOME` (`src/config/kolo-home.ts`). Do not call `os.homedir()` in new code; use the resolvers in `src/config/paths.ts`.
- **No hardcoded hosts.** Public URLs come from `src/config/product-urls.ts`.
- **Voice.** User-facing text follows `docs/CLI_STYLE.md`: plain sentences, no jokes, no emoji, no internal or personal names, documented exit codes (0 ok, 1 error, 2 usage, 3 unreachable, 4 auth). Examples use neutral names (`alice`, `ops-bot`).
- **No vendor names in product text.** Model providers are configuration, not copy.
- **Security.** Every non-health route is authenticated. Secrets never go on argv, in logs or in `kolo.json`; use the secrets store. New HTTP routes are declared in `src/gateway/http-routes.ts` with their auth kind and schemas.
- **Nothing runs at import time.** Modules must not start timers, open sockets, read the auth store or write files when imported; the CLI imports most of the tree for every command. Timers that must exist at module level are `unref()`ed.
- **Packaging.** Anything the built entry points import must ship: `pnpm release:check` derives the set from the import graph and fails otherwise.
- **Licensing.** Each file belongs to a layer in `LICENSING.md`. Proprietary-layer changes come only from KODA staff under agreement. Contributions require `CLA.md` (`git commit -s`).

## Style

- Strict TypeScript, no `any`. Prefer small modules; keep files under ~500 lines where practical.
- Formatting and linting: `oxfmt` and `oxlint` via `pnpm check`; `pnpm format:fix` to apply.
- Dependency injection follows the existing `createDefaultDeps` pattern in the CLI.
- CLI progress and prompts use `src/cli/progress.ts` and `@clack/prompts`; tables use `src/terminal/table.ts`.
- Comments explain non-obvious decisions, not what the code already says.

## Tests

- Vitest; coverage thresholds 70% lines/branches/functions/statements.
- Logic changes come with tests next to the code. Test-only changes do not need a changelog entry.
- Do not raise test workers above 16.

## Commits and pull requests

- Stage explicitly; never `git add -A`. Do not commit generated bundles under `src/canvas-host/a2ui/`.
- Commit messages: short, imperative, scoped (`gateway: reject unauthenticated /metrics`).
- One change per pull request; describe the reason and how it was tested; note user-visible changes and new flags.
- Changelog: latest released version at the top; after publishing, bump the version and start a new section.
- Releases follow `docs/reference/RELEASING.md`. Version numbers change only on a release.

## Multi-agent safety

- Do not create, apply or drop `git stash` entries, switch branches, or create or remove worktrees unless explicitly asked.
- Scope commits to your own changes; leave unrelated work in the tree untouched.
- When several agents work in the same tree, announce the files you are about to edit.
