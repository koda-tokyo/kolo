/**
 * Log rotation (KoLo 2.0, M7). Off by default.
 *
 * Every `intervalMs` the state-root log directory (plus `dirs`) is scanned. A live log over
 * `maxBytes` is rotated to `<name>.1` (older generations shift up, at most `keep` are kept,
 * optionally gzip-compressed in process; no shell, no child process). Rotated generations older
 * than `maxAgeDays` are deleted. Every run that changed something is audited (`log.rotated`).
 * Live logs are never deleted; only rotated generations are.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

export type RotationConfig = {
  intervalMs: number;
  maxBytes: number;
  maxAgeDays: number;
  keep: number;
  compress: boolean;
  dirs: string[];
  extensions: string[];
  dryRun: boolean;
};

export function resolveRotationConfig(raw: Record<string, unknown> | undefined): RotationConfig {
  const cfg = raw ?? {};
  const int = (key: string, fallback: number, min: number) => {
    const v = cfg[key];
    return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
  };
  const list = (key: string, fallback: string[]) =>
    Array.isArray(cfg[key])
      ? (cfg[key] as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : fallback;
  return {
    intervalMs: int("intervalMs", 600_000, 10_000),
    maxBytes: int("maxBytes", 50 * 1024 * 1024, 1024),
    maxAgeDays: int("maxAgeDays", 14, 1),
    keep: int("keep", 3, 0),
    compress: cfg.compress === true,
    dirs: list("dirs", []),
    extensions: list("extensions", [".log"]),
    dryRun: cfg.dryRun === true,
  };
}

export type LogFileEntry = { path: string; size: number; mtimeMs: number };

const ROTATED = /^(?<base>.+)\.(?<gen>\d+)(?<gz>\.gz)?$/;

/** Splits a directory listing into live logs and rotated generations (by base name). */
export function classifyLogs(
  entries: LogFileEntry[],
  extensions: string[],
): { live: LogFileEntry[]; rotated: Map<string, Array<LogFileEntry & { gen: number; gz: boolean }>> } {
  const live: LogFileEntry[] = [];
  const rotated = new Map<string, Array<LogFileEntry & { gen: number; gz: boolean }>>();
  for (const entry of entries) {
    const name = path.basename(entry.path);
    const m = ROTATED.exec(name);
    if (m?.groups && extensions.some((ext) => m.groups!.base.endsWith(ext))) {
      // Slice rather than re-join: keeps the base key byte-identical to the live file's path
      // whatever separator form the entries use (path.join would re-normalise on Windows).
      const base = entry.path.slice(0, entry.path.length - (name.length - m.groups.base.length));
      const list = rotated.get(base) ?? [];
      list.push({ ...entry, gen: Number(m.groups.gen), gz: Boolean(m.groups.gz) });
      rotated.set(base, list);
      continue;
    }
    if (extensions.some((ext) => name.endsWith(ext))) {
      live.push(entry);
    }
  }
  return { live, rotated };
}

export type RotationPlan = {
  /** Live logs to rotate (over maxBytes). */
  rotate: string[];
  /** Rotated generations to delete (too old, or beyond `keep` after the shift). */
  remove: string[];
};

/** Pure: listing + clock → what to do. */
export function planLogRotation(entries: LogFileEntry[], now: number, cfg: RotationConfig): RotationPlan {
  const { live, rotated } = classifyLogs(entries, cfg.extensions);
  const maxAgeMs = cfg.maxAgeDays * 86_400_000;
  const remove = new Set<string>();
  const rotate: string[] = [];
  for (const [, gens] of rotated) {
    for (const gen of gens) {
      if (now - gen.mtimeMs > maxAgeMs) {
        remove.add(gen.path);
      }
    }
  }
  for (const entry of live) {
    if (entry.size <= cfg.maxBytes) {
      continue;
    }
    rotate.push(entry.path);
    // After the shift generation N becomes N+1; anything that would exceed `keep` goes.
    const gens = (rotated.get(entry.path) ?? []).filter((g) => !remove.has(g.path));
    for (const gen of gens) {
      if (gen.gen + 1 > cfg.keep) {
        remove.add(gen.path);
      }
    }
    if (cfg.keep === 0) {
      // Nothing is kept: the live file is truncated instead of shifted.
    }
  }
  return { rotate, remove: [...remove] };
}

