---
summary: "Terminal UI (TUI): connect to the Gateway from any machine"
read_when:
  - You want a beginner-friendly walkthrough of the TUI
  - You need the complete list of TUI features, commands, and shortcuts
title: "TUI"
---

# TUI (Terminal UI)

## Quick start

1. Start the Gateway.

```bash
Kurahi gateway
```

2. Open the TUI.

```bash
Kurahi tui
```

3. Type a message and press Enter.

Remote Gateway:

```bash
Kurahi tui --url ws://<host>:<port> --token <gateway-token>
```

Use `--password` if your Gateway uses password auth.

## What you see

- Header: connection URL, current agent, current session.
- Chat log: user messages, assistant replies, system notices, tool cards, diffs for file edits.
- State line: connection and run state (connecting, running, streaming, idle, error). While the gateway is unreachable a banner sits above it with the reason and the next reconnect attempt.
- Status line: identity (agent id and display name), session, job state, tool steps against the run's step limit, provider profile, model, think/verbose/reasoning and token counts. Provider names are whatever you configured; the TUI never adds its own.
- Input: text editor with autocomplete.

## Mental model: agents + sessions

- Agents are unique slugs (e.g. `main`, `research`). The Gateway exposes the list.
- Sessions belong to the current agent.
- Session keys are stored as `agent:<agentId>:<sessionKey>`.
  - If you type `/session main`, the TUI expands it to `agent:<currentAgent>:main`.
  - If you type `/session agent:other:main`, you switch to that agent session explicitly.
- Session scope:
  - `per-sender` (default): each agent has many sessions.
  - `global`: the TUI always uses the `global` session (the picker may be empty).
- The current agent + session are always visible in the footer.

## Sending + delivery

- Messages are sent to the Gateway; delivery to providers is off by default.
- Turn delivery on:
  - `/deliver on`
  - or the Settings panel
  - or start with `Kurahi tui --deliver`

## Pickers + overlays

- Session switcher (`/sessions`, Ctrl+P): one row per session across all agents, showing agent id, title or key, last activity and a preview of the last message. The first row starts a new session for the current agent. Type to filter.
- Model picker: list available models and set the session override.
- Agent picker: choose a different agent.
- Settings: toggle tool output expansion and the reasoning view (off, collapsed, expanded).

## Keyboard shortcuts

Every action has a direct key and a leader chord: press the leader (`ctrl+x` by default), then one key. Both can be changed under `tui.keybinds` (see below); `/keys` prints the active table.

| Action            | Key    | Chord    | What it does                                           |
| ----------------- | ------ | -------- | ------------------------------------------------------ |
| `sessions`        | Ctrl+P | Ctrl+X s | open the session switcher                              |
| `models`          | Ctrl+L | Ctrl+X m | model picker                                           |
| `agents`          | Ctrl+G | Ctrl+X a | agent picker                                           |
| `toggleReasoning` | Ctrl+O | Ctrl+X f | expand or collapse the latest reasoning block          |
| `toggleTools`     | Alt+O  | Ctrl+X o | expand or collapse tool cards (and diffs)              |
| `toggleThinking`  | Ctrl+T | Ctrl+X t | show or hide reasoning blocks                          |
| `toggleDiff`      | Ctrl+Y | Ctrl+X d | show or hide diffs under file-edit tools               |
| `abort`           | Esc    | Ctrl+X . | abort the active run                                   |
| `exit`            | Ctrl+D | Ctrl+X q | exit (only when the input is empty)                    |
| `clearInput`      | Ctrl+C | Ctrl+X u | clear the input; press twice on an empty input to exit |
| `help`            | F1     | Ctrl+X h | slash command help                                     |
| `status`          | F2     | Ctrl+X i | gateway status summary                                 |
| `jobs`            | F3     | Ctrl+X j | list jobs                                              |
| `settings`        | F4     | Ctrl+X , | settings panel                                         |
| `toggleUsage`     | F5     | Ctrl+X g | cycle the usage footer (off, tokens, full)             |
| `cycleTheme`      | F6     | Ctrl+X c | next built-in theme                                    |
| `keys`            | F7     | Ctrl+X k | print the key table                                    |
| `newSession`      | Ctrl+N | Ctrl+X n | reset the session                                      |
| `clearScreen`     | Ctrl+R | Ctrl+X l | clear the screen (the session is kept)                 |

Enter sends the message. Alt+Enter inserts a newline. While the leader is pressed the status line says so; Escape cancels the chord and a key with no chord is reported instead of typed.

### Configuring keybinds

```json
{
  "tui": {
    "keybinds": {
      "leader": "ctrl+b",
      "sessions": "f9",
      "toggleDiff": ["ctrl+shift+y", "leader+y"],
      "help": "leader+?"
    }
  }
}
```

Key ids are a base key (`a`-`z`, a symbol, `enter`, `escape`, `tab`, `f1`-`f12`, `up`, `pageUp`, ...) with optional `ctrl+`, `alt+` and `shift+` modifiers. A chord is written `leader+<key>`; a list sets several bindings. A configured direct key replaces the default direct key and a configured chord replaces the default chord; the other kind keeps its default. `"leader": ""` turns chords off.

