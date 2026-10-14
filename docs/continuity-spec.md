---
summary: "Continuity specification: the invariants the suite scores, as numbered, testable statements"
read_when:
  - You need the exact rule behind a pass or fail in a continuity report
  - You are extending the suite or auditing its claims
title: "Continuity specification"
---

# Continuity specification

This page is normative for `kolo continuity`. Each invariant is a testable statement over two
observations of one resident, **B** (before a disruption) and **A** (after it), where an
observation is a signed continuity manifest plus a probe snapshot taken through the public
gateway API. The scorer in `src/continuity-suite/scorer.ts` implements exactly these rules and
`kolo continuity verify` re-runs it on a saved report.

## Terms

- **Resident**: one agent id on one gateway.
- **Manifest**: the document returned by `GET /api/continuity/manifest?agent=<id>`: entries of
  kind `identity`, `memory`, `role`, `model`, `job`, `session`, `transcript`, `audit`, each with a
  name and either a SHA-256 or a structured value, chained by `hash_i = sha256(hash_{i-1} + "\n" +
canonical(entry_i))` from a genesis of 64 zeros, with `root = hash_n`, and signed with Ed25519
  over `"kolo-continuity-manifest\n" + version + "\n" + resident + "\n" + createdAt + "\n" +
entryCount + "\n" + root`.
- **Fingerprint** of an entry: its `sha256` for file-backed kinds, else `sha256(canonical(value))`.
  Two entries of the same kind and name are _equal_ when their fingerprints are equal.
- **Driven session**: a session the suite itself uses: `agent:<id>:continuity-probe`,
  `agent:<id>:continuity-job`, or the session the `close` disruption closed.
- **Terminal job status**: `succeeded`, `failed`, `cancelled`, `loop_stopped`, `denied`.
- **Interrupting disruption**: `restart` or `move` (the process that ran the job ended).

## Disruptions

| Id  | Name         | Applied means                                                                                                                                           |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `model-swap` | `agents.defaults.model.primary` (or the agent's model) refers to a different profile after than before.                                                 |
| D2  | `restart`    | The gateway process ended and a gateway answers `/health` again (throwaway: a new pid; attached: an in-process restart detected by a drop in `uptime`). |
| D3  | `move`       | The gateway stopped, the state dir was renamed, and a gateway answers `/health` from the new `KOLO_HOME`.                                               |
| D4  | `close`      | `sessions.reset` on the probe session succeeded.                                                                                                        |

## Invariants

Each invariant yields `pass`, `fail` or `skip`. `skip` is used only when an input needed to
decide is absent; it is never a waiver.

**C0 — Disruption applied.**
_pass_ iff the disruption's "applied" condition above holds. Otherwise _fail_. (Without this,
C1–C9 would compare a resident with itself.)

**C1 — Identity files unchanged.**
Let I_B and I_A be the `identity` entries. _skip_ if I_B is empty. _pass_ iff I_B and I_A have the
same names and every pair is equal. _fail_ if any identity file changed, disappeared or appeared.

**C2 — Memory retained and recalled.**
Let M_B, M_A be the `memory` entries and r_B, r_A the fraction of recall probes whose expected
text appeared in a returned line, with threshold t (default 0.8).
_fail_ if any memory entry in M_B changed or is missing in M_A.
Else, if there were no recall probes: _pass_ when M_B is non-empty (hashes only; the detail says
recall was not measured), _skip_ when there is nothing at all.
Else _skip_ if r_B < t (nothing to preserve), _fail_ if r_A < t, otherwise _pass_.

**C3 — Role and permissions unchanged.**
_fail_ if the `role` entry (agent configuration without `model`, agent defaults without `model`,
tool policy, command policy) is not equal in A and B; or if the list of paired devices
(fingerprint, scope, status) differs; or if, after the disruption, a request with a wrong owner
token was not answered 401. Otherwise _pass_.

**C4 — Unfinished work resumes or is reported.**
Let j be the job the suite started before the disruption. _skip_ if there is none.
_fail_ if j is not listed after; or if its status is not terminal; or, for an interrupting
disruption, if its status is `succeeded`, or if it carries no `error`. Otherwise _pass_: for an
interrupting disruption j is `failed` with a reason (the gateway marks any job found `queued` or
`running` in `run/jobs.json` at startup as `failed` with
`interrupted: gateway restarted before the run finished`); for the other disruptions j reached a
terminal status on its own.

**C5 — Audit chain continuous.**
Let (s_B, h_B) be the last seq and entry hash of the audit chain before, s_A the last seq after,
and anchor the entry at seq s_B read after the disruption (`GET /api/audit/chain?seq=s_B`).
_fail_ if the chain does not verify after; or if s_A < s_B; or if s_B > 0 and anchor.hash ≠ h_B.
Otherwise _pass_. (The wrong-token probe in each snapshot is itself audited, so s_B ≥ 1 in every
run.)

**C6 — No secret leaves the state dir.**
Let T be every response body the suite received, both manifests and (after writing) the report.
_fail_ if any element of T contains the owner credential (≥ 8 characters) or a PEM private-key
header, or if either manifest has an entry named under `secrets/` or `gateway.token`. Otherwise
_pass_.

**C7 — Same signer before and after.**
_fail_ if either manifest fails verification (chain, root, keyId = sha256(publicKey), signature),
or if the two `signer.keyId` values differ. Otherwise _pass_.

**C8 — Sessions and transcripts retained.**
Let S_B, S_A be `session` entries keyed by session key, T_B, T_A `transcript` entries keyed by
file name, and owner(t) the session whose `sessionId` names transcript t in B.
_fail_ if any key of S_B is missing in S_A; or if any transcript of T_B is missing in T_A; or if a
transcript of T_B changed and owner(t) is not a driven session; or, for `close`, if the closed
session's entry did not change (same session id); or if any session entry changed whose key is not
driven. Otherwise _pass_. Added sessions and transcripts are allowed.

**C9 — Resident answers as itself.**
Let c_B, c_A be the chat probe results. _skip_ if either probe was not run.
_fail_ if c_A is not ok; or if an expected identity marker is known (throwaway mode) and c_A's
marker differs from it; or if no expected marker is known and c_B carried a marker that c_A does
not repeat; or, for `model-swap`, if c_A's model is not the profile swapped to, or equals c_B's
model. Otherwise _pass_.

## Verdict and badge

The verdict of a report is `PASS` iff no invariant of any run is `fail`. The badge is
`continuity <verdict> | resident=<id> | <disruptions> | pass=<n> fail=<n> skip=<n> | <root_B8>><root_A8> … | <createdAt>`.
`kolo continuity verify` recomputes all of the above from the report alone and fails on the first
mismatch; `kolo continuity badge` appends `UNVERIFIED` to a badge whose report does not recompute.

## Conformance

A gateway conforms to this specification when `kolo continuity run --throwaway --disruption all`
produces a `PASS` verdict and the report verifies. The repository enforces this on every push
(`pnpm continuity:check`). A resident on an operator's gateway is _continuity-proven_ for a set of
disruptions when an attached run over that set produces `PASS` and the report verifies.
