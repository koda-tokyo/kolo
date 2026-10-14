/**
 * Self-check (KoLo 2.0, M7). Off by default.
 *
 * The generic half of a host guardian: on start and every `intervalMs` it checks
 *   permissions   secrets dir 0700, secret files + config file + integrity key 0600 (autoFix: chmod);
 *                 skipped on Windows, where NTFS ACLs replace POSIX mode bits (stat reports 0666/0777)
 *   config        the config file parses and validates
 *   integrity     the signed integrity registry verifies
 *   ports         listeners bound beyond loopback vs the gateway bind policy + allowPublicPorts
 *   secrets       (only when scanSecrets.dirs is set) token-shaped strings in text files
 * Results go to `<stateDir>/self-check/latest.json` (read by `kolo doctor` and
 * `kolo plugins doctor`), to the audit log (`self_check.run`, plus one `self_check.finding` per
 * new warn/error) and to the `self_check` signal. Nothing is killed, nothing leaves the host.
 */
import fs from "node:fs";
import path from "node:path";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";
import { readConfigFileSnapshot, resolveIntegrityLocations, verifyRegistry } from "KoLo/plugin-sdk";

export type SelfCheckConfig = {
  intervalMs: number;
  runOnStart: boolean;
  autoFix: boolean;
  allowPublicPorts: number[];
  scanSecrets: { dirs: string[]; patterns: RegExp[]; maxFileBytes: number } | null;
};

export const DEFAULT_SECRET_PATTERNS = [
  "sk-[a-zA-Z0-9_-]{30,}",
  "sb_secret_[a-zA-Z0-9]{30,}",
  "ghp_[a-zA-Z0-9]{30,}",
  "xox[baprs]-[a-zA-Z0-9-]{20,}",
  "AKIA[0-9A-Z]{16}",
  "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
];

export function resolveSelfCheckConfig(raw: Record<string, unknown> | undefined): SelfCheckConfig {
  const cfg = raw ?? {};
  const interval = cfg.intervalMs;
  const scan = cfg.scanSecrets && typeof cfg.scanSecrets === "object" ? (cfg.scanSecrets as Record<string, unknown>) : null;
  const dirs = Array.isArray(scan?.dirs) ? (scan!.dirs as unknown[]).filter((d): d is string => typeof d === "string") : [];
  const patterns = Array.isArray(scan?.patterns)
    ? (scan!.patterns as unknown[]).filter((p): p is string => typeof p === "string")
    : DEFAULT_SECRET_PATTERNS;
  const maxFileBytes = typeof scan?.maxFileBytes === "number" ? Math.max(1024, scan!.maxFileBytes as number) : 1_048_576;
  return {
    intervalMs: typeof interval === "number" && Number.isFinite(interval) ? Math.max(30_000, Math.floor(interval)) : 600_000,
    runOnStart: cfg.runOnStart !== false,
    autoFix: cfg.autoFix === true,
    allowPublicPorts: Array.isArray(cfg.allowPublicPorts)
      ? (cfg.allowPublicPorts as unknown[]).filter((p): p is number => typeof p === "number")
      : [],
    scanSecrets: dirs.length > 0 ? { dirs, patterns: patterns.map((p) => new RegExp(p)), maxFileBytes } : null,
  };
}

export type Finding = { check: string; level: "info" | "warn" | "error"; message: string };
export type CheckState = "pass" | "warn" | "fail" | "skip";
export type SelfCheckReport = {
  ranAt: string;
  ok: boolean;
  checks: Record<string, CheckState>;
  findings: Finding[];
};

// ── permissions ───────────────────────────────────────────────────────────────────────────────

export type PermEntry = { path: string; mode: number; isDir: boolean; exists: boolean };
export type PermFs = {
  stat: (p: string) => PermEntry;
  list: (dir: string) => string[];
  chmod: (p: string, mode: number) => void;
};

export const realPermFs: PermFs = {
  stat: (p) => {
    try {
      const s = fs.statSync(p);
      return { path: p, mode: s.mode & 0o777, isDir: s.isDirectory(), exists: true };
    } catch {
      return { path: p, mode: 0, isDir: false, exists: false };
    }
  },
  list: (dir) => {
    try {
      return fs.readdirSync(dir).map((n) => path.join(dir, n));
    } catch {
      return [];
    }
  },
  chmod: (p, mode) => fs.chmodSync(p, mode),
};

