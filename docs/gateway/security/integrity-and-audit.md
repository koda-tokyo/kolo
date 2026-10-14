---
summary: "Boot integrity gate for protected policy files and the hash-chained audit log"
read_when:
  - Registering soul, covenant or policy files so the gateway refuses to start if they change
  - Verifying or reading the audit log
---

# Integrity gate and audit log

## Boot integrity gate

The gateway keeps a signed registry of **protected policy files** (agent instructions, policies, locked
policies) at `<KOLO_HOME>/integrity/registry.json`. At boot, before plugins and channels load, it
re-hashes every registered file (SHA-256). If any file is missing or changed, or the registry
itself was edited or deleted, the gateway **refuses to start and exits with code 3**, naming the file.

Which files to register comes from config:

```json5
{
  integrity: {
    // Relative to KOLO_HOME, absolute, or ~/...; supports *, **, ?, [..], {a,b} and !exclude
    paths: [
      "workspace-*/{SOUL,COVENANT}.md",
      "/srv/policy/**",
      "!/srv/policy/drafts/**",
    ],
  },
}
```

The registry, not the config, is the source of truth: changing `integrity.paths` changes nothing
until an operator runs `kolo integrity init --force`.

Operator commands (run in a terminal; agent tools are refused these commands):

| Command                                    | What it does                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `kolo integrity init --dry-run`            | List the files `integrity.paths` matches                               |
| `kolo integrity init`                      | Hash them, create the signing key, write the signed registry (audited) |
| `kolo integrity update <path...>`          | Re-register an intended change or add a file (audited)                 |
| `kolo integrity update --remove <path...>` | Drop a file from the registry (audited)                                |
| `kolo integrity status [--unregistered]`   | Verify now; exit 3 on failure                                          |

The registry is signed with HMAC-SHA256 under `<KOLO_HOME>/secrets/integrity.key` (mode 0600).
Set `KOLO_INTEGRITY_KEY_FILE` to keep the key elsewhere. A registry edited without the key, or a
deleted registry while the key still exists, fails the gate.

`/health` reports `integrity: ok | warn | failed` (re-verified at most once a minute) and the
gateway method `integrity.status` (scope `operator.read`) re-verifies on demand.

`KOLO_INTEGRITY=warn` logs the failure and starts anyway. **Development only**; never set it on a
gateway that runs real agents.

Agent tools cannot write registered files, the registry, its key, or the audit log: a core
`before_tool_call` policy blocks `write`, `edit`, `apply_patch`, and `exec` commands that redirect
into, edit in place, move or delete those paths, and records an `integrity.write.denied` audit
event. The `exec` check is best effort; the boot gate is the backstop.

## Audit log

Security-relevant events are appended to `<KOLO_HOME>/audit/audit-YYYY-MM.jsonl` (UTC months), one
JSON object per line with `ts`, `seq`, `identity`, `device`, `scope`, `action`, `outcome`, `source`,
`detail`, `prev` (SHA-256 of the previous line) and `hash` (SHA-256 of the entry including `prev`).
The chain continues across months. `audit/HEAD` holds the current head and `audit/HEADS.jsonl` the
closing head of each past day, so truncating the tail is detected too. Every append is fsync'd;
one writer at a time (in-process queue plus a lock file).

Recorded today: admin API events, exec approval requests and decisions, device pairing requests,
approvals, rejections and token issue/use/revoke, config file changes, integrity init/update and
failures, blocked writes, and HTTP 401/403 refusals. Secret values are redacted before they are written.

```bash
kolo audit verify             # walk the whole chain; reports the first break, exit 1
kolo audit verify --month 2026-10
kolo audit tail -n 50         # redacted
```
