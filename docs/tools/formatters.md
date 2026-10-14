---
summary: "Formatters run after every file edit: prettier, biome, ruff, black, gofmt, rustfmt, or your own command per language"
read_when:
  - You want edited files formatted the way the project formats them
  - You need to add, replace or turn off a formatter
title: "Formatters after edits"
---

# Formatters after edits

After a file-edit tool (`write`, `edit`, `apply_patch`) succeeds, the formatter for the file's language runs on the edited file and one line is appended to the tool result, the way [language-server diagnostics](/tools/lsp) are appended:

```
formatted (prettier): /work/src/app.ts
```

The agent sees that the file changed under it and reads it again before the next edit. Language-server diagnostics, when enabled, are computed after formatting, so they describe the formatted file.

Nothing is bundled or downloaded. A formatter is a command; when the command is not on `PATH`, nothing runs and nothing is appended.

## Defaults

| Language     | File extensions   | Commands tried in order                                               |
| ------------ | ----------------- | --------------------------------------------------------------------- |
| `typescript` | ts, tsx, mts, cts | `biome format --write` (when `biome.json` exists), `prettier --write` |
| `javascript` | js, jsx, mjs, cjs | same as `typescript`                                                  |
| `json`       | json, jsonc       | same as `typescript`                                                  |
| `css`        | css, scss, less   | same as `typescript`                                                  |
| `markdown`   | md, mdx           | `prettier --write`                                                    |
| `yaml`       | yml, yaml         | `prettier --write`                                                    |
| `html`       | html, vue, svelte | `prettier --write`                                                    |
| `python`     | py, pyi           | `ruff format`, `black -q`                                             |
| `go`         | go                | `gofmt -w`                                                            |
| `rust`       | rs                | `rustfmt --edition 2021`                                              |

`biome` is tried only when a `biome.json` or `biome.jsonc` exists in a directory above the file, so a project that uses prettier is not touched by a globally installed biome. The first command found on `PATH` wins; detection is cached per tool instance.

## Configuration

```json
{
  "format": {
    "enabled": true,
    "onEdit": {
      "python": "yapf -i {file}",
      "go": false,
      "sql": "sqlfmt \"{file}\""
    },
    "timeoutMs": 10000,
    "maxOutputChars": 2000
  }
}
```

- `onEdit.<language>` replaces the default command for that language; `{file}` is the edited path and is appended when absent. Quotes group arguments; there is no shell.
- `onEdit.<language>: false` turns a default off.
- A language without defaults (`sql` above) matches files whose extension equals the language id.
- `enabled: false` turns the feature off.
- `timeoutMs` stops a formatter that runs too long (default 10 s); `maxOutputChars` bounds the formatter output kept for the result line (default 2000).

## Result lines

| Line                                                                | Meaning                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `formatted (<command>): <path>`                                     | the command exited 0 and the file's bytes changed                                                                       |
| `already formatted (<command>): <path>`                             | the command exited 0 and the file did not change                                                                        |
| `formatter failed (<command> exit <n>): <path>` + first output line | the command exited non-zero; the edit itself stands                                                                     |
| `formatter timed out (<command>) after <ms> ms: <path>`             | the command was stopped at `timeoutMs`; the file may be half-written only if the tool itself does that; the edit stands |

A formatter failure never fails the edit: the edit result is the tool's own result plus the line.

## Limits

- Formatters run in the file's directory with the gateway's environment; they do not run in the sandbox (`agents.defaults.sandbox`), where edits are not formatted.
- One formatter per file per edit. `apply_patch` formats every added and modified file.
- The formatter must accept a file path argument and write in place.