/** Pure-ish: expected modes for the secret-bearing paths; group/other bits must be clear. */
export function checkPermissions(
  paths: { secretsDir: string; configPath: string; extraFiles?: string[] },
  io: PermFs,
  autoFix: boolean,
): Finding[] {
  const findings: Finding[] = [];
  const want: Array<{ path: string; mode: number; dir: boolean }> = [];
  const secrets = io.stat(paths.secretsDir);
  if (secrets.exists) {
    want.push({ path: paths.secretsDir, mode: 0o700, dir: true });
    for (const file of io.list(paths.secretsDir)) {
      const s = io.stat(file);
      if (s.exists) {
        want.push({ path: file, mode: s.isDir ? 0o700 : 0o600, dir: s.isDir });
      }
    }
  }
  if (io.stat(paths.configPath).exists) {
    want.push({ path: paths.configPath, mode: 0o600, dir: false });
  }
  for (const extra of paths.extraFiles ?? []) {
    if (io.stat(extra).exists) {
      want.push({ path: extra, mode: 0o600, dir: false });
    }
  }
  for (const entry of want) {
    const actual = io.stat(entry.path).mode;
    if ((actual & 0o077) === 0) {
      continue; // group/other closed: good enough regardless of owner bits
    }
    if (autoFix) {
      try {
        io.chmod(entry.path, entry.mode);
        findings.push({
          check: "permissions",
          level: "warn",
          message: `${entry.path} was ${actual.toString(8)}, fixed to ${entry.mode.toString(8)}`,
        });
        continue;
      } catch (err) {
        findings.push({ check: "permissions", level: "error", message: `${entry.path} is ${actual.toString(8)} and chmod failed: ${String(err)}` });
        continue;
      }
    }
    findings.push({
      check: "permissions",
      level: "error",
      message: `${entry.path} is mode ${actual.toString(8)}; expected ${entry.mode.toString(8)} (set autoFix to repair)`,
    });
  }
  return findings;
}

// ── ports vs bind policy ──────────────────────────────────────────────────────────────────────

export type Listener = { port: number; addr: string; v6: boolean };

/** Parses /proc/net/tcp{,6} content: LISTEN sockets (state 0A) → port + address. */
export function parseProcNetTcp(content: string, v6: boolean): Listener[] {
  const out: Listener[] = [];
  for (const line of content.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[3] !== "0A") {
      continue;
    }
    const [addrHex, portHex] = cols[1]!.split(":");
    if (!addrHex || !portHex) {
      continue;
    }
    out.push({ port: Number.parseInt(portHex, 16), addr: addrHex.toLowerCase(), v6 });
  }
  return out;
}

export function isLoopbackListener(l: Listener): boolean {
  if (l.v6) {
    // ::1 → 00000000000000000000000001000000 (little-endian words); v4-mapped 127.x → ...0000017F
    return l.addr === "00000000000000000000000001000000" || l.addr.endsWith("0000017f");
  }
  return l.addr.endsWith("7f"); // 0100007F = 127.0.0.1 (little-endian)
}

export function isAnyListener(l: Listener): boolean {
  return /^0+$/.test(l.addr);
}

export function checkPorts(
  listeners: Listener[],
  policy: { gatewayPort: number; bind: string; allowPublicPorts: number[] },
): Finding[] {
  const findings: Finding[] = [];
  const publicPorts = new Map<number, Listener>();
  for (const l of listeners) {
    if (!isLoopbackListener(l)) {
      publicPorts.set(l.port, l);
    }
  }
  const gatewayPublicAllowed = policy.bind !== "loopback";
  for (const [port, l] of publicPorts) {
    const where = isAnyListener(l) ? "all interfaces" : "a non-loopback address";
    if (port === policy.gatewayPort) {
      if (!gatewayPublicAllowed) {
        findings.push({
          check: "ports",
          level: "error",
          message: `gateway port ${port} listens on ${where} but gateway.bind is "loopback"`,
        });
      }
      continue;
    }
    if (policy.allowPublicPorts.includes(port)) {
      continue;
    }
    findings.push({ check: "ports", level: "warn", message: `port ${port} listens on ${where} (not in allowPublicPorts)` });
  }
  return findings;
}

