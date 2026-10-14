// Runtime kill switch state (KoLo 2.0, M13c). The policy document can stop agents
// declaratively (`kill.fleet`, `kill.agents`); this file holds the switch an owner or admin
// flips at runtime (`kolo policy kill`, `policy.kill`, POST /api/policy/kill). It is written
// synchronously so the effect survives a restart, and read by the engine on load.
import fs from "node:fs";
import path from "node:path";

export type KillMark = { by: string; at: string; reason?: string };

export type KillState = {
  version: 1;
  fleet: KillMark | null;
  agents: Record<string, KillMark>;
};

export function emptyKillState(): KillState {
  return { version: 1, fleet: null, agents: {} };
}

export function readKillState(file: string): KillState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as KillState;
    if (parsed?.version !== 1) {
      return emptyKillState();
    }
    return { version: 1, fleet: parsed.fleet ?? null, agents: parsed.agents ?? {} };
  } catch {
    return emptyKillState();
  }
}

export function writeKillState(file: string, state: KillState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
