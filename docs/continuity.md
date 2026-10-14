---
summary: "Proven continuity: show that a resident is the same after a model swap, a restart, a state-dir move and a session close"
read_when:
  - You want evidence, not a promise, that a resident survives operational change
  - You are reading or verifying a continuity report
  - You want to run the suite against your own resident
title: "Continuity"
---

# Continuity

A KoLo resident is an identity (its workspace files), a memory (its memory files), a role (its
configuration and permissions) and its unfinished work (jobs, sessions, transcripts). The
continuity suite proves that all of that is the same resident before and after four disruptions:

| Disruption   | What happens                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| `model-swap` | The model profile in the configuration changes. The next turn runs on another model.          |
| `restart`    | The gateway process stops and starts again.                                                   |
| `move`       | The gateway stops, the state dir is renamed, and the gateway starts from the new `KOLO_HOME`. |
| `close`      | The session the probe was talking in is closed (`sessions.reset`).                            |

For every disruption the suite takes a signed **continuity manifest** and a set of **probe
results** before and after, then scores ten numbered invariants (C0 to C9, listed in
[the specification](/continuity-spec)). The output is a JSON report, a Markdown report and a
one-line badge. Anyone holding the JSON report can recompute every hash, signature and score
with `kolo continuity verify` without access to the gateway.

## What is proven

When a run passes, the report is evidence of all of the following, taken through the public
gateway API with the owner credential and nothing else:

- **Identity files are byte-identical** (C1): `IDENTITY.md`, `SOUL.md`, `AGENTS.md` and the other
  workspace files that define the resident hash the same before and after.
- **Memory is retained and found** (C2): memory files hash the same, and recall of seeded facts
  through `GET /api/memory/recall` stays at or above the threshold (80% by default).
- **Role and permissions are unchanged** (C3): the agent's configuration without its model, the
  tool policy, the set of paired devices and their scopes are identical, and a wrong owner token is
  still rejected afterwards.
- **Unfinished work is not lost silently** (C4): a job that was running when the disruption hit
  either finishes (model swap, session close) or is reported as interrupted with a reason (restart,
  move). It never stays `running` forever and never claims success it did not have.
- **The audit chain is continuous** (C5): the hash-chained audit log verifies afterwards, has at
  least as many entries, and the head recorded before the disruption is an ancestor of the head
  after it.
- **No secret leaves the state dir** (C6): no public response, no manifest and no report contains
  the owner credential or a private key; the manifest never lists anything under `secrets/`.
- **The same key signs both manifests** (C7): both manifests verify and carry the same signer, so
  the "after" resident was attested by the same gateway identity as the "before" one. The key moves
  with the state dir, which is what a move must preserve.
- **Sessions and transcripts are retained** (C8): every session key known before still exists,
  every transcript known before is still there and unchanged unless the suite itself drove that
  session, and a closed session really did get a new session id with its old transcript kept.
- **The resident answers as itself** (C9): a chat turn after the disruption carries the identity
  marker from the resident's `IDENTITY.md`, and after a model swap the answer comes from the new
  profile. (Deterministic provider only; see below.)
- **The disruption really happened** (C0): the process id changed, the state dir path changed, the
  model profile changed, or the session id changed. A comparison without a disruption proves
  nothing, so this one is scored too.

## What is not proven

Be precise about the limits when you quote a report.

- **Model quality and semantic recall are out of scope.** The recall probe is a deterministic
  keyword search over the memory files. It proves the memory is present and findable, not that a
  vector index or a model would retrieve it. Reasoning, tone and tool use are not measured.
- **The resident's own answers are only checked with the deterministic provider.** In throwaway
  mode the model is a fake that echoes the identity marker it was given, which makes C9 a test of
  the runtime (the identity reached the model, the swap took effect), not of any model's behaviour.
  Against your own resident, C9 runs only with `--chat`, and the marker rule is "the same marker
  before and after", with whatever model you configured.
- **A job that was interrupted does not resume.** C4 passes when the interruption is reported
  honestly. Resumption of an interrupted run is not claimed.
- **Channels are not exercised.** The suite runs with channels disabled; delivery to messaging
  surfaces is covered elsewhere.
- **Attached mode cannot move a state dir** it does not own, and its restart is the gateway's
  in-process restart (`config.apply`), not a supervisor restart. A throwaway run covers both.
- **The signature proves who attested, not that the files were correct.** A manifest signed by the
  gateway says "this is what the gateway saw". The comparison between two such manifests is the
  evidence; one manifest alone is a snapshot.
- **Secrets are checked by pattern.** The leak scan looks for the owner credential and PEM private
  keys in everything the suite received. It does not prove the absence of every possible secret.

## Run it in CI (throwaway mode)

```bash
pnpm build
pnpm continuity:check
```