export function readListeners(): Listener[] | null {
  try {
    const v4 = fs.readFileSync("/proc/net/tcp", "utf-8");
    let v6 = "";
    try {
      v6 = fs.readFileSync("/proc/net/tcp6", "utf-8");
    } catch {
      v6 = "";
    }
    return [...parseProcNetTcp(v4, false), ...parseProcNetTcp(v6, true)];
  } catch {
    return null;
  }
}

// ── secret scan ───────────────────────────────────────────────────────────────────────────────

export function scanForSecrets(
  dirs: string[],
  patterns: RegExp[],
  maxFileBytes: number,
  io: { list: (dir: string) => Array<{ path: string; size: number; isDir: boolean }>; read: (p: string) => string },
): Finding[] {
  const findings: Finding[] = [];
  const queue = [...dirs];
  let visited = 0;
  while (queue.length > 0 && visited < 5000) {
    const dir = queue.shift()!;
    for (const entry of io.list(dir)) {
      visited += 1;
      if (entry.isDir) {
        if (!entry.path.includes("node_modules") && !entry.path.includes(`${path.sep}.git`)) {
          queue.push(entry.path);
        }
        continue;
      }
      if (entry.size > maxFileBytes) {
        continue;
      }
      let text: string;
      try {
        text = io.read(entry.path);
      } catch {
        continue;
      }
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          // Only the file and the pattern are reported; never the matched value.
          findings.push({ check: "secrets", level: "error", message: `${entry.path} matches ${pattern.source}` });
          break;
        }
      }
    }
  }
  return findings;
}

// ── runner ────────────────────────────────────────────────────────────────────────────────────

export type SelfCheckDeps = {
  permFs: PermFs;
  listeners: () => Listener[] | null;
  configSnapshot: () => Promise<{ valid: boolean; exists: boolean; issues: Array<{ path: string; message: string }> }>;
  integrity: () => { ok: boolean; summary: string; present: boolean };
  scanIo: Parameters<typeof scanForSecrets>[3];
  now: () => Date;
  platform: NodeJS.Platform;
};

export const realDeps: SelfCheckDeps = {
  permFs: realPermFs,
  listeners: readListeners,
  configSnapshot: async () => {
    const snap = await readConfigFileSnapshot();
    return { valid: snap.valid, exists: snap.exists, issues: snap.issues };
  },
  integrity: () => {
    const loc = resolveIntegrityLocations();
    if (!fs.existsSync(loc.registryPath)) {
      return { ok: true, summary: "no integrity registry (kolo integrity init to enable)", present: false };
    }
    const result = verifyRegistry(loc);
    const problems = (result as { problems?: Array<{ path?: string; kind?: string }> }).problems ?? [];
    return {
      ok: (result as { ok?: boolean }).ok !== false && problems.length === 0,
      summary: problems.length ? problems.map((p) => `${p.kind ?? "problem"}: ${p.path ?? ""}`).join("; ") : "registry verified",
      present: true,
    };
  },
  scanIo: {
    list: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
          const p = path.join(dir, d.name);
          let size = 0;
          if (!d.isDirectory()) {
            try {
              size = fs.statSync(p).size;
            } catch {
              size = 0;
            }
          }
          return { path: p, size, isDir: d.isDirectory() };
        });
      } catch {
        return [];
      }
    },
    read: (p) => fs.readFileSync(p, "utf-8"),
  },
  now: () => new Date(),
  platform: process.platform,
};

