## What changed

<!-- One change per pull request. Say what changed and why; link the issue or discussion. -->

## User-visible changes

<!-- New commands, flags, config keys, routes, exit codes, or text. Write "none" if there are none. -->

## How it was tested

<!-- Commands you ran and what they showed. The unit, gateway and smoke suites must stay green. -->

- [ ] `pnpm check` is clean (typecheck, lint, format, OpenAPI and client drift)
- [ ] `pnpm test` passes
- [ ] `pnpm smoke` passes when the gateway, routes or packaging changed
- [ ] Tests added or updated next to the code

## Checklist

- [ ] User-facing text follows `docs/CLI_STYLE.md` (plain sentences, no emoji, no vendor or internal names, documented exit codes)
- [ ] No machine paths, no hardcoded hosts (`src/config/product-urls.ts`), nothing runs at import time
- [ ] Secrets never on argv, in logs or in `kolo.json`
- [ ] Docs updated under `docs/` where behaviour changed
- [ ] The files I touched belong to the MIT or FSL layer in `LICENSING.md` (proprietary-layer changes need an agreement)
- [ ] Commits are signed off (`git commit -s`) under the CLA

## Coding agent disclosure

<!-- If a coding agent produced part of this change, say which parts and how much of it you tested yourself. This is welcome; reviewers only need to know where to look. -->
