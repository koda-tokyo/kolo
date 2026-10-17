---
summary: "File snapshots before every tool edit, with undo and redo from the terminal and the API"
read_when:
  - The agent changed files and you want them back the way they were
  - You want to know what is stored, where, and how much
title: "Snapshots, undo and redo"
---

# Snapshots, undo and redo

Before a tool writes files in a session (`write`, `edit`, `apply_patch`), the runtime records the content of the files the tool names. Each record is a snapshot of that session. From the terminal UI, `/undo` restores the files of the newest snapshot and `/redo` puts the edit back; the same operations exist on the HTTP API. Git is not involved: nothing is staged, stashed or committed, and the repository's own state is untouched.

What a snapshot holds is the pre-image of the named files only. A file the tool creates is recorded as absent, so undo deletes it. A shell command that edits files (`exec`) is not snapshotted; only the file tools are.

## From the terminal

| Command                   | Key             | Effect                                                                                 |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `/undo`                   | Alt+Z, leader z | restore the files of the newest applied snapshot; the current content is kept for redo |
| `/redo`                   | Alt+R, leader r | put the newest undone edit back                                                        |
| `/snapshots`              | F9, leader p    | list the session's snapshots: number, id, applied or undone, age, tool, files          |
| `/snapshots restore <id>` |                 | undo every snapshot down to and including that id                                      |

Undo and redo work on the files, not on the conversation: the messages stay. Tell the agent what you did, or start a new session with `/new`.

A new edit after an undo discards the undone branch, as in an editor.

## Storage and limits

Snapshots live under `<KOLO_HOME>/snapshots/<session>/`: an `index.json` and an `objects/` directory with one file per distinct content, named by its SHA-256. Identical content is stored once.

```json
{
  "snapshots": {
    "enabled": true,
    "maxPerSession": 50,
    "maxBytesPerSession": 67108864,
    "maxFileBytes": 2097152
  }
}
```

- `maxPerSession`: older snapshots are dropped first (default 50).
- `maxBytesPerSession`: stored content per session (default 64 MiB); older snapshots are dropped until the session fits.
- `maxFileBytes`: a file above this size is recorded as skipped and cannot be restored (default 2 MiB); the rest of the snapshot still works, and the result of a restore names the skipped files.
- `enabled: false` turns snapshots off; `/undo` then reports that there is nothing to undo.

Snapshots are not taken inside the sandbox (`agents.defaults.sandbox`).

## Required snapshots for protected files

By default a snapshot that cannot be taken never blocks an edit. Where an edit must always be
reversible, set `snapshots.required`:

```json
{
  "snapshots": {
    "required": ["contracts/**", "config/*.yaml"]
  }
}
```

- `true` requires a snapshot for every edit; a list of globs (workspace-relative or absolute)
  requires it only for matching files.
- When a required snapshot cannot be captured — the snapshot store fails, or the file is too large
  (`maxFileBytes`) or unreadable — the edit is **refused** before the tool runs. The agent gets an
  error naming the files and the reason.
- The refusal is recorded as an evidence signal (`permission`, decision `deny`, rule
  `snapshots.required`) and an audit event (`snapshot.required`, outcome `denied`).
- Creating a new file is allowed: there is nothing to capture, and undo deletes it.

## API

Both routes take the gateway token or a paired credential with the `attach` scope; the session allowlist of a paired device applies, and a session outside it answers 404. `{id}` resolves like `GET /api/sessions/{id}`: a session id, a session key, a label or an agent id.

`GET /api/sessions/{id}/snapshots`

```json
{
  "ok": true,
  "session": "agent:alice:main",
  "cursor": 2,
  "snapshots": [
    {
      "id": "m2x1-9f3a2c7e",
      "at": "2026-10-14T09:12:03.120Z",
      "tool": "edit",
      "applied": true,
      "files": [{ "path": "/work/src/app.ts", "existed": true, "size": 1832 }]
    }
  ]
}
```

`POST /api/sessions/{id}/snapshots/restore` with `{"action":"undo"}` (the default), `{"action":"redo"}` or `{"id":"<snapshot>"}`:

```json
{
  "ok": true,
  "action": "undo",
  "cursor": 1,
  "steps": [
    {
      "id": "m2x1-9f3a2c7e",
      "at": "…",
      "tool": "edit",
      "restored": ["/work/src/app.ts"],
      "removed": [],
      "skipped": []
    }
  ]
}
```

`409` when there is nothing to undo or redo, or the id is unknown or already undone. Every restore is written to the audit log as `session.snapshot_restore` with the outcome, the action and the counts per step.
