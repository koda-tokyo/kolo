import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeFileStem } from "../infra/file-stem.js";
import { createDefaultCovenant, getCovenantPath, loadCovenant, saveCovenant } from "./service.js";

// Pre-2.0 files were named after the raw id; ':' is invalid on NTFS, so on Windows the only
// legacy file that can exist is the stem-named one (also a lookup candidate).
const legacyFileName = (id: string) =>
  process.platform === "win32" ? `${safeFileStem(id)}.json` : `${id}.json`;

describe("covenant service persistence", () => {
  let home: string;
  let cwd: string;
  const prevHome = process.env.KOLO_HOME;
  const prevCwd = process.cwd();

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-covenant-home-"));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-covenant-cwd-"));
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

  it("writes under <KOLO_HOME>/workspace/covenant, not under cwd", async () => {
    await saveCovenant("alice", createDefaultCovenant("alice"));
    const expected = path.join(home, "workspace", "covenant", "alice.json");
    expect(getCovenantPath("alice")).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.existsSync(path.join(cwd, "workspace"))).toBe(false);
    expect((await loadCovenant("alice"))?.userId).toBe("alice");
  });

  it("reads a pre-2.0 cwd-relative file when nothing exists under KOLO_HOME", async () => {
    const legacyDir = path.join(cwd, "workspace", "covenant");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacy = createDefaultCovenant("agent:ops-bot:main", { userName: "legacy" });
    fs.writeFileSync(
      path.join(legacyDir, legacyFileName("agent:ops-bot:main")),
      JSON.stringify(legacy),
    );
    const loaded = await loadCovenant("agent:ops-bot:main");
    expect(loaded?.userName).toBe("legacy");
    // The fallback is read-only: nothing is copied until the next save.
    expect(fs.existsSync(getCovenantPath("agent:ops-bot:main"))).toBe(false);
  });

  it("returns null when no file exists anywhere", async () => {
    expect(await loadCovenant("nobody")).toBeNull();
  });
});