export function createSelfCheck(api: KoLoPluginApi, deps: Partial<SelfCheckDeps> = {}) {
  const cfg = resolveSelfCheckConfig(api.pluginConfig);
  const d: SelfCheckDeps = { ...realDeps, ...deps };
  const reportFile = path.join(api.paths.stateDir, "self-check", "latest.json");
  let previous = new Set<string>();

  const run = async (): Promise<SelfCheckReport> => {
    const findings: Finding[] = [];
    const checks: Record<string, CheckState> = {};
    const settle = (name: string, list: Finding[]) => {
      checks[name] = list.some((f) => f.level === "error") ? "fail" : list.some((f) => f.level === "warn") ? "warn" : "pass";
      findings.push(...list);
    };

    if (d.platform === "win32") {
      // NTFS has no POSIX mode bits: stat reports 0666/0777 for everything and chmod is a no-op,
      // so the check would fail every Windows install. Access there is governed by ACLs.
      checks.permissions = "skip";
      findings.push({ check: "permissions", level: "info", message: "POSIX mode bits not applicable on Windows (NTFS ACLs)" });
    } else {
      settle(
        "permissions",
        checkPermissions(
          {
            secretsDir: api.paths.secretsDir,
            configPath: api.paths.configPath,
            extraFiles: [path.join(api.paths.secretsDir, "integrity.key")],
          },
          d.permFs,
          cfg.autoFix,
        ),
      );
    }

    try {
      const snap = await d.configSnapshot();
      settle(
        "config",
        !snap.exists
          ? [{ check: "config", level: "warn", message: "no config file" }]
          : snap.valid
            ? []
            : snap.issues.map((i) => ({ check: "config", level: "error" as const, message: `${i.path}: ${i.message}` })),
      );
    } catch (err) {
      settle("config", [{ check: "config", level: "error", message: `config read failed: ${String(err)}` }]);
    }

    try {
      const integrity = d.integrity();
      if (!integrity.present) {
        checks.integrity = "skip";
        findings.push({ check: "integrity", level: "info", message: integrity.summary });
      } else {
        settle("integrity", integrity.ok ? [] : [{ check: "integrity", level: "error", message: integrity.summary }]);
      }
    } catch (err) {
      settle("integrity", [{ check: "integrity", level: "error", message: `verify failed: ${String(err)}` }]);
    }

    const listeners = d.listeners();
    if (listeners === null) {
      checks.ports = "skip";
      findings.push({ check: "ports", level: "info", message: "listener table not readable on this platform" });
    } else {
      settle(
        "ports",
        checkPorts(listeners, {
          gatewayPort: api.config.gateway?.port ?? 18789,
          bind: api.config.gateway?.bind ?? "loopback",
          allowPublicPorts: cfg.allowPublicPorts,
        }),
      );
    }

    if (cfg.scanSecrets) {
      settle(
        "secrets",
        scanForSecrets(
          cfg.scanSecrets.dirs.map((x) => api.resolvePath(x)),
          cfg.scanSecrets.patterns,
          cfg.scanSecrets.maxFileBytes,
          d.scanIo,
        ),
      );
    } else {
      checks.secrets = "skip";
    }

    const report: SelfCheckReport = {
      ranAt: d.now().toISOString(),
      ok: !findings.some((f) => f.level !== "info"),
      checks,
      findings,
    };

    try {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      api.logger.warn(`[self-check] could not write ${reportFile}: ${String(err)}`);
    }

    api.signals.set("self_check", { ok: report.ok, ranAt: report.ranAt, checks });
    api.audit({
      action: "self_check.run",
      outcome: report.ok ? "ok" : "failed",
      detail: { checks, findings: findings.filter((f) => f.level !== "info").length },
    });
    const current = new Set<string>();
    for (const f of findings) {
      if (f.level === "info") {
        continue;
      }
      const key = `${f.check}|${f.message}`;
      current.add(key);
      if (!previous.has(key)) {
        api.audit({ action: "self_check.finding", outcome: f.level === "error" ? "failed" : "ok", detail: f });
        (f.level === "error" ? api.logger.error : api.logger.warn)(`[self-check] ${f.check}: ${f.message}`);
      }
    }
    previous = current;
    return report;
  };

  return { cfg, run, reportFile };
}

const selfCheckPlugin = {
  id: "self-check",
  name: "Self-check",
  description: "Secrets permissions, config validity, integrity registry, open ports vs bind policy",
  register(api: KoLoPluginApi) {
    const check = createSelfCheck(api);
    api.registerService({
      id: "self-check",
      start: () => {
        if (check.cfg.runOnStart) {
          api.lifecycle.setTimeout(() => void check.run(), 1_000);
        }
        api.lifecycle.setInterval(() => void check.run(), check.cfg.intervalMs);
      },
    });
  },
};

export default selfCheckPlugin;