Problems are reported as system lines when the TUI starts and the default is kept: unknown actions, unparseable keys, a chord on `escape` (reserved for cancelling), and a direct key equal to the leader. When two actions end up on the same key or the same chord, the later action in the table above keeps it and the earlier one loses that binding.

## Themes

Eight built-in themes: `dark` (default), `light`, `high-contrast`, `dusk`, `forest`, `ocean`, `paper` and `mono`. Set `tui.theme` in `kolo.json` or switch at runtime with `/theme <name>`; `/theme` without a name lists them. Switching redraws the session from the record.

```json
{ "tui": { "theme": "light" } }
```

### Theme files

`tui.theme` and `/theme` also accept a path to a JSON theme file. A file names a built-in `base` and overrides only the tokens it changes; colours are `#RGB` or `#RRGGBB`.

```json
{ "name": "sunset", "base": "dark", "palette": { "accent": "#FF8800", "link": "#7DD3A5" } }
```

```json
{ "tui": { "theme": "./sunset.json" } }
```

Relative paths resolve against the directory `kurahi tui` starts in. Unknown tokens are reported as a system line and ignored; an invalid colour or base rejects the file and the TUI starts with `dark`.

- `kurahi tui themes list` prints the built-in names.
- `kurahi tui themes export <name> [--out <path>]` writes a built-in theme as a complete theme file to edit.
- `kurahi tui themes check <path>` validates a theme file without opening the TUI.

Tokens: `text`, `dim`, `accent`, `accentSoft`, `border`, `userBg`, `userText`, `systemText`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `toolTitle`, `toolOutput`, `quote`, `quoteBorder`, `code`, `codeBlock`, `codeBorder`, `link`, `error`, `success`, `diffAdded`, `diffRemoved`, `diffHunk`, `diffContext`, `reasoning`, `banner`, `bannerBg`.

## File references

Type `@` and start a path: the editor completes files from the directory `kurahi tui` was started in (`@src/app.ts`, or `@"a file with spaces.md"`). When the message is sent, each reference that names a readable text file is appended to it as a fenced block headed `File: <path>`, so the agent reads it in the same turn; the chat log shows the line as typed and one system line naming what was attached. Limits: 64 KiB per file, 256 KiB and ten files per message; binary files are skipped and reported. A reference that is not a file (an address, a name) is left as typed.

## Export and external editor

`/export` writes the session transcript to a file. The default is Markdown in the directory `kurahi tui` was started from, named `kolo-session-<key>-<timestamp>.md`; `/export json` writes the raw message records, and a path argument chooses the file (a `.json` path implies JSON). Existing files are never overwritten. Secrets are redacted with the same patterns as the logs (`logging.redactPatterns`), always, even when log redaction is off. Up to 1000 messages are exported.

`/editor` opens the current prompt in `$VISUAL`, else `$EDITOR` (on Windows, `notepad` when neither is set). The TUI releases the terminal while the editor runs and restores it afterwards; when the editor exits with code 0 the file's contents replace the prompt. The temp file lives under `<KOLO_HOME>/tmp` with mode 600 and is removed afterwards. Nothing is sent until you press Enter.

## Slash commands

Core:

- `/help`
- `/status`
- `/agent <id>` (or `/agents`)
- `/sessions` (switcher), `/sessions new [key]` (start a session and switch to it), `/session <key>`, `/attach <key>`
- `/model <provider/model>` (or `/models`)
- `/jobs` (list recent jobs on the gateway: id, agent, status, steps, started, session)
- `/cancel [job-id]` (cancel a job by id or id prefix; without an id, the running job of this session, otherwise the active run)
- `/clear` (clear the screen; the session is untouched)
- `/diff <on|off>` (diffs under file-edit tools; default from `tui.diffs`)
- `/theme <name|path>` (a built-in theme or a theme file)
- `/keys` (active key bindings)
- `/export [md|json] [path]` (write the transcript to a file; see below)
- `/editor` (edit the prompt in `$VISUAL` or `$EDITOR`; see below)
- `/undo`, `/redo`, `/snapshots [restore <id>]` (file snapshots taken before tool edits; see [Snapshots](/tools/snapshots))

Session controls:

