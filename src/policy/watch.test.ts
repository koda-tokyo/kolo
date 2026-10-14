import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addOwner, loadOrCreateOwnerKey, signPolicyFile } from "./attestation.js";
import { PolicyEngine } from "./engine.js";
import { writeKillState } from "./kill.js";
import { resolvePolicyLocations } from "./paths.js";
import { startPolicyWatcher } from "./watch.js";

let home: string;
let loc: ReturnType<typeof resolvePolicyLocations>;
let stop: (() => Promise<void>) | null = null;

async function until(cond: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-policy-watch-"));
  loc = resolvePolicyLocations({ KOLO_HOME: home });
  fs.mkdirSync(loc.dir, { recursive: true });
  fs.mkdirSync(path.dirname(loc.killStatePath), { recursive: true });
});

afterEach(async () => {
  await stop?.();
  stop = null;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("policy hot reload", () => {
  it("reloads a re-signed policy, keeps the active one on a bad signature, and picks up the kill file", async () => {
    const key = loadOrCreateOwnerKey(loc.ownerKeyPath);
    addOwner(loc.ownersPath, { publicKey: key.publicKey });
    fs.writeFileSync(loc.policyPath, "version: 1\nname: one\n");
    signPolicyFile({ policyPath: loc.policyPath, signaturePath: loc.signaturePath, key });
    const engine = new PolicyEngine({ loc, mode: "enforce", audit: false });
    engine.load({ strict: true });
    expect(engine.status().name).toBe("one");

    const logs: string[] = [];
    const watcher = startPolicyWatcher({
      engine,
      debounceMs: 50,
      log: { info: (m) => logs.push(`info ${m}`), warn: (m) => logs.push(`warn ${m}`) },
    });
    stop = watcher.stop;
    // chokidar needs a moment to arm under polling.
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(loc.policyPath, "version: 1\nname: two\n");
    await until(() => logs.some((l) => l.includes("reload refused")), "refused reload");
    expect(engine.status().name).toBe("one");

    signPolicyFile({ policyPath: loc.policyPath, signaturePath: loc.signaturePath, key });
    await until(() => engine.status().name === "two", "reload of the re-signed policy");
    expect(logs.some((l) => l.includes("reloaded two (signed"))).toBe(true);

    writeKillState(loc.killStatePath, {
      version: 1,
      fleet: null,
      agents: { alice: { by: "cli", at: new Date().toISOString() } },
    });
    await until(() => engine.isKilled("alice"), "kill file pickup");
    expect(engine.isKilled("bob")).toBe(false);
  });
});
