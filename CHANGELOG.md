# Changelog

Docs: https://kodasoken.com/kolo

## Unreleased

### Changes

- Reasoning view: reasoning streams live to clients as the `reasoning` field of chat events (redacted, gated by `agents.defaults.reasoning.expose`, `agents.list[].reasoning.expose`, the policy key `agents[].reasoning.expose` and the session's `reasoningView`); `kolo tui` shows it as its own block above the answer ("Thinking" with a spinner, then "Thought for 12s", collapsed to three lines; Ctrl+O expands the latest block, tool cards move to Alt+O; `/reasoning on|off|collapsed|expanded`; `tui.reasoning.maxLines`; `reasoning` theme token); `kolo attach` and the dashboard chat show it under the same headers; `evidence.includeReasoning` records it in evidence bundles.

## 2026.2.1-kolo.1

KoLo 2.0 integration release: the resident agent runtime, packaged and documented as one product.

### Changes

- M1 Packaging and service: self-contained bundles per OS (own Node.js runtime, `bundle-manifest.json`, `SHA256SUMS`), `install.sh`/`install.ps1` with checksum verification, one `kolo service` command over systemd, launchd and Task Scheduler, `kolo update` for verified atomic bundle updates.
- M2 State and integrity: every path resolved through `KOLO_HOME`; `kolo init` as the single first-run command with a bind policy (`loopback|lan|tailnet|custom|remote`); boot integrity gate over protected policy files (`kolo integrity`), hash-chained audit log, non-loopback serving gated by `gateway.remote.enabled`.
- M3 Pairing and sessions: scoped device pairing (`kolo pair invite|approve|revoke`) with short-lived access tokens, session discovery and attach from another terminal or machine (`kolo attach`).
- M4 Described API: OpenAPI 3.1 at `/doc` (43 operations with auth kind and minimum scope), the generated `@kodasoken/kolo-client`, and `kolo api <operation>` for anything the gateway can do; CI fails on drift.
- M5 MCP: `kolo mcp add|list|remove|test`; MCP tools surface as `mcp:<server>:<tool>` under the same policy and audit as core tools.
- M6 Code Mode: one agent-written script calls many tools in a sandboxed worker (`code_mode_run`, `POST /api/code-mode/run`) with wall-clock, heap and tool-call limits.
- M7 Ops plugins: health watchdog, log rotation, self-check, circadian and proactive triggers, memory boot inject, all in-process, config-driven and off by default except the health watchdog.
- M8 Jobs and loop guard: every agent run is a job (`listJobs`, `getJob`, `cancelJob`); a step cap and doom-loop detector stop runaway runs and audit `agent.loop_stopped`.
- M9 Parity: `kolo tui` session switcher (agent, last activity, new session), unified diff view for file-edit tools, slash commands `/sessions /attach /jobs /cancel /clear /theme`, one-line status line, themes (`tui.theme`), configurable keys (`tui.keybinds`), reconnect banner with backoff, coalesced rendering; language servers (`lsp.servers.<lang>`, defaults for TypeScript, Python, Go, Rust, Java) with `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover` and diagnostics appended to write, edit and apply_patch results; provider registry with `kolo providers list|add|test|remove|default` and `kolo models list --live`; issue, pull request and discussion forms, `ROADMAP.md`, `GOVERNANCE.md`, `docs/comparison.md`.
- M10 Parity, second pass: file snapshots before every tool edit with `/undo`, `/redo`, `/snapshots` and `GET/POST /api/sessions/{id}/snapshots[/restore]` (45 operations, audited, `snapshots.*`); `/export` (Markdown or JSON, secrets redacted) and `/editor` (`$VISUAL`/`$EDITOR`); eight built-in themes and JSON theme files (`tui.theme` as a path, `kolo tui themes list|export|check`); a key and a leader chord for every TUI action (`tui.keybinds.leader`, `/keys`); formatters after edits (`format.onEdit`: prettier, biome, ruff, black, gofmt, rustfmt on `PATH`); provider catalogue generated from a public registry (`pnpm providers:sync|check`, 209 entries, curated first); `@path` file references attached to the message.
- M11 Proven continuity: `kolo continuity run|verify|badge` and `pnpm continuity:check` prove that a resident (identity files, memory, role and permissions, jobs, sessions, transcripts, audit chain) is the same after a model swap, a gateway restart, a state-dir move and a session close; signed hash-chained manifests (`getContinuityManifest`), deterministic memory recall (`recallMemory`), audit chain head and anchors (`getAuditChain`); a job found running after a restart is reported as interrupted instead of staying `running`; invariants C0–C9 in `docs/continuity-spec.md`.
- M12 Evidence bundles and replay: every job records a hash-chained event log (model turns, tool calls, file snapshots, permission decisions, loop-guard verdicts, audit links) signed at job end with the continuity key; `kolo evidence list|show|export|verify|replay|prune`, bundles (`manifest.json`, `events.jsonl`, `audit-slice.jsonl`, `snapshots/`, `REPORT.md`) that verify offline, a replay stepper in the CLI and the TUI (`/evidence <jobId>`), `getJobEvidence`, `listJobEvidenceEvents`, `exportJobEvidence` and the read-only `GET /evidence/{id}` view (52 operations); `evidence.*` config with caps and retention; `pnpm evidence:check` in CI.
- M13 Policy as code: one declarative `policy/policy.yaml` per gateway (agents, budgets, kill, approvals, network, data, requests, attestation; `kolo policy schema` exports the JSON Schema), signed by an owner key and refused unsigned in enforce mode (`policy.mode`, `KOLO_POLICY_MODE`); enforced at tool dispatch (core, MCP, Code Mode), model requests, channel in/out, HTTP/WS requests and job start with every decision audited with its rule id (`policy.decision`); budgets per agent and fleet (tokens/day, cost/day from the provider price tables, tool calls/hour, wall clock per job) with warn/pause/stop; a kill switch that aborts running jobs within one tick (`kolo policy kill|release`, `POST /api/policy/kill|release`, WS `policy.kill|release`, `GET /api/policy/status`, TUI banner); `kolo policy show|validate|sign|verify|diff|apply|status|kill|release|budget|init`; hot reload of the policy files; `pnpm policy:check` in CI; `docs/policy.md` with hospital-safe, trading-desk and manufacturing-floor starter policies.
- M14 Channel-native residents: `channels.sessionMode` (per-conversation | shared) maps every chat conversation to the resident's session; inbound messages appear live in `kolo attach` and the TUI with channel and sender; per-channel `identities` (owner/admin/attach) and `locale` (en/ja/pt); attachments copied to `KOLO_HOME/inbox/<channel>/`; conversation commands `/status /jobs /cancel /evidence /pause /resume /help` from any channel; approval asks with approve/deny answers over channels; per-channel outbound queue with retry, dedupe, dead letters and a human-triggered policy (`kolo channels status`, `GET /api/channels/status`); built-in generic webhook channel; `pnpm channels:check`.
- M15 The factory: boards of cards under `KOLO_HOME/factory` with an audited state machine (inbox → spec → build → review → ready → merged, failed → inbox); a `FactoryRunner` that runs a card on the KIP headless engine as a job of kind `factory`, streams the engine's events into the card timeline and the job's evidence log, moves the card as the engine reports, opens a pull request with `gh` (`factory.github`) or leaves the ready branch, and merges only with the card's `autoMerge` policy and the merge permission; `factory_card_create|move|comment` tools under `exec:factory_card:*`; `GET /factory` Kanban with live `factory.card` events and evidence links; `listFactoryBoards`, `listFactoryCards`, `createFactoryCard`, `getFactoryCard`, `moveFactoryCard`, `runFactoryCard`, `cancelFactoryCard` (60 operations); `kolo factory boards|cards|create|show|move|run|cancel`; TUI `/factory`; `factory.*` config; `pnpm factory:check` in CI; `docs/factory.md`.
- Voice: `docs/CLI_STYLE.md` governs every user-facing string; documented exit codes (0, 1, 2, 3, 4); no secrets on argv (`kolo logs` no longer takes `--token`).
- Support: `kolo support` writes a redacted diagnostics bundle; support@kodasoken.com.
- Packages renamed: `@kodasoken/kolo` (bin `kolo`) and `@kodasoken/kolo-client`.

### Fixes

- OAuth refresh lock: release unlinks the lock and empty, unparseable, expired or orphaned lock content is treated as stale; the old release wrote an empty file that blocked every later refresh in every process.
- The gateway starts its OAuth refresher only for OAuth-kind auth profiles configured under `KOLO_HOME` (or sources from the `oauth-sources` operator overlay) and is silent otherwise. Readers of other programs' credential stores are no longer in the product tree.
- `KOLO_HOME` is the whole state space: the shared root (canvas root, device identity, exec approvals, workspaces) is `KOLO_HOME` when it is set; a test boots a gateway under a temp `KOLO_HOME` and asserts nothing is written outside it.
- `kolo support` derives the service identity from the state root (`KOLO_SERVICE_ID`, `service/service.json`, the default agent from `kolo init`) instead of reporting `default`.
- `install.ps1` adds the bin directory to the user PATH only when it is absent, comparing entries case-insensitively without trailing separators.

### Removed

- The npm `beta`/`dev` update channels, the alternative-runtime install path and the upstream deploy templates.

## Earlier releases

Entries before KoLo 2.0 are not published in this repository. The upstream project's changelog (see `ATTRIBUTION.md`) covers the pre-fork history.
