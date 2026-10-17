---
summary: "Ransomware detection: decoy files and mass-encryption detection that stop every agent and write the incident to the audit log"
read_when:
  - You want agents, or anything else on the host, stopped the moment files start being encrypted
  - You need to explain to a security team what Kurahi does about ransomware
  - The shield stopped your agents and you need to know why and how to resume
title: "Ransomware detection"
---

# Ransomware detection

Ransomware does three things that normal work does not: it rewrites many existing documents into
random-looking bytes in a short time, it often renames them with an extra extension, and it leaves
a ransom note. It also touches every file it can reach, including files nobody else ever opens.
The shield watches for exactly those signs. The moment it sees them it stops every agent through
the [policy kill switch](/policy) and writes the incident to the hash-chained audit log.

It watches whether the encryption comes from an agent that was tricked into running a malicious
script or from malware elsewhere on the host. Either way, no agent keeps working on files that are
being destroyed, and nothing an agent does can switch the shield off: its settings live in the
signed policy.

## What it watches

- The state directory (`~/.kolo`, or `%LOCALAPPDATA%\KoLo` on Windows): memory, policy, identity
  and configuration.
- Every agent's workspace.
- Any extra folders listed under `shield.paths` in the policy, such as a shared drive the agents
  work in.

Folders with constant legitimate churn are skipped: `node_modules`, `.git`, build output, caches,
and the runtime's own logs, evidence and snapshots.

## How it decides

| Signal      | Triggers when                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decoy file  | `_kurahi_canary.txt`, planted in each watched folder, is changed or deleted                                                                                                                                             |
| Encryption  | 12 or more files (configurable) that held text are rewritten into high-entropy content within 60 seconds, or deleted and replaced by a high-entropy copy with an extra extension (`report.docx` → `report.docx.locked`) |
| Ransom note | A file named like `HOW_TO_DECRYPT_FILES.txt` or `restore-my-files.html` appears                                                                                                                                         |

Formats that are compressed by design, such as images, archives, PDF and Office files, video and
databases, never count as an encrypted rewrite. Builds, installs and downloads create new files
rather than turning existing text into noise, so they do not trigger it either. One incident
produces one trigger: the shield stays quiet for a minute after firing.

In a git repository the decoy file is added to `.git/info/exclude`, so it never shows up in
commits. Agents see the file in their workspace; its text tells them not to touch it.

## Configuration

```yaml
version: 1
shield:
  mode: stop # stop (default) | alert | off
  paths: ["/srv/shared/contracts"]
  canaries: true # plant decoy files (default true)
  rewrites: 12 # suspicious rewrites that trigger
  windowSeconds: 60
```

The shield is on in `stop` mode when the policy says nothing. `alert` writes the audit entry and
logs an error without stopping agents. `KOLO_SHIELD=off|alert|stop` in the service environment
overrides the policy for emergencies. Changes take effect when the gateway restarts.

## When it fires

```text
shield: encrypt (14 files turned into high-entropy content within 60 s): /srv/shared/contracts/a.docx …
```

1. Every agent is stopped and running jobs are cancelled (`policy.kill` by `shield` in the audit log).
2. Find the cause: `kurahi audit tail` shows the `shield.trigger` entry with the files involved;
   `kurahi evidence list` shows which jobs were running.
3. Restore damaged files from your backups. Files an agent changed with its edit tools can also be
   rolled back from [snapshots](/tools/snapshots) with `/undo` or `/snapshots restore <id>` in the TUI.
4. Resume with `kurahi policy release --all` once the host is clean.

## Limits

- The shield detects and stops; it is not complete ransomware protection. Files encrypted before
  a signal fires (up to the rewrite threshold, or until a decoy is touched) are already damaged,
  and the shield cannot stop malware itself, only the agents. It does not keep its own off-machine
  copies yet. Keep backups.
- It sees only the folders it watches: changes elsewhere on the host are not detected.
- A slow attack that encrypts fewer files than the threshold per window is caught by the decoy
  files, not by the rewrite count.
