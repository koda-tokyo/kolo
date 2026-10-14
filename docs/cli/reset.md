---
summary: "CLI reference for `KoLo reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `KoLo reset`

Reset local config/state (keeps the CLI installed).

```bash
KoLo reset
KoLo reset --dry-run
KoLo reset --scope config+creds+sessions --yes --non-interactive
```
