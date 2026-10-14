---
summary: "log-rotation plugin: size and age caps for the state-root logs and any extra directories, in process, no shell"
read_when:
  - Logs under the state root grow without bound
  - You are replacing a cron/shell job that rotated or gzipped logs
title: "Log Rotation Plugin"
---

# Log Rotation (bundled plugin, off by default)

Every `intervalMs` the state-root log directory (and every directory in `dirs`) is scanned:

- a live log (`*.log` by default) larger than `maxBytes` is rotated to `<name>.1`; older
  generations shift to `.2`, `.3`, … and at most `keep` are kept (`keep: 0` truncates in place);
- rotated generations older than `maxAgeDays` are deleted;
- with `compress: true` the new `.1` is gzip-compressed in process (`zlib`), never by a shell.

Live logs are never deleted, only rotated. A run that changed anything is audited as
`log.rotated` (or `log.rotate_dry_run`) with the file lists; the last run is published as the
`log_rotation.lastRun` signal.

## Config

```json5
{
  plugins: {
    entries: {
      "log-rotation": {
        enabled: true,
        config: {
          intervalMs: 600000,   // >= 10000
          maxBytes: 52428800,   // 50 MB
          maxAgeDays: 14,
          keep: 3,
          compress: false,
          dirs: ["~/.kolo-sibling/logs"],   // extra directories; the state-root logs dir is always included
          extensions: [".log"],
          dryRun: false,        // true: audit what would happen, touch nothing
        },
      },
    },
  },
}
```

Enable with `kolo plugins enable log-rotation` (applied live by a running gateway).

## Notes

- Rotated names follow `<file>.<n>` / `<file>.<n>.gz`; the age cap only ever touches those.
- The gateway's own log writer keeps its file handle: after a rotation it continues in the
  renamed `.1` until it reopens on its next day boundary. For a strict cap on the gateway's own
  file, size the `logging` config and let this plugin handle everything else.
- Audit source: `plugin:log-rotation`.
