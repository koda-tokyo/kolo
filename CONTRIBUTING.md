# Contributing to KoLo

Thank you for taking the time. This page covers how to report problems, propose changes and get a pull request merged.

## Where things happen

- Bugs and feature requests: https://github.com/koda-tokyo/kolo/issues
- Design discussions: https://github.com/koda-tokyo/kolo/discussions
- Security reports: never in a public issue; see [SECURITY.md](SECURITY.md)
- Documentation: https://kodasoken.com/kolo (source under `docs/`)

## Before you start

1. Search existing issues and discussions.
2. For anything larger than a bug fix, open a discussion or an issue first and describe the change and the reason. Agreeing on the shape before the code saves everyone a round-trip.
3. Read [LICENSING.md](LICENSING.md). Pull requests are accepted for the MIT and FSL layers. Changes to the proprietary layer are accepted only from KODA staff under agreement.

## Contributor License Agreement

Every contribution requires the [CLA](CLA.md). Sign by adding `Signed-off-by: Name <email>` to each commit (`git commit -s`). The first contribution from a new signer is recorded in `CONTRIBUTORS.md` by a maintainer.

## Development setup

Requirements: Node.js 22.12 or newer, pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Useful commands:

| Command | What it does |
|---|---|
| `pnpm build` | full build into `dist/` (TypeScript, UI bundle, OpenAPI, manifest) |
| `pnpm check` | typecheck, lint, format check, OpenAPI and client drift checks |
| `pnpm test` | unit tests (vitest) |
| `pnpm smoke` | boots a throwaway gateway on a free port and exercises auth, API, pairing, sessions, integrity |
| `pnpm release:check` | the npm pack must contain every file reachable from the entry points |
| `pnpm pack:check` | installs the packed tarball into an empty directory and runs the CLI |
| `node kolo.mjs <command>` | run the CLI from the build |

Run the gateway against an isolated state directory while developing: `KOLO_HOME=/tmp/kolo-dev node kolo.mjs gateway --allow-unconfigured --port 18880`. Never point a development build at a state directory that a live service uses.

## Pull requests

- One change per pull request. Keep refactors separate from behaviour changes.
- Add or update tests next to the code (`*.test.ts`). The unit, gateway and smoke suites must stay green.
- Keep `pnpm check` clean. Formatting is enforced by `oxfmt`; run `pnpm format:fix`.
- User-facing text follows [docs/CLI_STYLE.md](docs/CLI_STYLE.md): plain sentences, no jokes, no emoji, no product-internal names, documented exit codes.
- Public URLs come from `src/config/product-urls.ts`. Do not hardcode hosts.
- Describe what changed and why in the description; mention user-visible changes and new flags. Note how you tested.
- If the change was produced with the help of a coding agent, say so and state how much of it you tested yourself. That is welcome; reviewers only need to know where to look.

## Commit messages

Short, imperative, scoped: `cli: exit 2 on unknown command`. A body explains the reason when the diff does not.

## Review and merge

A maintainer reviews within a few working days. Small fixes are rebased onto `main`; larger series are squashed with the contributor as author. Releases are cut from `main` by maintainers; see `docs/reference/RELEASING.md`.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
