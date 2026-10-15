/**
 * Tests for the Hardline Pre-Exec Command Guard.
 *
 * Covers:
 *  (a) Each redline pattern is blocked
 *  (b) Fullwidth/ANSI/backslash-escape evasions caught by the normalizer
 *  (c) Legitimate commands pass clean (no false positives)
 */

import { describe, expect, it } from "vitest";
import {
  detectHardlineCommand,
  detectHardlinePreExec,
  detectSudoStdin,
  normalizeForDetection,
  KOLO_HARDLINE,
  UNIVERSAL_HARDLINE,
  ALL_PATTERNS,
} from "./hardline-guard.js";

// ── (a) Each redline pattern is blocked ──────────────────────────────────

describe("KoLo-specific redlines", () => {
  it("blocks wsl --shutdown", () => {
    const r = detectHardlineCommand("wsl --shutdown");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });

  it("blocks wsl --terminate", () => {
    const r = detectHardlineCommand("wsl --terminate");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });

  it("blocks wsl --shutdown with extra args", () => {
    const r = detectHardlineCommand("wsl --shutdown --force");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });

  it("blocks pm2 kill", () => {
    const r = detectHardlineCommand("pm2 kill");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pm2-gateway-kill");
  });

  it("blocks pm2 stop kolo-gateway", () => {
    const r = detectHardlineCommand("pm2 stop kolo-gateway");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pm2-gateway-kill");
  });

  it("blocks pm2 delete kolo-gateway", () => {
    const r = detectHardlineCommand("pm2 delete kolo-gateway");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pm2-gateway-kill");
  });

  it("blocks rm -rf ~/.kolo", () => {
    const r = detectHardlineCommand("rm -rf ~/.kolo");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-kolo-home");
  });

  it("blocks rm -rf ~/.kolo/*", () => {
    const r = detectHardlineCommand("rm -rf ~/.kolo/*");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-kolo-home");
  });

  it("blocks rm -r ~/.kolo (non-force)", () => {
    const r = detectHardlineCommand("rm -r ~/.kolo");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-kolo-home");
  });

  it("blocks rm -rf ~/.kolo/vault", () => {
    const r = detectHardlineCommand("rm -rf ~/.kolo/vault");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-kolo-vault");
  });

  it("blocks rm -rf ~/.kolo/vault/*", () => {
    const r = detectHardlineCommand("rm -rf ~/.kolo/vault/*");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-kolo-vault");
  });

  it("blocks kill via pgrep kolo", () => {
    const r = detectHardlineCommand("kill -9 $(pgrep -f kolo-gateway)");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("kill-kolo-pgrep");
  });

  it("blocks pkill and pgrep kills of the renamed gateway", () => {
    expect(detectHardlineCommand("pkill -9 kurahi")?.pattern).toBe("pkill-kolo");
    expect(detectHardlineCommand("killall kurahi-gateway")?.pattern).toBe("pkill-kolo");
    expect(detectHardlineCommand("kill $(pgrep -f kurahi)")?.pattern).toBe("kill-kolo-pgrep");
  });

  it("blocks pkill kolo", () => {
    const r = detectHardlineCommand("pkill -9 kolo-gateway");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pkill-kolo");
  });

  it("blocks killall kolo", () => {
    const r = detectHardlineCommand("killall kolo-gateway");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pkill-kolo");
  });
});

