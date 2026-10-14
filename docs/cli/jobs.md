---
summary: "Agent-run jobs: list, inspect and cancel runs through the gateway API"
read_when:
  - You want to see what the gateway is running right now
  - You need to stop a run
title: "jobs"
---

# Jobs

Every agent run is a job: an embedded runner turn, a cron lane task, or a turn started by another
agent. Jobs are exposed by the gateway API and reached with [`kolo api`](/cli/api); there is no
separate `kolo jobs` command.

```bash
kolo api listJobs                          # newest first
kolo api listJobs -p agent=alice -p status=running -p limit=20
kolo api getJob -p id=<job id>
kolo api cancelJob -p id=<job id>
```

## Operations

| Operation | Route | Auth |
|---|---|---|
| `listJobs` | `GET /api/jobs` | gateway token or session admin |
| `getJob` | `GET /api/jobs/{id}` | gateway token or session admin |
| `cancelJob` | `POST /api/jobs/{id}/cancel` | gateway token or session admin |

`listJobs` filters: `agent` (agent id), `status`, `limit`.

## Job status

`queued`, `running`, `succeeded`, `failed`, `cancelled`, `loop_stopped` (the
[loop guard](/agents/loop-guard) stopped it), `denied` (a policy refused it before it started).

## Cancelling

`cancelJob` aborts the underlying agent run and writes `job.cancelled` to the audit log. A job that
already finished answers `ok: false` with `reason: already_finished`; an unknown id answers
`not_found`.

A job bridged from another agent carries its parent's job id, so a cancelled parent is visible from
its children.
