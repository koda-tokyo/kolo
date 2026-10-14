import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeFileStem } from "../infra/file-stem.js";
import {
  ensureContinuityState,
  getContinuityPath,
  loadContinuityState,
  saveContinuityState,
} from "./service.js";
import { createEmptyContinuityState } from "./snapshot.js";

// Pre-2.0 files were named after the raw id; ':' is invalid on NTFS, so on Windows the only
// legacy file that can exist is the stem-named one (also a lookup candidate).
const legacyFileName = (id: string) =>
  process.platform === "win32" ? `${safeFileStem(id)}.json` : `${id}.json`;

describe("continuity service persistence", () => {
  let home: string;
  let cwd: string;
  const prevHome = process.env.KOLO_HOME;
  const prevCwd = process.cwd();

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-continuity-home-"));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-continuity-cwd-"));
    process.env.KOLO_HOME = home;
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) {
      delete process.env.KOLO_HOME;
    } else {
      process.env.KOLO_HOME = prevHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writes under <KOLO_HOME>/workspace/continuity, not under cwd", async () => {
    await saveContinuityState("alice", createEmptyContinuityState("alice"));
    const expected = path.join(home, "workspace", "continuity", "alice.json");
    expect(getContinuityPath("alice")).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.existsSync(path.join(cwd, "workspace"))).toBe(false);
    expect(await loadContinuityState("alice")).not.toBeNull();
  });

  it("reads a pre-2.0 cwd-relative file when nothing exists under KOLO_HOME", async () => {
    const legacyDir = path.join(cwd, "workspace", "continuity");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacy = { ...createEmptyContinuityState("agent:ops-bot:main"), marker: "legacy" };
    fs.writeFileSync(
      path.join(legacyDir, legacyFileName("agent:ops-bot:main")),
      JSON.stringify(legacy),
    );
    const loaded = (await loadContinuityState("agent:ops-bot:main")) as { marker?: string } | null;
    expect(loaded?.marker).toBe("legacy");
    expect(fs.existsSync(getContinuityPath("agent:ops-bot:main"))).toBe(false);
  });

  it("ensureContinuityState creates the file under KOLO_HOME", async () => {
    await ensureContinuityState("bob");
    expect(fs.existsSync(path.join(home, "workspace", "continuity", "bob.json"))).toBe(true);
  });
});
