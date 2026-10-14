import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSnapshotLimits, snapshotDirName, SnapshotStore } from "./store.js";

describe("SnapshotStore", () => {
  let home = "";
  let work = "";
  let store: SnapshotStore;
  const file = (name: string) => path.join(work, name);
  const read = (name: string) => fs.readFileSync(file(name), "utf8");

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snap-home-"));
    work = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snap-work-"));
    store = new SnapshotStore("agent:alice:main", resolveSnapshotLimits(), home);
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("names the directory after the key with a hash and stores content-addressed objects", () => {
    expect(snapshotDirName("agent:alice:main")).toMatch(/^agent_alice_main-[0-9a-f]{8}$/);
    expect(snapshotDirName("agent:alice:main")).not.toBe(snapshotDirName("agent:alice:ops"));
    fs.writeFileSync(file("a.txt"), "one");
    fs.writeFileSync(file("b.txt"), "one");
    const entry = store.record("write", [file("a.txt"), file("b.txt"), file("new.txt")]);
    expect(entry?.files.map((f) => f.existed)).toEqual([true, true, false]);
    expect(entry?.files[0].hash).toBe(entry?.files[1].hash);
    expect(fs.readdirSync(path.join(store.dir, "objects"))).toHaveLength(1);
    expect(store.dir.startsWith(path.join(home, "snapshots"))).toBe(true);
  });

  it("undo restores pre-images, deletes created files, and redo puts the edit back", () => {
    fs.writeFileSync(file("a.txt"), "v1");
    store.record("edit", [file("a.txt"), file("created.txt")]);
    fs.writeFileSync(file("a.txt"), "v2");
    fs.writeFileSync(file("created.txt"), "new");
    expect(store.list().cursor).toBe(1);

    const undone = store.undo();
    expect(undone?.restored).toEqual([file("a.txt")]);
    expect(undone?.removed).toEqual([file("created.txt")]);
    expect(read("a.txt")).toBe("v1");
    expect(fs.existsSync(file("created.txt"))).toBe(false);
    expect(store.list().cursor).toBe(0);
    expect(store.undo()).toBeNull();

    const redone = store.redo();
    expect(redone?.restored.toSorted()).toEqual([file("a.txt"), file("created.txt")].toSorted());
    expect(read("a.txt")).toBe("v2");
    expect(read("created.txt")).toBe("new");
    expect(store.list().cursor).toBe(1);
    expect(store.redo()).toBeNull();
  });

  it("a new edit after undo discards the redo branch; restoreTo walks back several steps", () => {
    fs.writeFileSync(file("a.txt"), "v1");
    const first = store.record("edit", [file("a.txt")]);
    fs.writeFileSync(file("a.txt"), "v2");
    const second = store.record("edit", [file("a.txt")]);
    fs.writeFileSync(file("a.txt"), "v3");
    store.record("edit", [file("a.txt")]);
    fs.writeFileSync(file("a.txt"), "v4");

    const reports = store.restoreTo(second!.id);
    expect(reports).toHaveLength(2);
    expect(read("a.txt")).toBe("v2");
    expect(store.list().cursor).toBe(1);
    expect(store.restoreTo(second!.id)).toBeNull(); // already undone
    expect(store.restoreTo("nope")).toBeNull();

    store.record("write", [file("a.txt")]);
    fs.writeFileSync(file("a.txt"), "v5");
    const index = store.list();
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0].id).toBe(first!.id);
    expect(index.cursor).toBe(2);
    expect(store.redo()).toBeNull();
    store.undo();
    expect(read("a.txt")).toBe("v2");
  });

  it("bounds count and bytes, skips large files, and survives a corrupt index", () => {
    const small = new SnapshotStore(
      "k",
      { maxPerSession: 2, maxBytesPerSession: 1024 * 1024, maxFileBytes: 8 },
      home,
    );
    fs.writeFileSync(file("big.txt"), "0123456789");
    fs.writeFileSync(file("s.txt"), "a");
    const entry = small.record("write", [file("big.txt"), file("s.txt")]);
    expect(entry?.files[0].skipped).toBe("too-large");
    expect(entry?.files[1].hash).toBeDefined();
    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(file("s.txt"), `v${i}`);
      small.record("write", [file("s.txt")]);
    }
    const index = small.list();
    expect(index.entries).toHaveLength(2);
    expect(index.cursor).toBe(2);
    // Objects of dropped entries are collected.
    const live = new Set(index.entries.flatMap((e) => e.files.map((f) => f.hash)));
    const objects = fs.readdirSync(path.join(small.dir, "objects"));
    expect(objects.every((name) => live.has(name))).toBe(true);
    const undone = small.undo();
    expect(undone?.restored).toEqual([file("s.txt")]);

    fs.writeFileSync(path.join(small.dir, "index.json"), "{not json");
    expect(small.list()).toEqual({ version: 1, sessionKey: "k", cursor: 0, entries: [] });

    const bytes = new SnapshotStore(
      "b",
      { maxPerSession: 100, maxBytesPerSession: 2048, maxFileBytes: 1024 * 1024 },
      home,
    );
    for (let i = 0; i < 5; i += 1) {
      fs.writeFileSync(file("x.txt"), `${i}`.repeat(1000));
      bytes.record("write", [file("x.txt")]);
    }
    expect(bytes.list().entries.length).toBeLessThanOrEqual(2);
  });

  it("returns null when there is nothing to record and clear removes everything", () => {
    expect(store.record("write", [])).toBeNull();
    fs.writeFileSync(file("a.txt"), "v1");
    store.record("write", [file("a.txt")]);
    expect(fs.existsSync(store.dir)).toBe(true);
    store.clear();
    expect(fs.existsSync(store.dir)).toBe(false);
    expect(store.list().entries).toEqual([]);
  });
});
