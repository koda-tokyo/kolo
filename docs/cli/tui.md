---
summary: "CLI reference for `Kurahi tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
title: "tui"
---

# `Kurahi tui`

Open the terminal UI connected to the Gateway.

Related:

- TUI guide: [TUI](/tui)

## Examples

```bash
Kurahi tui
Kurahi tui --url ws://127.0.0.1:18789 --token <token>
Kurahi tui --session main --deliver
Kurahi tui themes list
Kurahi tui themes export ocean --out ./ocean.json
Kurahi tui themes check ./ocean.json
```

## Subcommands

- `themes list` prints the built-in theme names (`--json` for a machine-readable list).
- `themes export <name> [--out <path>]` writes a built-in theme as a JSON theme file; without `--out` it prints to stdout. Exit code 2 for an unknown name.
- `themes check <path>` validates a theme file and prints its name and warnings; exit code 1 when the file is invalid.
