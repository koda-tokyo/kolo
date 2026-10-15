---
summary: "CLI reference for `kurahi api` (call any gateway operation from the described API)"
read_when:
  - You want to call something the gateway can do that has no dedicated command
  - You are scripting the gateway from a shell
title: "api"
---

# `kurahi api`

Call the gateway API through the generated client. The gateway publishes an OpenAPI 3.1 document
at `GET /doc`; every operation in it, and every WebSocket method, is reachable here.

```bash
kurahi api list [--json]                 # HTTP operations with method, path, auth and scope
kurahi api list --ws                     # WebSocket methods and events
kurahi api <operationId> [-p k=v ...] [-b <json>] [--raw]
kurahi api ws <method> [json] [--expect-final]
kurahi api discover                      # what the discovered gateway and credential are
```

## Options

- `-p, --param <k=v>`: path, query or header parameter (repeatable).
- `-b, --body <json>`: request body as inline JSON, `@file`, or `@-` for stdin.
- `--raw`: compact JSON output (the default is pretty-printed).
- `--url <url>`: gateway base URL (default: discovered from `KOLO_HOME`).
- `--timeout <ms>`: request timeout.
- `--json`: for `list`, machine-readable output.
- `--expect-final`: for `ws`, wait past an interim `{status: "accepted"}` answer.

## Authentication

The credential is discovered from `KOLO_HOME`: the owner token file, else the paired device
credential. No flag takes a token. A credential limited by scope sees the operations its scope
allows; `kurahi api list` shows the minimum scope of each.

## Examples

```bash
kurahi api health --raw
kurahi api listJobs -p status=running
kurahi api getJob -p id=job_01h...
kurahi api runCodeMode -b '{"script":"return await tools.time_now({})"}'
kurahi api ws sessions.list
```

## Exit codes

- 0: the operation returned a success status.
- 1: the gateway answered with an error status (including 401 and 403).
- 2: usage (unknown operation, bad parameter, invalid JSON body).
- 3: the gateway was unreachable.
