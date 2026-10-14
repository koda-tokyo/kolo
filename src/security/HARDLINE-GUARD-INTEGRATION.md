# Hardline Guard — Integration Note

## What was built

- **Module:** `src/security/hardline-guard.ts` — standalone, tested, not wired
- **Tests:** `src/security/hardline-guard.test.ts` — 110 tests, 0 failures
- **Status:** Ready for integration review

## Architecture

```
detectHardlinePreExec(command)
  → detectHardlineCommand()  // hardline patterns (unconditional floor)
  → detectSudoStdin()         // sudo -S without SUDO_PASSWORD env
  → returns HardlineMatch | HardlinePass
```

**17 patterns total** (6 KoLo-specific + 11 universal floor), compiled at module load.
**1 normalizer** (ANSI strip → null-byte strip → NFKC → backslash escape → empty-string escape → whitespace collapse).

## KoLo-specific redlines
| Pattern | Blocks |
|---------|--------|
| `wsl-shutdown` | `wsl --shutdown`, `wsl --terminate` |
| `pm2-gateway-kill` | `pm2 kill`, `pm2 stop kolo-gateway`, `pm2 delete kolo-gateway` |
| `rm-kolo-home` | `rm -rf ~/.kolo`, `rm -rf ~/.kolo/*` |
| `rm-kolo-vault` | `rm -rf ~/.kolo/vault`, `rm -rf ~/.kolo/vault/*` |
| `kill-kolo-pgrep` | `kill -9 $(pgrep -f kolo-gateway)` |
| `pkill-kolo` | `pkill kolo-gateway`, `killall kolo-gateway` |

## Universal floor (from Hermes)
`rm -rf /`, system dirs (/home, /etc, /usr, ...), `rm -rf ~/$HOME`, `mkfs.*`, `dd of=/dev/sd*`, redirect to block device, fork bomb, `kill -1`, `shutdown`/`reboot`/`halt`/`poweroff`, `init 0/6`, `systemctl poweroff/reboot`

## Normalizer evasions caught
- Fullwidth Latin + fullwidth hyphen-minus (U+FF0D) + solidus (U+FF0F) → NFKC
- ANSI escape codes (color, cursor positioning)
- Shell backslash escapes (`r\m` → `rm`)
- Shell empty-string escapes (`r''m` → `rm`)
- Combinations of above

## Wiring point

The guard sits in the exec pipeline **before any yolo/allowlist check**:

```ts
// In exec dispatch (e.g., src/infra/exec-approvals.ts or similar exec path):
import { detectHardlinePreExec } from "../security/hardline-guard.js";

async function executeCommand(command: string, context: ExecContext) {
  // 1. HARDLINE — unconditional floor, no flag can bypass
  const hardline = detectHardlinePreExec(command);
  if (hardline.blocked) {
    return { approved: false, hardline: true, message: hardline.message };
  }

  // 2. Existing yolo/allowlist/approval path continues here...
}
```

## What was NOT done (per scope)
- NOT wired into the live gateway exec path
- No dangerous-pattern check (medium-severity, allows yolo — separate module)
- No "unpaired door" audit (gating all write vectors symmetrically)
- No credential path confinement (separate borrow from report)

## Dependencies
- Zero external dependencies (pure TypeScript, no imports)
- Compatible with KoLo's `.js` import convention
- Builds on existing `src/security/` module (alongside audit.ts, fix.ts)
