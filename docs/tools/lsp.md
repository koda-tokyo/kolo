---
summary: "Language server integration: diagnostics after every file edit, plus definition, references and hover tools"
read_when:
  - You want the agent to see type errors right after it edits a file
  - You need to add or change a language server
title: "Language servers (LSP)"
---

# Language servers

The runtime can talk to Language Server Protocol servers over stdio. Two things come out of it:

- After a file-edit tool (`write`, `edit`, `apply_patch`) succeeds, the diagnostics the matching server reports for the touched file are appended to the tool result. The agent sees errors in the same turn, without running a build.
- Four tools let the agent ask a server directly: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`.

Nothing is bundled or downloaded. Each server is a command; when the command is not on `PATH`, the server is skipped and the tools answer with a one-line notice. Servers start on first use, one per language and project root, and stop after five minutes without requests.

## Defaults

| Language     | Command                              | File extensions            | Root markers                               | Install                                                                                          |
| ------------ | ------------------------------------ | -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `typescript` | `typescript-language-server --stdio` | ts, tsx, js, jsx, mts, cts | package.json, tsconfig.json                | `npm install -g typescript-language-server typescript`                                           |
| `python`     | `pyright-langserver --stdio`         | py                         | pyproject.toml, setup.py, requirements.txt | `pip install pyright` or `npm install -g pyright`                                                |
| `go`         | `gopls`                              | go                         | go.mod                                     | `go install golang.org/x/tools/gopls@latest`                                                     |
| `rust`       | `rust-analyzer`                      | rs                         | Cargo.toml                                 | `rustup component add rust-analyzer`                                                             |
| `java`       | `jdtls`                              | java                       | pom.xml, build.gradle                      | package `jdtls` from your package manager, or the Eclipse JDT language server launcher on `PATH` |

The project root is the nearest directory above the file that holds one of the root markers; without a match, the file's own directory is used.

## Configuration

```json
{
  "lsp": {
    "enabled": true,
    "servers": {
      "python": { "command": "pylsp", "args": [] },
      "rust": { "disabled": true },
      "zig": { "command": "zls", "extensions": ["zig"], "rootMarkers": ["build.zig"] }
    },
    "diagnosticsTimeoutMs": 3000,
    "maxDiagnosticsChars": 4000
  }
}
```

| Key                              | Meaning                                                                | Default               |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| `lsp.enabled`                    | master switch; `false` removes the tools and the post-edit diagnostics | `true`                |
| `lsp.servers.<lang>.command`     | executable name or path                                                | built-in per language |
| `lsp.servers.<lang>.args`        | arguments                                                              | built-in per language |
| `lsp.servers.<lang>.extensions`  | file extensions the server handles (no dot)                            | built-in per language |
| `lsp.servers.<lang>.rootMarkers` | files that mark a project root                                         | built-in per language |
| `lsp.servers.<lang>.disabled`    | drop a built-in entry                                                  | `false`               |
| `lsp.diagnosticsTimeoutMs`       | how long to wait for a server to report after an edit                  | `3000`                |
| `lsp.maxDiagnosticsChars`        | upper bound on the diagnostics text added to one tool result           | `4000`                |

User entries merge over the defaults key by key; a new language id adds a server. Language ids are lowercase letters, digits, `-` and `_`.

## Tools

All paths are absolute or relative to the agent's workspace. Lines and columns are 1-based.

| Tool              | Parameters                  | Result                                                                                     |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `lsp_diagnostics` | `path`                      | one line per diagnostic: `path:line:col severity message`, or `no diagnostics for <path>.` |
| `lsp_definition`  | `path`, `line`, `character` | `{ "locations": [{ "path", "line", "character" }] }`                                       |
| `lsp_references`  | `path`, `line`, `character` | same shape as `lsp_definition`                                                             |
| `lsp_hover`       | `path`, `line`, `character` | the hover text (type, signature, documentation)                                            |

The tools belong to the policy group `group:lsp` and to the `coding` tool profile. They are available in Code Mode under the same names.

When a server cannot serve a file the tool returns one sentence instead of an error, for example `language server command gopls is not installed; install it or set lsp.servers.go.command.`

## Diagnostics after an edit

When `write`, `edit` or `apply_patch` succeeds and a server matches the file, the runtime sends the new file content to the server and waits up to `diagnosticsTimeoutMs` for its report. If there is at least one diagnostic, a text block is appended to the tool result:

```
diagnostics (typescript):
src/app.ts:12:7 error Property 'nmae' does not exist on type 'User'.
src/app.ts:30:1 warning 'unused' is declared but its value is never read.
… 3 more
```

No diagnostics means nothing is appended. A server that fails, times out or is missing never fails the edit. Diagnostics are sorted errors first and cut at `maxDiagnosticsChars` with a `… N more` line.

## Limits

- Sandboxed sessions do not get the tools or the post-edit diagnostics; the server would run outside the sandbox.
- Servers see the file as it is on disk after the edit; unsaved editor buffers are not involved.
- Diagnostics are per file. Project-wide checks (a full type check, a linter run) stay a job for `exec`; document those commands in your `AGENTS.md`.
- Each request to a server has a five-second timeout.
