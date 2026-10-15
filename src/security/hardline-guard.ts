/**
 * Hardline Pre-Exec Command Guard
 *
 * Machine-enforces covenant redlines that today are only prompt-enforced.
 * The hardline check runs BEFORE any yolo/allowlist bypass — it is the
 * unconditional floor. No autonomy flag, sibling daemon, or prompt-injected
 * skill can skip it.
 *
 * Architecture borrowed from Hermes (Nous Research, MIT) tools/approval.py,
 * adapted for KoLo's TS gateway with KoLo-specific redline patterns.
 *
 * Ordered: hardline → sudo-stdin → yolo → allowlist → dangerous → approve.
 *
 * @module security/hardline-guard
 */

// ── Normalizer ───────────────────────────────────────────────────────────
// The non-obvious piece worth stealing intact from Hermes.
// Without NFKC + escape-stripping, an attacker writes ｒｍ ーｒｆ ／ (fullwidth)
// and walks past ASCII-only patterns.

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const NULL_BYTE_RE = /\x00/g;
const SHELL_BACKSLASH_ESCAPE_RE = /\\([a-z])/gi;
const SHELL_EMPTY_STRING_ESCAPE_RE = /''/g;
const WHITESPACE_COLLAPSE_RE = /\s+/g;

// Characters that can separate a "word" in a command — used to anchor
// bareword patterns like mkfs.* so they don't fire on directory names.
const WORD_BOUNDARY_BEFORE = /(?:^|[\s;&|`"'()<>])/;

/**
 * Normalize a command string for safe pattern matching.
 *
 * Steps:
 *  1. Strip ANSI escape sequences (color codes, cursor moves)
 *  2. Remove null bytes
 *  3. NFKC-normalize Unicode (fullwidth → ASCII: ｒｍ → rm)
 *  4. Strip shell backslash escapes (r\m → rm)
 *  5. Strip shell empty-string escapes (r''m → rm)
 *  6. Collapse whitespace
 */
export function normalizeForDetection(command: string): string {
  let s = command;
  // Step 1: Strip ANSI escape codes (color, cursor positioning, etc.)
  s = s.replace(ANSI_RE, "");
  // Step 2: Remove null bytes
  s = s.replace(NULL_BYTE_RE, "");
  // Step 3: NFKC normalize — maps fullwidth Latin/CJK punctuation to ASCII
  s = s.normalize("NFKC");
  // Step 4: Strip shell backslash escapes — r\m → rm, \r\m → rm
  // These are used to break up keywords in pattern matching
  s = s.replace(SHELL_BACKSLASH_ESCAPE_RE, "$1");
  // Step 5: Strip shell empty-string escapes — r''m → rm
  s = s.replace(SHELL_EMPTY_STRING_ESCAPE_RE, "");
  // Step 6: Collapse whitespace (preserves structure, simplifies patterns)
  s = s.replace(WHITESPACE_COLLAPSE_RE, " ").trim();
  return s;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface HardlineMatch {
  blocked: true;
  hardline: true;
  pattern: string;
  description: string;
  message: string;
}

export interface HardlinePass {
  blocked: false;
}

export type HardlineResult = HardlineMatch | HardlinePass;

// ── Pattern definitions ──────────────────────────────────────────────────

interface HardlinePattern {
  /** Pre-compiled regex */
  re: RegExp;
  /** Stable identifier for audit/testing */
  pattern: string;
  /** Human-readable description shown in block message */
  description: string;
}

/**
 * Build the block message for a hardline match.
 */
function blocked(desc: string, pat: string): HardlineMatch {
  return {
    blocked: true,
    hardline: true,
    pattern: pat,
    description: desc,
    message:
      `BLOCKED (hardline): ${desc}. ` +
      `This command is on the unconditional blocklist and cannot be executed ` +
      `via Kurahi — not even with elevated autonomy or yolo mode. ` +
      `If you genuinely need to run it, do so directly in a terminal outside the agent.`,
  };
}

// ── KoLo-specific redlines ───────────────────────────────────────────────
// These are OUR covenant redlines, not Hermes' — drawn from MEMORY.md and
// family safety rules, now machine-enforced.

const KOLO_HARDLINE: HardlinePattern[] = [
  // WSL lifecycle — kills all siblings, unrecoverable from inside WSL2
  {
    re: /\bwsl\s+(--shutdown|--terminate)\b/i,
    pattern: "wsl-shutdown",
    description: "WSL shutdown/terminate (kills all sibling gateways)",
  },
  // PM2 gateway kill — kills the gateway daemon and all running agents
  {
    re: /\bpm2\s+(kill|delete\s+(?:kolo|kurahi)-gateway|stop\s+(?:kolo|kurahi)-gateway)\b/i,
    pattern: "pm2-gateway-kill",
    description: "PM2 kill/stop Kurahi gateway",
  },
  // Delete Kurahi home — wipes all memory, vault, identity, config
  {
    re: /\brm\s+(-[^\s]*[rf][^\s]*\s+)*~\/\.kolo(\/\*?)?(\s|$)/i,
    pattern: "rm-kolo-home",
    description: "delete Kurahi home (~/.kolo) — wipes all memory and identity",
  },
  // Delete Kurahi vault — wipes credentials and secrets
  {
    re: /\brm\s+(-[^\s]*[rf][^\s]*\s+)*~\/\.kolo\/vault(\/\*?)?(\s|$)/i,
    pattern: "rm-kolo-vault",
    description: "delete Kurahi vault (~/.kolo/vault) — wipes all credentials",
  },
  // Kill Kurahi via pgrep/pidof — self-termination attack
  {
    re: /\bkill\b.*\$\(\s*pgrep\b.*(?:kolo|kurahi|gateway)/i,
    pattern: "kill-kolo-pgrep",
    description: "kill Kurahi gateway via pgrep (self-termination)",
  },
  // Kill Kurahi processes by name
  {
    re: /\b(?:pkill|killall)\b.*\b(?:kolo|kurahi|kolo-gateway|kurahi-gateway)\b/i,
    pattern: "pkill-kolo",
    description: "kill Kurahi processes by name (self-termination)",
  },
];

// ── Universal floor (from Hermes HARDLINE_PATTERNS) ──────────────────────
// Deliberately tiny — only things with NO recovery path.
// Recoverable-but-costly ops (git reset --hard, curl|sh) stay in the
// dangerous-pattern check (a separate module) where yolo can pass them.

const UNIVERSAL_HARDLINE: HardlinePattern[] = [
  // Recursive delete of root filesystem
  {
    re: /\brm\s+(-[^\s]*\s+)*(\/\*?|\/\s+\*)(\s|$)/i,
    pattern: "rm-rootfs",
    description: "recursive delete of root filesystem",
  },
  // Recursive delete of critical system directories
  {
    re: /\brm\s+(-[^\s]*[rf][^\s]*\s+)*\/(?:home|root|etc|usr|var|bin|sbin|boot|lib|opt)(\/\*?)?(\s|$)/i,
    pattern: "rm-system-dir",
    description: "recursive delete of system directory",
  },
  // Recursive delete of home directory
  {
    re: /\brm\s+(-[^\s]*[rf][^\s]*\s+)*(?:~|\$HOME)(\/\*?)?(\s|$)/i,
    pattern: "rm-home",
    description: "recursive delete of home directory",
  },
  // Filesystem format
  {
    re: /\bmkfs(\.[a-z0-9]+)?\b/i,
    pattern: "mkfs",
    description: "format filesystem (mkfs)",
  },
  // dd to raw block device
  {
    re: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*/i,
    pattern: "dd-block-device",
    description: "dd write to raw block device",
  },
  // Redirect to raw block device
  {
    re: />\s*\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*\b/i,
    pattern: "redirect-block-device",
    description: "redirect output to raw block device",
  },
  // Fork bomb (classic shell form)
  {
    re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i,
    pattern: "fork-bomb",
    description: "fork bomb (denial of service)",
  },
  // Kill all processes (kill -1)
  {
    re: /\bkill\s+(-[^\s]+\s+)*-1\b/i,
    pattern: "kill-all",
    description: "kill all processes (kill -1)",
  },
  // System shutdown/reboot — anchored to command-start positions
  {
    re: /(?:^|[;&|\n])\s*(?:sudo\s+(?:-[^\s]+\s+)*)?(?:env\s+(?:\w+=\S+\s+)*)?(?:(?:nohup|exec|setsid)\s+)*\s*(shutdown|reboot|halt|poweroff)\b/im,
    pattern: "system-shutdown",
    description: "system shutdown/reboot/halt",
  },
  // init 0/6 (shutdown/reboot)
  {
    re: /(?:^|[;&|\n])\s*(?:sudo\s+)?init\s+[06]\b/im,
    pattern: "init-runlevel",
    description: "init 0/6 (shutdown/reboot)",
  },
  // systemctl poweroff/reboot/halt
  {
    re: /(?:^|[;&|\n])\s*(?:sudo\s+)?systemctl\s+(?:poweroff|reboot|halt|kexec)\b/im,
    pattern: "systemctl-shutdown",
    description: "systemctl poweroff/reboot (system shutdown)",
  },
];

// ── Sudo stdin guard ─────────────────────────────────────────────────────
// When SUDO_PASSWORD is not configured, any explicit "sudo -S" is the LLM
// piping a guessed password via stdin — a brute-force attack vector.
// Blocked unconditionally.

const SUDO_STDIN_RE = /(?:^|[;&|`\n]|&&|\|\||\$\(\))\s*sudo\s+-S\b/i;

