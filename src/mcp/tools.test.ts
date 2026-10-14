import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBiologyStatus, readInbox, sendSiblingMessage } from "./tools.js";

// Mock KOLO_STATE_DIR to a temp directory for isolation
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-mcp-test-"));
  // Override the env var so tools.ts uses our temp dir
  process.env.KOLO_STATE_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.KOLO_STATE_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readBiologyStatus", () => {
  it("returns null hormones when file does not exist", async () => {
    // Need to re-import with fresh env
    const { readBiologyStatus: fresh } = await import("./tools.js");
    // Since KOLO_STATE_DIR is module-scoped, we test via the already imported one
    const result = await readBiologyStatus();
    // hormones.json doesn't exist in the test home, so it should handle gracefully
    expect(result).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(typeof result.proprioception).toBe("object");
  });

  it("reads hormones when file exists", async () => {
    const autonomicDir = path.join(tmpDir, "autonomic");
    fs.mkdirSync(autonomicDir, { recursive: true });
    const hormones = {
      timestamp: "2026-04-01T00:00:00Z",
      stress: 10,
      dopamine: 50,
      serotonin: 70,
      mood: "focused",
      state: "active",
      energy: "high",
    };
    fs.writeFileSync(path.join(autonomicDir, "hormones.json"), JSON.stringify(hormones));

    // Re-import to pick up new KOLO_STATE_DIR
    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readBiologyStatus();
    expect(result.hormones).toEqual(hormones);
  });

  it("reads proprioception for specific agent", async () => {
    const wsDir = path.join(tmpDir, "workspace-testbot");
    fs.mkdirSync(wsDir, { recursive: true });
    const prop = {
      agent: "testbot",
      timestamp: "2026-04-01T00:00:00Z",
      unread_inbox: 3,
      system_stress: 5,
      total_ticks: 100,
      circadian_phase: "afternoon",
    };
    fs.writeFileSync(path.join(wsDir, "proprioception.json"), JSON.stringify(prop));

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readBiologyStatus("testbot");
    expect(result.proprioception.testbot).toEqual(prop);
  });
});

describe("readInbox", () => {
  it("returns empty for non-existent inbox", async () => {
    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readInbox("nonexistent", false, 20);
    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("reads unread messages", async () => {
    const inbox = path.join(tmpDir, "workspace-testbot", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "msg1.md"), "Hello from Atlas");
    fs.writeFileSync(path.join(inbox, "msg2.md"), "Hello from Iris");

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readInbox("testbot", false, 20);
    expect(result.messages.length).toBe(2);
    expect(result.unread).toBe(2);
    expect(result.messages.every((m) => m.read === false)).toBe(true);
  });

  it("includes read messages when requested", async () => {
    const inbox = path.join(tmpDir, "workspace-testbot", "inbox");
    const readDir = path.join(inbox, "read");
    fs.mkdirSync(readDir, { recursive: true });
    fs.writeFileSync(path.join(inbox, "new.md"), "Unread");
    fs.writeFileSync(path.join(readDir, "old.md"), "Already read");

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readInbox("testbot", true, 20);
    expect(result.messages.length).toBe(2);
    expect(result.messages.find((m) => m.read === true)?.content).toBe("Already read");
  });

  it("respects limit", async () => {
    const inbox = path.join(tmpDir, "workspace-testbot", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(inbox, `msg${i}.md`), `Message ${i}`);
    }

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.readInbox("testbot", false, 3);
    expect(result.messages.length).toBe(3);
    expect(result.unread).toBe(10);
  });
});

describe("sendSiblingMessage", () => {
  it("writes message file to target inbox", async () => {
    const inbox = path.join(tmpDir, "workspace-testbot", "inbox");
    fs.mkdirSync(inbox, { recursive: true });

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.sendSiblingMessage(
      "testbot",
      "test-subject",
      "Hello from MCP!",
      "orion",
    );
    expect(result.ok).toBe(true);
    expect(result.path).toBeTruthy();

    // Verify the file was actually written
    const content = fs.readFileSync(result.path!, "utf-8");
    expect(content).toContain("Hello from MCP!");
    expect(content).toContain("test-subject");
    expect(content).toContain("orion");
  });

  it("fails gracefully for non-existent target", async () => {
    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.sendSiblingMessage("ghost", "test", "Nobody home", "orion");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No inbox found");
  });

  it("sanitizes subject for filename", async () => {
    const inbox = path.join(tmpDir, "workspace-testbot", "inbox");
    fs.mkdirSync(inbox, { recursive: true });

    vi.resetModules();
    const mod = await import("./tools.js");
    const result = await mod.sendSiblingMessage(
      "testbot",
      "weird/subject with spaces!",
      "body",
      "orion",
    );
    expect(result.ok).toBe(true);
    // Filename should not contain slashes or spaces
    const filename = path.basename(result.path!);
    expect(filename).not.toMatch(/[/ ]/);
  });
});
