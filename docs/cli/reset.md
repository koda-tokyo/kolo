---
summary: "CLI reference for `Kurahi reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `Kurahi reset`

Reset local config/state (keeps the CLI installed).

```bash
Kurahi reset
Kurahi reset --dry-run
Kurahi reset --scope config+creds+sessions --yes --non-interactive
```
