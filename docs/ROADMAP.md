---
summary: "Engineering milestone log for Kurahi 2.0 and the progress notes behind the public roadmap"
read_when:
  - You want to know what each milestone delivered and how it was verified
title: "Milestone log"
---

# Milestone log

The public roadmap is [ROADMAP.md](https://github.com/koda-tokyo/kurahi/blob/main/ROADMAP.md) at the repository root. This page is the engineering record: one entry per milestone with what shipped and the checks that were green. Release notes in `CHANGELOG.md` are the user-facing summary.

| Milestone | Delivered                                                                       |
| --------- | ------------------------------------------------------------------------------- |
| M1        | packaging, bundles, `kurahi service`, `kurahi update`                           |
| M2        | `KOLO_HOME`, `kurahi init`, integrity gate, audit log, bind policy              |
| M3        | scoped pairing, session discovery, `kurahi attach`                              |
| M4        | OpenAPI at `/doc`, generated client, `kurahi api`                               |
| M5        | MCP client and jobs registry                                                    |
| M6        | Code Mode                                                                       |
| M7        | ops plugins with hot reload                                                     |
| M8        | jobs, step cap, loop guard                                                      |
| M9        | parity: terminal UX, language servers, provider registry, community scaffolding |

## Progress notes

### M9 parity (2026-10-14)

Goal: close the four places where OpenCode was stronger, to parity, grounded in the OpenCode documentation as of 2026-10-14 (`docs/comparison.md` has the sources).

- **M9a terminal UX.** Session switcher with agent and last activity, unified diff view for file-edit tools (collapsible, bounded), slash commands `/help /sessions /attach /model /jobs /cancel /clear /theme`, one-line status line (identity, session, job state, steps against the limit, provider profile), three built-in themes under `tui.theme`, `tui.keybinds` for the nine top-level actions, reconnect banner with backoff, coalesced rendering measured with a fake stream test.
- **M9b language servers.** `lsp.servers.<lang>` with defaults for TypeScript, Python, Go, Rust, Java (commands only, skipped when absent on `PATH`); tools `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover` through the tool registry and Code Mode; bounded diagnostics appended to write, edit and apply_patch results; tests against a fake stdio language server.
- **M9c providers.** `src/providers/registry.json` (id, display name, API style, base URL, auth header style, models endpoint, region note), `kurahi providers list|add|test|remove|default`, `kurahi models list --live`, secrets in the secrets store, `docs/providers/README.md`.
- **M9d community.** Issue forms (bug, feature, security hardening), pull request template, discussion forms, `ROADMAP.md`, `GOVERNANCE.md`, `docs/COMMUNITY.md`, `docs/comparison.md`, release notes template.
- **Still below OpenCode after M9:** message undo and redo, export and external editor, custom theme files, the full keybind surface, formatters, provider catalogue size, subscription sign-in for every provider, desktop app and IDE extensions, plugin ecosystem size. Listed in `docs/comparison.md`.
- **Verification:** see the M9 commits (`M9a tui`, `M9b lsp`, `M9c providers`, `M9d community`) and the release gate: tsc, unit, gateway, extensions, `pnpm build`, `pnpm smoke`, `openapi:check`, `client:check`, `release:check`, `pack:check`.