/**
 * Check if a command attempts sudo password guessing via stdin.
 * Only blocks when SUDO_PASSWORD env var is NOT set.
 */
export function detectSudoStdin(command: string): HardlineResult | null {
  // If sudo password is configured, sudo -S is legitimate
  if (process.env.SUDO_PASSWORD) return null;

  const normalized = normalizeForDetection(command);
  if (SUDO_STDIN_RE.test(normalized)) {
    return {
      blocked: true,
      hardline: true,
      pattern: "sudo-stdin",
      description: "sudo password guessing via stdin (sudo -S)",
      message:
        `BLOCKED: sudo password guessing via stdin (sudo -S). ` +
        `Do not pipe passwords to sudo -S — this is a brute-force attack vector. ` +
        `Set SUDO_PASSWORD in your .env file if passwordless sudo is needed, ` +
        `or run the sudo command manually in your own terminal.`,
    };
  }
  return null;
}

// ── All patterns (compiled at module load) ───────────────────────────────

const ALL_PATTERNS: HardlinePattern[] = [...KOLO_HARDLINE, ...UNIVERSAL_HARDLINE];

// ── Detection ────────────────────────────────────────────────────────────

/**
 * Check if a command matches the unconditional hardline blocklist.
 *
 * This MUST be called before any yolo/allowlist check.
 * No autonomy flag can bypass a hardline block — it is the floor.
 *
 * @returns HardlineMatch if blocked, null if clean
 */