`continuity:check` starts a fresh gateway in a temporary state dir with a deterministic provider
(two model profiles, `alpha` and `beta`), seeds a resident named `alice` with identity files and
ten facts, runs all four disruptions, writes the report and verifies it. It needs no network, no
API key and no real model. The same job runs on every push in `.github/workflows/ci.yml`.

Equivalent CLI:

```bash
kolo continuity run --throwaway --disruption all --out ./continuity-out
kolo continuity verify ./continuity-out/continuity-report.json
kolo continuity badge ./continuity-out/continuity-report.json
```

`KOLO_SMOKE_HOME` (must end in `.kolo-test`) and `KOLO_SMOKE_PORT` are honoured the same way the
gateway smoke test honours them.

## Run it on your own resident (attached mode)

The suite talks to the gateway you already run, discovered like every other client: `KOLO_HOME`
gives the port from `run/gateway.lock` and the owner token from `secrets/gateway.token`, or set
`KOLO_GATEWAY_TOKEN`. The token is never passed on the command line.

```bash
# restart and session close, no chat probe
kolo continuity run --resident alice --disruption restart,close --out ./continuity-out

# add a model swap (the gateway restarts itself in-process to apply it) and recall probes
kolo continuity run --resident alice --disruption model-swap,restart,close \
  --swap-to provider/model --facts ./facts.json --chat --out ./continuity-out
```

`facts.json` is a JSON array of `{ "query": "...", "expect": "..." }`: the query goes to
`GET /api/memory/recall` and `expect` must appear in one of the returned lines. Without `--facts`,
C2 scores memory-file hashes only and says so in its detail. Without `--chat`, C9 is skipped.

The suite starts one slow turn in the session `agent:<id>:continuity-job` and talks in
`agent:<id>:continuity-probe`; both appear in the gateway's session list. It does not write to any
other session, and it does not change the configuration except for the model swap you asked for.

## How to read the report

`continuity-report.json` holds, per disruption: the manifest before, the probe results before, the
disruption outcome, the manifest after, the probe results after, the invariant results and the
leak scan. `continuity-report.md` is the same for people. `continuity-badge.txt` is one line:

```
continuity PASS | resident=alice | model-swap,restart,move,close | pass=40 fail=0 skip=0 | 5e3462aa>84854a38 e416836b>032f3e67 472353f1>20c6d00f a521e77c>78e26962 | 2026-01-01T00:00:00.000Z
```

The pairs of short hashes are the manifest roots before and after each disruption. They differ
when anything in the resident moved (a transcript grew, a job finished); the invariants say which
of those movements are allowed.

Each invariant is `pass`, `fail` or `skip` with a one-line detail. `skip` means the input needed
to decide was not available (no recall probes, no chat probe, no running job), never that the check
was waived. The verdict is `PASS` only when nothing failed.

### The manifest

`GET /api/continuity/manifest?agent=<id>` returns the manifest the suite uses. It lists hashes and
small structured values, never file contents:

| Kind         | Name                       | What is recorded                                                                                           |
| ------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `identity`   | workspace file name        | SHA-256 and size                                                                                           |
| `memory`     | `MEMORY.md`, `memory/*.md` | SHA-256 and size                                                                                           |
| `role`       | `agent`                    | agent config without `model`, agent defaults, tool policy, command policy (secret-looking values redacted) |
| `model`      | `primary`                  | provider and model id (expected to change on a swap)                                                       |
| `job`        | job id                     | status, kind, session key, timestamps, error                                                               |
| `session`    | session key                | session id, label, model, last update                                                                      |
| `transcript` | transcript file name       | SHA-256 and size                                                                                           |
| `audit`      | `chain`                    | verified, entries, last seq                                                                                |

Entries are chained (`hash = sha256(previousHash + canonical entry)`), `root` is the last hash, and
the root is signed with Ed25519 by the gateway's signing key at
`<KOLO_HOME>/identity/continuity-signing.json` (0600, created on first use). The raw public key
and its fingerprint travel inside the manifest, so `kolo continuity verify` needs nothing else.

### Verification

```bash
kolo continuity verify ./continuity-out/continuity-report.json
```

recomputes every entry hash, every root, both signatures, re-scores every run from the stored
evidence and checks the summary and the badge against the result. An edited report, an edited
manifest or a changed score fails with the first mismatch named. `kolo continuity badge` prints the
badge and appends `UNVERIFIED` when the report does not recompute.

## Endpoints the suite added

| Operation               | Route                                     | Purpose                                                               |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `getContinuityManifest` | `GET /api/continuity/manifest?agent=`     | signed manifest of one resident                                       |
| `recallMemory`          | `GET /api/memory/recall?agent=&q=&limit=` | deterministic keyword recall over memory files                        |
| `getAuditChain`         | `GET /api/audit/chain?seq=`               | verify the local audit chain, read its head, anchor on an earlier seq |

All three are read-only and need the owner token or an admin credential.
