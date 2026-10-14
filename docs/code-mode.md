---
summary: "Code Mode: one agent-written script calls many tools in a sandboxed worker and returns a value"
read_when:
  - You want fewer model round trips for multi-step tool work
  - You are deciding what a script may call and how long it may run
title: "Code Mode"
---

# Code Mode

Instead of one tool call per model turn, the agent writes one small script that calls many tools
and returns a value. Loops, filtering, joining results and any multi-step job whose intermediate
data need not reach the model run in one round trip.

The agent sees it as the `code_mode_run` tool; the gateway exposes the same thing as
`POST /api/code-mode/run` (`kolo api runCodeMode`).

## What the script can do

```js
const jobs = await tools.listJobs({ status: "running" });
return jobs.jobs.map((j) => j.id);
```

- The script is the body of an async function: use `await` and `return`.
- Every tool call is `await tools.<name>({...})`, resolving to `{ text, details? }`.
- JavaScript or TypeScript (`language: "js" | "ts"`; default: detect).
- The tool list the script sees is the calling agent's own filtered list (policy, capability and
  hooks already applied) minus `code_mode_run` itself: core tools, plugin tools and
  `mcp:<server>:<tool>`. `allowTools` (globs such as `mcp:docs:*`) narrows it further for one run.
- A `.d.ts` generated from those tools' schemas is in the tool description, so the model knows the
  signatures.

## Sandbox and limits

The script runs in a worker thread with no filesystem, network or process access of its own; the
only way out is a tool call, and every tool call is audited under the run id.

| Limit | Default |
|---|---|
| wall clock (`timeoutMs`) | 60 s (1 s to 600 s per run) |
| tool calls per script | 200 |
| heap (old / young generation) | 128 MB / 32 MB |
| stack | 4 MB |
| result size | 1 MB |
| tool result size | 4 MB |
| log output | 64 KB |

Each limit can be lowered per agent; raising one is capped by a built-in ceiling.

## Outcome

`ok: true` with `value`, or `ok: false` with `error.code`: `invalid_script`, `script_error`,
`timeout`, `memory`, `tool_call_limit`, `result_too_large`, `worker_error`.

## Access

The HTTP route accepts the gateway token or a paired device credential with at least the `attach`
scope. A backend with `tools: none` answers 403: no tools, no script.