describe("universal floor redlines", () => {
  it("blocks rm -rf /", () => {
    const r = detectHardlineCommand("rm -rf /");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks rm -rf /*", () => {
    const r = detectHardlineCommand("rm -rf /*");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks rm -rf / *", () => {
    const r = detectHardlineCommand("rm -rf / *");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks rm -rf /home", () => {
    const r = detectHardlineCommand("rm -rf /home");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-system-dir");
  });

  it("blocks rm -rf /etc", () => {
    const r = detectHardlineCommand("rm -rf /etc");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-system-dir");
  });

  it("blocks rm -rf /usr", () => {
    const r = detectHardlineCommand("rm -rf /usr");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-system-dir");
  });

  it("blocks rm -rf ~ (home)", () => {
    const r = detectHardlineCommand("rm -rf ~");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-home");
  });

  it("blocks rm -rf $HOME", () => {
    const r = detectHardlineCommand("rm -rf $HOME");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-home");
  });

  it("blocks mkfs.ext4 /dev/sda1", () => {
    const r = detectHardlineCommand("mkfs.ext4 /dev/sda1");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("mkfs");
  });

  it("blocks mkfs (bare)", () => {
    const r = detectHardlineCommand("mkfs /dev/sdb");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("mkfs");
  });

  it("blocks dd to block device", () => {
    const r = detectHardlineCommand("dd if=/dev/zero of=/dev/sda bs=1M");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("dd-block-device");
  });

  it("blocks redirect to block device", () => {
    const r = detectHardlineCommand("cat img > /dev/sda1");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("redirect-block-device");
  });

  it("blocks fork bomb", () => {
    const r = detectHardlineCommand(":(){ :|:& };:");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("fork-bomb");
  });

  it("blocks fork bomb with whitespace variations", () => {
    const r = detectHardlineCommand(":() { :|: & };:");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("fork-bomb");
  });

  it("blocks kill -1", () => {
    const r = detectHardlineCommand("kill -1");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("kill-all");
  });

  it("blocks kill -9 -1", () => {
    const r = detectHardlineCommand("kill -9 -1");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("kill-all");
  });

  it("blocks shutdown", () => {
    const r = detectHardlineCommand("shutdown now");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("system-shutdown");
  });

  it("blocks sudo shutdown", () => {
    const r = detectHardlineCommand("sudo shutdown -h now");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("system-shutdown");
  });

  it("blocks reboot", () => {
    const r = detectHardlineCommand("reboot");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("system-shutdown");
  });

  it("blocks init 0", () => {
    const r = detectHardlineCommand("init 0");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("init-runlevel");
  });

  it("blocks systemctl poweroff", () => {
    const r = detectHardlineCommand("systemctl poweroff");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("systemctl-shutdown");
  });

  it("blocks sudo systemctl reboot", () => {
    const r = detectHardlineCommand("sudo systemctl reboot");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("systemctl-shutdown");
  });
});

// ── (b) Normalizer evasions ──────────────────────────────────────────────

describe("normalizer: fullwidth character evasion", () => {
  it("blocks fullwidth rm -rf /", () => {
    // ｒｍ －ｒｆ ／ (fullwidth Latin + fullwidth hyphen-minus U+FF0D + fullwidth solidus U+FF0F)
    const r = detectHardlineCommand("ｒｍ －ｒｆ ／");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks fullwidth wsl --shutdown", () => {
    const r = detectHardlineCommand("ｗｓｌ －－ｓｈｕｔｄｏｗｎ");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });

  it("blocks fullwidth pm2 kill", () => {
    const r = detectHardlineCommand("ｐｍ２ ｋｉｌｌ");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("pm2-gateway-kill");
  });

  it("blocks fullwidth shutdown", () => {
    const r = detectHardlineCommand("ｓｈｕｔｄｏｗｎ");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("system-shutdown");
  });

  it("blocks fullwidth mkfs", () => {
    const r = detectHardlineCommand("ｍｋｆｓ．ｅｘｔ４ ／ｄｅｖ／ｓｄａ");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("mkfs");
  });
});

describe("normalizer: ANSI escape evasion", () => {
  it("strips ANSI color codes", () => {
    // \x1b[31m r m \x1b[0m -rf /
    const cmd = "\x1b[31mrm\x1b[0m -rf /";
    const r = detectHardlineCommand(cmd);
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("strips ANSI cursor positioning", () => {
    const cmd = "\x1b[2J\x1b[Hrm -rf /";
    const r = detectHardlineCommand(cmd);
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("strips ANSI codes from wsl --shutdown", () => {
    const cmd = "\x1b[1mwsl\x1b[0m \x1b[33m--shutdown\x1b[0m";
    const r = detectHardlineCommand(cmd);
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });
});

describe("normalizer: shell backslash escape evasion", () => {
  it("blocks r\\m -rf /", () => {
    const r = detectHardlineCommand("r\\m -rf /");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks w\\sl --shutdown", () => {
    const r = detectHardlineCommand("w\\sl --shutdown");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("wsl-shutdown");
  });

  it("blocks shu\\tdown", () => {
    const r = detectHardlineCommand("shu\\tdown");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("system-shutdown");
  });

  it("blocks m\\kfs.ext4", () => {
    const r = detectHardlineCommand("m\\kfs.ext4 /dev/sda");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("mkfs");
  });

  it("blocks empty-string escape r''m -rf /", () => {
    const r = detectHardlineCommand("r''m -rf /");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("handles combined escapes (backslash guards letter, '' strips to empty)", () => {
    // r\\m'' (backslash-escaped r then m, then empty-string between m and space)
    // After normalize: r\m'' → rm'' (backslash stripped) → rm ('' stripped)
    const r = detectHardlineCommand("r\\m'' -rf /");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });
});

describe("normalizer: mixed evasion techniques", () => {
  it("blocks fullwidth + ANSI", () => {
    // U+FF0D = fullwidth hyphen-minus (normalizes to ASCII -)
    const cmd = "\x1b[31mｒｍ\x1b[0m －ｒｆ ／";
    const r = detectHardlineCommand(cmd);
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks backslash + ANSI", () => {
    const cmd = "\x1b[1mr\\m\x1b[0m -rf /";
    const r = detectHardlineCommand(cmd);
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });

  it("blocks fullwidth + backslash", () => {
    // ｒ (fullwidth r), \ｍ (backslash-escaped m), U+FF0D (fullwidth hyphen), U+FF0F (fullwidth /)
    const r = detectHardlineCommand("ｒ\\ｍ －ｒｆ ／");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("rm-rootfs");
  });
});

// ── (c) Legitimate commands pass clean ───────────────────────────────────

describe("legitimate commands pass clean (no false positives)", () => {
  // git operations
  it("passes git status", () => {
    expect(detectHardlineCommand("git status")).toBeNull();
  });

  it("passes git commit", () => {
    expect(detectHardlineCommand("git commit -m 'fix bug'")).toBeNull();
  });

  it("passes git push", () => {
    expect(detectHardlineCommand("git push origin main")).toBeNull();
  });

  it("passes git pull", () => {
    expect(detectHardlineCommand("git pull --rebase")).toBeNull();
  });

  // pm2 status (legitimate — must not match pm2 kill pattern)
  it("passes pm2 status", () => {
    expect(detectHardlineCommand("pm2 status")).toBeNull();
  });

  it("passes pm2 list", () => {
    expect(detectHardlineCommand("pm2 list")).toBeNull();
  });

  it("passes pm2 logs", () => {
    expect(detectHardlineCommand("pm2 logs kolo-gateway")).toBeNull();
  });

  it("passes pm2 restart (non-gateway)", () => {
    expect(detectHardlineCommand("pm2 restart my-app")).toBeNull();
  });

  it("passes pm2 restart daemon", () => {
    expect(detectHardlineCommand("pm2 restart orion-daemon")).toBeNull();
  });

  // ls and file ops
  it("passes ls", () => {
    expect(detectHardlineCommand("ls -la")).toBeNull();
  });

  it("passes ls /home", () => {
    expect(detectHardlineCommand("ls /home")).toBeNull();
  });

  it("passes ls /etc (read-only)", () => {
    expect(detectHardlineCommand("ls /etc")).toBeNull();
  });

  it("passes cat /etc/hosts", () => {
    expect(detectHardlineCommand("cat /etc/hosts")).toBeNull();
  });

  // Safe rm operations on non-system paths
  it("passes rm -rf node_modules", () => {
    expect(detectHardlineCommand("rm -rf node_modules")).toBeNull();
  });

  it("passes rm /tmp/file.txt", () => {
    expect(detectHardlineCommand("rm /tmp/file.txt")).toBeNull();
  });

  it("passes rm -r ./dist", () => {
    expect(detectHardlineCommand("rm -r ./dist")).toBeNull();
  });

  it("passes rm -rf ~/Downloads/old", () => {
    expect(detectHardlineCommand("rm -rf ~/Downloads/old")).toBeNull();
  });

  // Kill / process management (safe)
  it("passes kill with specific PID", () => {
    expect(detectHardlineCommand("kill 12345")).toBeNull();
  });

  it("passes kill -9 with specific PID", () => {
    expect(detectHardlineCommand("kill -9 12345")).toBeNull();
  });

  it("passes pkill non-kolo process", () => {
    expect(detectHardlineCommand("pkill node")).toBeNull();
  });

  // WSL commands (non-destructive)
  it("passes wsl --list", () => {
    expect(detectHardlineCommand("wsl --list")).toBeNull();
  });

  it("passes wsl --status", () => {
    expect(detectHardlineCommand("wsl --status")).toBeNull();
  });

  it("passes wsl -d Ubuntu echo hello", () => {
    expect(detectHardlineCommand("wsl -d Ubuntu echo hello")).toBeNull();
  });

  // systemctl (safe operations)
  it("passes systemctl status", () => {
    expect(detectHardlineCommand("systemctl status kolo-gateway")).toBeNull();
  });

  it("passes systemctl --user restart", () => {
    expect(detectHardlineCommand("systemctl --user restart kolo-sentinel")).toBeNull();
  });

  // echo / string mentions (must not match shutdown/reboot in text)
  it("passes echo containing 'shutdown' in text", () => {
    expect(detectHardlineCommand("echo 'the system shutdown was clean'")).toBeNull();
  });

  it("passes echo containing 'reboot' in text", () => {
    expect(detectHardlineCommand("echo 'please reboot later'")).toBeNull();
  });

  // Commands that mention kurahi in non-kill contexts
  it("passes echo kolo-gateway status", () => {
    expect(detectHardlineCommand("echo 'kolo-gateway is running'")).toBeNull();
  });

  it("passes cat ~/.kolo/config.yaml", () => {
    expect(detectHardlineCommand("cat ~/.kolo/config.yaml")).toBeNull();
  });

  // npm/node
  it("passes npm install", () => {
    expect(detectHardlineCommand("npm install")).toBeNull();
  });

  it("passes npm test", () => {
    expect(detectHardlineCommand("npm test")).toBeNull();
  });

  it("passes npx vitest", () => {
    expect(detectHardlineCommand("npx vitest run")).toBeNull();
  });

  // docker (non-destructive)
  it("passes docker ps", () => {
    expect(detectHardlineCommand("docker ps")).toBeNull();
  });

  it("passes docker compose logs", () => {
    expect(detectHardlineCommand("docker compose logs")).toBeNull();
  });

  // curl
  it("passes curl to localhost", () => {
    expect(detectHardlineCommand("curl http://localhost:18889/health")).toBeNull();
  });

  // scripts / tools
  it("passes sibling-notify script", () => {
    expect(detectHardlineCommand(`~/.kolo/bin/sibling-notify "hello"`)).toBeNull();
  });

  it("passes Kurahi gateway status", () => {
    expect(detectHardlineCommand("kurahi gateway status")).toBeNull();
  });

  it("passes empty string", () => {
    expect(detectHardlineCommand("")).toBeNull();
  });

  it("passes whitespace-only", () => {
    expect(detectHardlineCommand("   ")).toBeNull();
  });
});

// ── Sudo stdin guard ─────────────────────────────────────────────────────

describe("sudo stdin guard", () => {
  it("blocks sudo -S without SUDO_PASSWORD set", () => {
    // SUDO_PASSWORD is not set in test environment
    const r = detectSudoStdin("sudo -S apt-get install vim");
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe("sudo-stdin");
  });

  it("passes sudo without -S", () => {
    const r = detectSudoStdin("sudo apt-get install vim");
    expect(r).toBeNull();
  });

  it("passes normal command", () => {
    const r = detectSudoStdin("apt-get install vim");
    expect(r).toBeNull();
  });
});

// ── detectHardlinePreExec integration ────────────────────────────────────

describe("detectHardlinePreExec (combined entry point)", () => {
  it("returns blocked for hardline match", () => {
    const r = detectHardlinePreExec("rm -rf /");
    expect(r.blocked).toBe(true);
    if (r.blocked) {
      expect(r.hardline).toBe(true);
    }
  });

  it("returns blocked for sudo stdin", () => {
    const r = detectHardlinePreExec("sudo -S rm file");
    expect(r.blocked).toBe(true);
  });

  it("returns unblocked for safe command", () => {
    const r = detectHardlinePreExec("git status");
    expect(r.blocked).toBe(false);
    if (!r.blocked) {
      // Type narrowing — HardlinePass has just {blocked: false}
      expect("hardline" in r).toBe(false);
    }
  });
});

// ── Pattern count sanity check ───────────────────────────────────────────

describe("pattern inventory", () => {
  it("has correct number of KoLo-specific patterns", () => {
    expect(KOLO_HARDLINE.length).toBe(6);
  });

  it("has correct number of universal patterns", () => {
    expect(UNIVERSAL_HARDLINE.length).toBe(11);
  });

  it("all patterns have required fields", () => {
    for (const p of ALL_PATTERNS) {
      expect(p.pattern).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.re).toBeInstanceOf(RegExp);
    }
  });

  it("no duplicate pattern IDs", () => {
    const ids = ALL_PATTERNS.map((p) => p.pattern);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── normalizeForDetection unit tests ─────────────────────────────────────

describe("normalizeForDetection", () => {
  it("strips ANSI codes", () => {
    const result = normalizeForDetection("\x1b[31mhello\x1b[0m");
    expect(result).toBe("hello");
  });

  it("strips null bytes", () => {
    const result = normalizeForDetection("rm\x00 -rf\x00 /");
    expect(result).toBe("rm -rf /");
  });

  it("NFKC-normalizes fullwidth characters", () => {
    // ｒ(U+FF52)→r, ｍ(U+FF4D)→m, －(U+FF0D)→-, ／(U+FF0F)→/
    const result = normalizeForDetection("ｒｍ －ｒｆ ／");
    expect(result).toBe("rm -rf /");
  });

  it("strips shell backslash escapes", () => {
    const result = normalizeForDetection("r\\m");
    expect(result).toBe("rm");
  });

  it("strips empty-string escapes", () => {
    const result = normalizeForDetection("r''m");
    expect(result).toBe("rm");
  });

  it("collapses whitespace", () => {
    const result = normalizeForDetection("rm   -rf    /");
    expect(result).toBe("rm -rf /");
  });

  it("handles empty string", () => {
    const result = normalizeForDetection("");
    expect(result).toBe("");
  });

  it("handles already-clean command", () => {
    const result = normalizeForDetection("echo hello");
    expect(result).toBe("echo hello");
  });
});
