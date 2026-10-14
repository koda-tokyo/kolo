import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, startServices } from "../../test/fixtures/plugins/fake-api.js";
import plugin, {
  applyLogRotation,
  createLogRotation,
  planLogRotation,
  realRotationFs,
  resolveRotationConfig,
  type LogFileEntry,
  type RotationFs,
} from "./index.js";

const DAY = 86_400_000;
const cfg = resolveRotationConfig({ maxBytes: 1000, maxAgeDays: 2, keep: 2 });

function memFs(initial: Record<string, LogFileEntry>): RotationFs & { files: Map<string, LogFileEntry>; ops: string[] } {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, { ...v, path: k }]));
  const ops: string[] = [];
  return {
    files,
    ops,
    list: (dir) => [...files.values()].filter((f) => path.dirname(f.path) === dir),
    rename: (from, to) => {
      const entry = files.get(from);
      if (!entry) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, { ...entry, path: to });
      ops.push(`mv ${path.basename(from)} ${path.basename(to)}`);
    },
    remove: (file) => {
      files.delete(file);
      ops.push(`rm ${path.basename(file)}`);
    },
    truncate: (file) => {
      const entry = files.get(file);
      if (entry) entry.size = 0;
      ops.push(`truncate ${path.basename(file)}`);
    },
    gzip: (file) => {
      const entry = files.get(file);
      if (!entry) throw new Error(`missing ${file}`);
      files.delete(file);
      files.set(`${file}.gz`, { ...entry, path: `${file}.gz` });
      ops.push(`gzip ${path.basename(file)}`);
    },
    exists: (file) => files.has(file),
  };
}

describe("planLogRotation", () => {
  const now = 10 * DAY;
  it("rotates oversized live logs, drops old and surplus generations, leaves small logs alone", () => {
    const plan = planLogRotation(
      [
        { path: "/l/gateway.log", size: 5000, mtimeMs: now },
        { path: "/l/gateway.log.1", size: 10, mtimeMs: now - DAY },
        { path: "/l/gateway.log.2.gz", size: 10, mtimeMs: now - DAY },
        { path: "/l/small.log", size: 10, mtimeMs: now },
        { path: "/l/small.log.1", size: 10, mtimeMs: now - 5 * DAY },
        { path: "/l/notes.txt", size: 99_999, mtimeMs: now },
      ],
      now,
      cfg,
    );
    expect(plan.rotate).toEqual(["/l/gateway.log"]);
    // .2 would become .3 (> keep 2) and small.log.1 is 5 days old
    expect(plan.remove.sort()).toEqual(["/l/gateway.log.2.gz", "/l/small.log.1"]);
  });
});

describe("applyLogRotation", () => {
  it("shifts generations, compresses when asked and never touches live files it did not rotate", () => {
    const io = memFs({
      "/l/a.log": { path: "", size: 5000, mtimeMs: 0 },
      "/l/a.log.1": { path: "", size: 1, mtimeMs: 0 },
      "/l/a.log.2": { path: "", size: 1, mtimeMs: 0 },
      "/l/b.log": { path: "", size: 1, mtimeMs: 0 },
    });
    const c = resolveRotationConfig({ maxBytes: 1000, keep: 2, compress: true });
    const plan = planLogRotation(io.list("/l"), 0, c);
    const result = applyLogRotation(plan, c, io);
    expect(result.rotated).toEqual(["/l/a.log"]);
    expect(result.removed).toEqual(["/l/a.log.2"]);
    expect([...io.files.keys()].sort()).toEqual(["/l/a.log.1.gz", "/l/a.log.2", "/l/b.log"]);
    expect(io.ops).toEqual(["rm a.log.2", "mv a.log.1 a.log.2", "mv a.log a.log.1", "gzip a.log.1"]);
  });
  it("truncates in place when keep is 0", () => {
    const io = memFs({ "/l/a.log": { path: "", size: 5000, mtimeMs: 0 } });
    const c = resolveRotationConfig({ maxBytes: 1000, keep: 0 });
    applyLogRotation(planLogRotation(io.list("/l"), 0, c), c, io);
    expect(io.ops).toEqual(["truncate a.log"]);
    expect(io.files.get("/l/a.log")?.size).toBe(0);
  });
});

describe("log-rotation plugin", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const f of fakes.splice(0)) {
      await f.dispose();
      f.cleanup();
    }
  });

  it("rotates the real log dir on its interval and audits the run", async () => {
    vi.useFakeTimers();
    const fake = createFakeApi({ id: "log-rotation", pluginConfig: { intervalMs: 10_000, maxBytes: 1024, keep: 1 } });
    fakes.push(fake);
    const live = path.join(fake.api.paths.logDir, "gateway.log");
    fs.writeFileSync(live, "x".repeat(5000));
    plugin.register(fake.api);
    await startServices(fake);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(fs.existsSync(`${live}.1`)).toBe(true);
    expect(fs.existsSync(live)).toBe(false);
    expect(fake.audits.map((a) => a.action)).toEqual(["log.rotated"]);
    expect(fake.api.signals.get<{ rotated: string[] }>("log_rotation.lastRun")?.rotated).toEqual([live]);
  });

  it("dry run reports without touching files", () => {
    const fake = createFakeApi({ id: "log-rotation", pluginConfig: { maxBytes: 1024, dryRun: true } });
    fakes.push(fake);
    const live = path.join(fake.api.paths.logDir, "x.log");
    fs.writeFileSync(live, "x".repeat(5000));
    const rotation = createLogRotation(fake.api, realRotationFs);
    const summary = rotation.run();
    expect(summary.rotated).toEqual([live]);
    expect(fs.existsSync(live)).toBe(true);
    expect(fake.audits[0]?.action).toBe("log.rotate_dry_run");
  });
});
