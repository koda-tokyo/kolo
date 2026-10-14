import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import { resolveSnapshotLimits, SnapshotStore } from "./store.js";
import { filesAboutToChange, wrapToolWithSnapshots } from "./wrapper.js";

function fakeTool(name: string, body: (params: Record<string, unknown>) => void): AnyAgentTool {
  return {
    name,
    label: name,
    description: "",
    parameters: {} as never,
    execute: vi.fn(async (_id: string, params: Record<string, unknown>) => {
      body(params);
      return { content: [{ type: "text", text: "ok" }] };
    }),
  } as unknown as AnyAgentTool;
}

describe("filesAboutToChange", () => {
  it("reads write/edit paths and apply_patch headers", () => {
    expect(filesAboutToChange("write", { path: "a.ts" }, "/w")).toEqual([
      path.resolve("/w", "a.ts"),
    ]);
    expect(filesAboutToChange("edit", { file_path: "/abs/b.ts" }, "/w")).toEqual([
      path.resolve("/abs/b.ts"),
    ]);
    expect(filesAboutToChange("edit", {}, "/w")).toEqual([]);
    const patch = "*** Begin Patch\n*** Update File: src/x.ts\n*** Add File: y.ts\n*** End Patch";
    expect(filesAboutToChange("apply_patch", { input: patch }, "/w")).toEqual([
      path.resolve("/w", "src/x.ts"),
      path.resolve("/w", "y.ts"),
    ]);
  });
});

describe("wrapToolWithSnapshots", () => {
  let home = "";
  let work = "";
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snapwrap-home-"));
    work = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snapwrap-work-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("records the pre-image before the tool runs so undo brings it back", async () => {
    const target = path.join(work, "a.txt");
    fs.writeFileSync(target, "before");
    const store = new SnapshotStore("agent:alice:main", resolveSnapshotLimits(), home);
    const tool = wrapToolWithSnapshots(
      fakeTool("write", (params) =>
        fs.writeFileSync(path.resolve(work, String(params.path)), String(params.content)),
      ),
      { workspaceDir: work, sessionKey: "agent:alice:main", store },
    );
    const result = await tool.execute(
      "1",
      { path: "a.txt", content: "after" },
      undefined,
      undefined,
    );
    expect(result.content[0]).toEqual({ type: "text", text: "ok" });
    expect(fs.readFileSync(target, "utf8")).toBe("after");
    const index = store.list();
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].tool).toBe("write");
    expect(index.entries[0].files[0].path).toBe(target);
    store.undo();
    expect(fs.readFileSync(target, "utf8")).toBe("before");
  });

  it("is a pass-through for other tools, when disabled, or without a session", () => {
    const read = fakeTool("read", () => undefined);
    expect(wrapToolWithSnapshots(read, { sessionKey: "k" })).toBe(read);
    const write = fakeTool("write", () => undefined);
    expect(wrapToolWithSnapshots(write, {})).toBe(write);
    expect(
      wrapToolWithSnapshots(write, {
        sessionKey: "k",
        config: { snapshots: { enabled: false } } as KoLoConfig,
      }),
    ).toBe(write);
  });

  it("never blocks the edit when the snapshot fails", async () => {
    const broken = {
      record: () => {
        throw new Error("disk full");
      },
    } as unknown as SnapshotStore;
    const tool = wrapToolWithSnapshots(
      fakeTool("edit", () => undefined),
      { workspaceDir: work, sessionKey: "k", store: broken },
    );
    const result = await tool.execute("1", { path: "a.txt" }, undefined, undefined);
    expect(result.content[0]).toEqual({ type: "text", text: "ok" });
  });
});