- `/think <off|minimal|low|medium|high>`
- `/verbose <on|full|off>`
- `/reasoning <on|off|collapsed|expanded>` (see [Reasoning](#reasoning))
- `/usage <off|tokens|full>`
- `/elevated <on|off|ask|full>` (alias: `/elev`)
- `/activation <mention|always>`
- `/deliver <on|off>`

Session lifecycle:

- `/new` or `/reset` (reset the current session); `/new <key>` starts another session instead
- `/abort` (abort the active run)
- `/settings`
- `/exit`

Other Gateway slash commands (for example, `/context`) are forwarded to the Gateway and shown as system output. See [Slash commands](/tools/slash-commands).

## Local shell commands

- Prefix a line with `!` to run a local shell command on the TUI host.
- The TUI prompts once per session to allow local execution; declining keeps `!` disabled for the session.
- Commands run in a fresh, non-interactive shell in the TUI working directory (no persistent `cd`/env).
- A lone `!` is sent as a normal message; leading spaces do not trigger local exec.

## Tool output

- Tool calls show as cards with args + results.
- Alt+O toggles between collapsed/expanded views.
- While tools run, partial updates stream into the same card.

## Diffs for file edits

Tools that edit files (`edit`, `write`, `apply_patch`) get a unified diff under the card. Collapsed, it is one line: `+N -M in <path>`. Expanded (Alt+O), it shows the hunks with added and removed lines coloured by the theme, capped at 200 lines with a trailing `... N more lines`. The diff is computed in the TUI from the tool's arguments: a replaced region for `edit`, the whole file as added for `write`, the patch text for `apply_patch`. Turn diffs off with `/diff off`, Ctrl+Y, or `"tui": { "diffs": false }`.

## Reasoning

When the model reasons before it answers (thinking blocks, or `<think>` tags from models that write their reasoning inline), the TUI shows that reasoning as its own block above the answer, in dimmed italic text in the theme's `reasoning` colour:

```
 ⠋ Thinking
   The user asks which port the gateway listens on.
   The config sets gateway.port, so read kolo.json first.
   If it is missing, the default applies.
```

While the model thinks, the block is expanded and follows the newest lines, under a `Thinking` header with a spinner. When the answer starts, the header becomes `Thought for 12s` and the block collapses to its first three lines:

```
 Thought for 12s (ctrl+o to expand)
   The user asks which port the gateway listens on.
   The config sets gateway.port, so read kolo.json first.
   If it is missing, the default applies.
   … 2 more lines

 It listens on 18789, the default.
```

- Ctrl+O (`toggleReasoning`) expands or collapses the latest reasoning block. Ctrl+T (`toggleThinking`) shows or hides all reasoning.
- `/reasoning on|off|collapsed|expanded` sets the view: `collapsed` (the default) shows the first lines once the answer starts, `expanded` keeps whole blocks open, `off` hides reasoning, and `on` turns it back on with the last layout. The choice is saved on the session (`reasoningView`), so every terminal attached to the session shows the same thing; `off` also stops the gateway from streaming reasoning to that session.
- A block is never taller than `tui.reasoning.maxLines` (default 400): longer reasoning ends with `… N more lines` (or starts with `… N earlier lines` while it streams). Escape sequences and control characters are removed before display, so reasoning cannot disturb tool cards or diffs.
- Operators can keep reasoning on the gateway: `agents.defaults.reasoning.expose: false` (or `agents.list[].reasoning.expose` per agent), or the policy key `agents[<glob>].reasoning.expose: false`. Reasoning that leaves the gateway is redacted with the built-in secret patterns and `logging.redactPatterns`.
- `kurahi attach` prints reasoning dimmed under the same headers, and the dashboard chat shows it as a collapsible `Thinking` section.

```json5
{
  tui: {
    reasoning: { maxLines: 400 },
    keybinds: { toggleReasoning: "ctrl+o" },
  },
  agents: { defaults: { reasoning: { expose: true } } },
}
```

## History + streaming

- On connect, the TUI loads the latest history (default 200 messages).
- Streaming responses update in place until finalized.
- The TUI also listens to agent tool events for richer tool cards.

## Connection details

- The TUI registers with the Gateway as `mode: "tui"`.
- When the connection drops, a banner reads `gateway unreachable (<reason>). reconnecting in Ns` and counts down; reconnects back off from 1 s to 30 s. The banner disappears when the connection is back and the session is redrawn from the record, so nothing streamed during the gap is lost.
- Messages typed while disconnected wait up to 30 s for the gateway before failing.
- Event gaps are surfaced in the log.
- Rendering is coalesced: during streaming the screen is drawn at most about 30 times a second however many deltas arrive.

## Options

- `--url <url>`: Gateway WebSocket URL (defaults to config or `ws://127.0.0.1:<port>`)
- `--token <token>`: Gateway token (if required)
- `--password <password>`: Gateway password (if required)
- `--session <key>`: Session key (default: `main`, or `global` when scope is global)
- `--deliver`: Deliver assistant replies to the provider (default off)
- `--thinking <level>`: Override thinking level for sends
- `--timeout-ms <ms>`: Agent timeout in ms (defaults to `agents.defaults.timeoutSeconds`)

## Troubleshooting

No output after sending a message:

- Run `/status` in the TUI to confirm the Gateway is connected and idle/busy.
- Check the Gateway logs: `Kurahi logs --follow`.
- Confirm the agent can run: `Kurahi status` and `Kurahi models status`.
- If you expect messages in a chat channel, enable delivery (`/deliver on` or `--deliver`).
- `--history-limit <n>`: History entries to load (default 200)

## Troubleshooting

- `disconnected`: ensure the Gateway is running and your `--url/--token/--password` are correct.
- No agents in picker: check `Kurahi agents list` and your routing config.
- Empty session picker: you might be in global scope or have no sessions yet.