export type RotationFs = {
  list: (dir: string) => LogFileEntry[];
  rename: (from: string, to: string) => void;
  remove: (file: string) => void;
  truncate: (file: string) => void;
  gzip: (file: string) => void;
  exists: (file: string) => boolean;
};

export const realRotationFs: RotationFs = {
  list: (dir) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: LogFileEntry[] = [];
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile()) {
          out.push({ path: file, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // vanished between readdir and stat
      }
    }
    return out;
  },
  rename: (from, to) => fs.renameSync(from, to),
  remove: (file) => fs.rmSync(file, { force: true }),
  truncate: (file) => fs.truncateSync(file, 0),
  gzip: (file) => {
    const data = fs.readFileSync(file);
    fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data));
    fs.rmSync(file, { force: true });
  },
  exists: (file) => fs.existsSync(file),
};

/** Applies a plan: shift generations up, move the live file to .1, compress, delete. */
export function applyLogRotation(plan: RotationPlan, cfg: RotationConfig, io: RotationFs): {
  rotated: string[];
  removed: string[];
} {
  const removed: string[] = [];
  for (const file of plan.remove) {
    io.remove(file);
    removed.push(file);
  }
  const rotated: string[] = [];
  for (const live of plan.rotate) {
    if (cfg.keep === 0) {
      io.truncate(live);
      rotated.push(live);
      continue;
    }
    for (let gen = cfg.keep - 1; gen >= 1; gen -= 1) {
      for (const suffix of [".gz", ""]) {
        const from = `${live}.${gen}${suffix}`;
        if (io.exists(from)) {
          io.rename(from, `${live}.${gen + 1}${suffix}`);
        }
      }
    }
    io.rename(live, `${live}.1`);
    if (cfg.compress) {
      io.gzip(`${live}.1`);
    }
    rotated.push(live);
  }
  return { rotated, removed };
}

export function createLogRotation(api: KoLoPluginApi, io: RotationFs = realRotationFs, now: () => number = Date.now) {
  const cfg = resolveRotationConfig(api.pluginConfig);
  const dirs = () => {
    const set = new Set<string>([api.paths.logDir, ...cfg.dirs.map((d) => api.resolvePath(d))]);
    return [...set];
  };
  const run = () => {
    const summary = { rotated: [] as string[], removed: [] as string[], dirs: 0 };
    for (const dir of dirs()) {
      summary.dirs += 1;
      const plan = planLogRotation(io.list(dir), now(), cfg);
      if (plan.rotate.length === 0 && plan.remove.length === 0) {
        continue;
      }
      if (cfg.dryRun) {
        summary.rotated.push(...plan.rotate);
        summary.removed.push(...plan.remove);
        continue;
      }
      try {
        const applied = applyLogRotation(plan, cfg, io);
        summary.rotated.push(...applied.rotated);
        summary.removed.push(...applied.removed);
      } catch (err) {
        api.logger.warn(`[log-rotation] ${dir}: ${String(err)}`);
        api.audit({ action: "log.rotate", outcome: "failed", detail: { dir, error: String(err) } });
      }
    }
    if (summary.rotated.length > 0 || summary.removed.length > 0) {
      api.logger.info(
        `[log-rotation] ${cfg.dryRun ? "would rotate" : "rotated"} ${summary.rotated.length}, ${cfg.dryRun ? "would remove" : "removed"} ${summary.removed.length}`,
      );
      api.audit({
        action: cfg.dryRun ? "log.rotate_dry_run" : "log.rotated",
        detail: { rotated: summary.rotated, removed: summary.removed },
      });
    }
    api.signals.set("log_rotation.lastRun", { at: now(), ...summary });
    return summary;
  };
  return { cfg, run };
}

const logRotationPlugin = {
  id: "log-rotation",
  name: "Log Rotation",
  description: "Size and age caps for the state-root logs",
  register(api: KoLoPluginApi) {
    const rotation = createLogRotation(api);
    api.registerService({
      id: "log-rotation",
      start: () => {
        api.lifecycle.setInterval(() => rotation.run(), rotation.cfg.intervalMs);
        api.logger.info(
          `[log-rotation] every ${Math.round(rotation.cfg.intervalMs / 1000)} s: >${Math.round(rotation.cfg.maxBytes / 1048576)} MB rotates, keep ${rotation.cfg.keep}, max age ${rotation.cfg.maxAgeDays} d${rotation.cfg.dryRun ? " (dry run)" : ""}`,
        );
      },
    });
  },
};

export default logRotationPlugin;
