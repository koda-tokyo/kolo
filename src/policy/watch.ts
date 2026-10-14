// Policy hot reload (KoLo 2.0, M13d): the same watcher shape as the M7 config reloader, but on
// the policy directory only. A change to policy.yaml, its signature or owners.json reloads the
// policy (a refused document never replaces the active one); a change to the runtime kill file
// (written by `kolo policy kill|release` from another process) is picked up the same way.
import chokidar from "chokidar";
import type { PolicyEngine } from "./engine.js";

export type PolicyWatcher = { stop: () => Promise<void> };

export function startPolicyWatcher(opts: {
  engine: PolicyEngine;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  debounceMs?: number;
  /** Injected for tests; defaults to chokidar. */
  watch?: typeof chokidar.watch;
}): PolicyWatcher {
  const { engine } = opts;
  const loc = engine.loc;
  const paths = [loc.policyPath, loc.signaturePath, loc.ownersPath, loc.killStatePath];
  const debounceMs = opts.debounceMs ?? 300;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const pending = new Set<string>();

  const apply = () => {
    timer = null;
    if (stopped) {
      return;
    }
    const changed = [...pending];
    pending.clear();
    if (changed.includes(loc.killStatePath)) {
      const state = engine.reloadKillState();
      opts.log.info(
        `policy: kill state reloaded (fleet ${state.fleet ? "stopped" : "running"}, ${Object.keys(state.agents).length} agent(s) stopped)`,
      );
    }
    if (changed.some((p) => p !== loc.killStatePath)) {
      const result = engine.load({ source: "watch" });
      if (result.ok) {
        const status = engine.status();
        opts.log.info(
          status.loaded
            ? `policy: reloaded ${status.name ?? "policy"} (${status.attestation}, ${status.sha256?.slice(0, 12)})`
            : "policy: file removed; the last accepted document stays active",
        );
        for (const warning of result.warnings) {
          opts.log.warn(`policy: ${warning}`);
        }
      } else {
        opts.log.warn(`policy: reload refused, keeping the active document (${result.reason})`);
      }
    }
  };

  const schedule = (file: string) => {
    pending.add(file);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(apply, debounceMs);
    timer.unref?.();
  };

  const watcher = (opts.watch ?? chokidar.watch)(paths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    usePolling: Boolean(process.env.VITEST),
  });
  watcher.on("add", schedule);
  watcher.on("change", schedule);
  watcher.on("unlink", schedule);
  watcher.on("error", (err) => {
    if (!stopped) {
      opts.log.warn(`policy watcher error: ${String(err)}`);
    }
  });

  return {
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close().catch(() => {});
    },
  };
}
