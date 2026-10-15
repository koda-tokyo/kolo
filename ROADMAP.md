# Roadmap

What the project is working toward, by quarter. Directions, not dates: an item moves to "shipped" when it is in a release, and the release notes are the record. Proposals go through GitHub discussions (see `GOVERNANCE.md`).

## Shipped (2026 Q2, release 2026.2.1)

- Self-contained bundles per OS, one `kurahi service` over systemd, launchd and Task Scheduler, verified `kurahi update`.
- One state root (`KOLO_HOME`), `kurahi init` as the only first-run command, boot integrity gate, hash-chained audit log.
- Scoped device pairing, session discovery and `kurahi attach` from another terminal.
- Described API: OpenAPI 3.1 at `/doc`, generated client, `kurahi api <operation>`.
- MCP client (`kurahi mcp`), Code Mode (one script, many tools, sandboxed worker), in-process ops plugins with hot reload.
- Jobs: every agent run is a job with a step cap and a loop guard.
- Terminal parity work: session switcher, diffs for file edits, slash commands, status line, themes, configurable keys, reconnect banner; language-server capability (diagnostics, definition, references, hover) injected after edits; provider registry and `kurahi providers`; community scaffolding.
- Terminal parity, second pass: file snapshots with undo and redo (terminal and API), export and external editor, theme files and eight built-in themes, leader chords for every action, formatters after edits, a provider catalogue generated from a public registry, `@` file references.

## 2026 Q3

- **Proven continuity.** A resident agent survives restarts, upgrades and machine moves with its session state, memory and policy intact, and the product can prove it: a continuity test in the release gate and a `kurahi doctor` check that reports the last verified restore.
- **Evidence bundles.** One command exports a signed bundle for a time window: audit chain segment, job records, tool calls, policy decisions, config hashes. Verifiable offline with a public key.
- **Policy-as-code.** Tool, approval and channel policy expressed as versioned files under the integrity gate, with a dry-run (`kurahi policy test`) and a diff between two policy versions.
- **Channel-native.** The same session, jobs and approvals from messaging channels as from the terminal, including approvals answered in the channel and attach-from-channel.

## 2026 Q4

- **Factory.** Reproducible agent definitions: a role, its tools, its policy and its evaluation set as one package that can be built, tested and installed (`kurahi agent install <package>`).
- **Appliance.** An image for a dedicated machine or VM: immutable base, the service pre-installed, remote bind pre-configured for a tailnet, evidence bundles on a schedule.
- **Role packs.** Curated packages for recurring jobs (operations assistant, reviewer, support triage, research) built with the factory, each with an evaluation report in the package.

## 2027 Q1 and later

- Multi-node: one owner, several machines, sessions and jobs visible across the fleet.
- Evaluation dashboard for role packs and provider profiles.
- Air-gapped operation with a local model server as the only provider.

## Not planned

- A hosted multi-tenant service operated by the project. Self-hosting is the product; see `LICENSING.md`.
- Vendor-specific features that would make the product depend on one model provider.

## How to influence this page

Open a discussion in the _Ideas_ category with the problem first. Items get added here when a maintainer accepts them (see `GOVERNANCE.md`); they get removed when they ship or when they are declined with a reason.