export function detectHardlineCommand(command: string): HardlineMatch | null {
  const normalized = normalizeForDetection(command).toLowerCase();

  for (const { re, pattern, description } of ALL_PATTERNS) {
    // Clone regex to reset lastIndex (global/multiline regexes have state)
    const regex = new RegExp(re.source, re.flags);
    if (regex.test(normalized)) {
      return blocked(description, pattern);
    }
  }

  return null;
}

/**
 * Full pre-exec check: hardline → sudo-stdin guard.
 * Returns the first blocking match, or null if the command passes.
 *
 * This is the entry point for wiring into the exec path:
 *
 * ```ts
 * const hardline = detectHardlinePreExec(command);
 * if (hardline) return hardline; // BLOCKED — do not execute
 * // ... proceed to yolo/allowlist/dangerous-pattern checks ...
 * ```
 */
export function detectHardlinePreExec(command: string): HardlineResult {
  const hardline = detectHardlineCommand(command);
  if (hardline) return hardline;

  const sudoStdin = detectSudoStdin(command);
  if (sudoStdin) return sudoStdin;

  return { blocked: false };
}

// ── Re-exports for testing ───────────────────────────────────────────────

export { KOLO_HARDLINE, UNIVERSAL_HARDLINE, ALL_PATTERNS };
