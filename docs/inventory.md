---
summary: "AI inventory: a signed list of every agent the runtime hosts, with its models, tools, policy rules, MCP servers, channels and evidence"
read_when:
  - A governance, risk or compliance team asks which AI systems you run
  - You need an AI bill of materials for an audit or a governance platform
  - You want to check that an inventory someone sent you has not been edited
title: "AI inventory"
---

# AI inventory

Governance starts with knowing which AI systems exist. Most organisations build that list by hand,
from surveys and spreadsheets, and it is out of date the day it is finished. KoLo is the runtime the
agents run in, so it can produce the list from facts: `kolo inventory` reads the configuration, the
active [policy](/policy) and the [evidence](/evidence) store, and prints what is actually there.

```bash
kolo inventory                                  # table
kolo inventory --json                           # JSON with a digest
kolo inventory export -o inventory.json         # signed JSON
kolo inventory export --csv -o inventory.csv    # one row per agent, for spreadsheets
kolo inventory verify inventory.json            # exit 1 if edited or badly signed
```

## What it lists

| Section | Contents |
|---|---|
| Runtime | KoLo version; the host name only with `--host` |
| Policy | whether a policy is loaded, its SHA-256, attestation state, enforcement mode, fleet kill state |
| Agents | id, name, default agent, primary and fallback models, providers, tool profile and allow/deny lists, permissions, sandbox mode |
| Policy per agent | matching rules, allowed providers, models and channels, tool rules, approval classes, budget, stopped |
| Evidence per agent | number of evidence jobs and when the last one started |
| MCP servers | id, transport, redacted endpoint, enabled, tool allowlist |
| Channels | configured channels and whether each is enabled |
| Totals | agents, distinct models, providers, MCP servers, channels, evidence jobs |

## What it never contains

Secrets, environment values, request headers, command-line arguments, user names and passwords in
URLs, query strings, prompts, memory and evidence content. An HTTP MCP endpoint is reduced to its
origin and path; a stdio server to the base name of its executable. The inventory is meant to leave
the machine, so it carries names, shapes and counts only.

## Signing and verification

`kolo inventory export` signs the JSON with the gateway's Ed25519 key, the same key that signs
[evidence bundles](/evidence) and continuity manifests. The document carries a SHA-256 digest of
its canonical content, the signer's public key and key id, and the signature over the digest.
`kolo inventory verify` recomputes the digest and checks the signature with no access to the
gateway, so an auditor can check a file they received by e-mail. Any change to the content, or a
signature made with another key, fails verification.

Pass `--no-sign` for an unsigned JSON file. CSV exports are never signed; send the signed JSON
alongside when the CSV matters.

## Using it with governance platforms

The CSV has one row per agent with stable column names, ready to import into a spreadsheet or the
AI register of a governance platform. Cells are quoted, and values starting with `=`, `+`, `-` or
`@` are prefixed so a spreadsheet does not run them as formulas.

A useful routine: export a signed inventory every month, keep it with the audit log, and compare
it with the previous month before the governance review.
