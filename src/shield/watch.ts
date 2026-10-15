// Ransomware shield watcher (Kurahi 2.0, M17a): watches the runtime's state directory, every
// agent workspace and any extra folders named in the policy; plants a decoy file in each; samples
// the entropy of changed files and feeds the detector. On a trigger it calls `onTrigger` once and
// then stays quiet for a cool-down, so one incident is one alert and one fleet stop.
import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import {
  type ShieldEvent,
  ShieldDetector,
  type ShieldThresholds,
  type ShieldTrigger,
  shannonEntropy,
} from "./detect.js";

export const CANARY_NAME = "_kurahi_canary.txt";
export const CANARY_TEXT =
  "Kurahi ransomware shield decoy. Do not edit, move or delete this file.\n" +
  "Any change to it stops every agent and is written to the audit log.\n";

const SAMPLE_BYTES = 64 * 1024;
const COOLDOWN_MS = 60_000;

/** Directories with constant legitimate churn or no user data. */
export const SHIELD_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".pnpm-store",
  // runtime churn under KOLO_HOME
  "run",
  "logs",
  "evidence",
  "snapshots",
  "media",
  "tmp",
  "cache",
  "sandboxes",
  "backups",
  "browser",
]);

export type ShieldWatcher = {
  roots: string[];
  canaries: string[];
  stop: () => Promise<void>;
  /** Resolves once the initial scan is done (tests). */
  ready: Promise<void>;
};

export type StartShieldOptions = {
  roots: string[];
  canaries?: boolean;
  thresholds?: Partial<ShieldThresholds>;
  onTrigger: (trigger: ShieldTrigger) => void;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  now?: () => number;
};

function sample(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(SAMPLE_BYTES);
    const n = fs.readSync(fd, buf, 0, SAMPLE_BYTES, 0);
    return n < 256 ? null : shannonEntropy(buf.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/** Drop roots that do not exist and roots nested inside another root. */
export function normalizeRoots(roots: string[]): string[] {
  const abs = [...new Set(roots.map((r) => path.resolve(r)))].filter((r) => {
    try {
      return fs.statSync(r).isDirectory();
    } catch {
      return false;
    }
  });
  return abs
    .toSorted((a, b) => a.length - b.length)
    .filter((r, i, all) => !all.slice(0, i).some((p) => r === p || r.startsWith(p + path.sep)));
}

function plantCanary(root: string): string | null {
  const file = path.join(root, CANARY_NAME);
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, CANARY_TEXT, { mode: 0o644 });
    }
    // Keep the decoy out of commits when the folder is a git repository (local exclude only).
    const exclude = path.join(root, ".git", "info", "exclude");
    if (fs.existsSync(path.dirname(exclude))) {
      const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
      if (!current.split(/\r?\n/).includes(CANARY_NAME)) {
        fs.appendFileSync(
          exclude,
          `${current && !current.endsWith("\n") ? "\n" : ""}${CANARY_NAME}\n`,
        );
      }
    }
    return file;
  } catch {
    return null;
  }
}

export function startShieldWatcher(opts: StartShieldOptions): ShieldWatcher {
  const now = opts.now ?? Date.now;
  const roots = normalizeRoots(opts.roots);
  const detector = new ShieldDetector(opts.thresholds);
  const canaries =
    opts.canaries === false ? [] : roots.map(plantCanary).filter((c): c is string => Boolean(c));
  const canarySet = new Set(canaries);
  const entropyCache = new Map<string, number>();
  let quietUntil = 0;

  const fire = (trigger: ShieldTrigger | null) => {
    if (!trigger || now() < quietUntil) {
      return;
    }
    quietUntil = now() + COOLDOWN_MS;
    try {
      opts.onTrigger(trigger);
    } catch (err) {
      opts.log?.warn(`shield: trigger handler failed: ${String(err)}`);
    }
  };

  // A canary that no longer holds the decoy text at start-up is already an incident.
  for (const c of canaries) {
    try {
      if (fs.readFileSync(c, "utf8") !== CANARY_TEXT) {
        fire(detector.observe({ kind: "canary", path: c, what: "changed" }, now()));
      }
    } catch {
      // unreadable right after planting: ignore
    }
  }

  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    ignored: (p: string) => SHIELD_IGNORED_DIRS.has(path.basename(p)),
    awaitWriteFinish: false,
  });

  const feed = (event: ShieldEvent) => fire(detector.observe(event, now()));

  watcher.on("add", (file: string) => {
    const e = sample(file);
    if (e !== null) {
      entropyCache.set(file, e);
    }
    feed({ kind: "add", path: file, entropy: e ?? 0 });
  });
  watcher.on("change", (file: string) => {
    if (canarySet.has(file)) {
      let same = false;
      try {
        same = fs.readFileSync(file, "utf8") === CANARY_TEXT;
      } catch {
        same = false;
      }
      if (!same) {
        feed({ kind: "canary", path: file, what: "changed" });
      }
      return;
    }
    const e = sample(file);
    if (e === null) {
      return;
    }
    const previousEntropy = entropyCache.get(file);
    entropyCache.set(file, e);
    feed({ kind: "change", path: file, entropy: e, previousEntropy });
  });
  watcher.on("unlink", (file: string) => {
    entropyCache.delete(file);
    if (canarySet.has(file)) {
      feed({ kind: "canary", path: file, what: "deleted" });
      return;
    }
    feed({ kind: "unlink", path: file });
  });
  watcher.on("error", (err: unknown) => opts.log?.warn(`shield: watcher error: ${String(err)}`));

  const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  opts.log?.info(
    `shield: watching ${roots.length} folder(s)${canaries.length ? `, ${canaries.length} decoy file(s)` : ""}`,
  );
  return {
    roots,
    canaries,
    ready,
    stop: async () => {
      await watcher.close();
    },
  };
}
