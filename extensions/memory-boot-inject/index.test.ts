import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeApi } from "../../test/fixtures/plugins/fake-api.js";
import plugin, { buildBootContext, createBootInjector, resolveBootInjectConfig, tailBytes } from "./index.js";

describe("buildBootContext", () => {
  const cfg = resolveBootInjectConfig({ maxBytesPerFile: 300, maxTotalBytes: 700, header: "H:" });
  it("caps each file (keeping the tail) and lists missing files", () => {
    const out = buildBootContext(
      [
        { path: "/m/diary.md", content: "a".repeat(100) + "\nLAST LINE" },
        { path: "/m/missing.md", content: null },
      ],
      cfg,
    );
    expect(out.startsWith("H:\n--- diary.md (/m/diary.md) ---")).toBe(true);
    expect(out).toContain("LAST LINE");
    expect(out).toContain("(not injected: /m/missing.md)");
  });
  it("respects the total budget", () => {
    const out = buildBootContext(
      [
        { path: "/m/a.md", content: "x".repeat(250) },
        { path: "/m/b.md", content: "y".repeat(250) },
        { path: "/m/c.md", content: "z".repeat(250) },
      ],
      cfg,
    );
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThan(900);
    expect(out).toContain("/m/c.md (over total budget)");
  });
  it("returns empty when there are no files", () => {
    expect(buildBootContext([], cfg)).toBe("");
  });
  it("tailBytes keeps the end", () => {
    expect(tailBytes("0123456789", 100)).toBe("0123456789");
    expect(tailBytes("0123456789".repeat(10), 30)).toMatch(/^\[\.\.\.truncated\.\.\.\]\n\d{12}$/);
  });
});

describe("memory-boot-inject plugin", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(() => {
    for (const f of fakes.splice(0)) {
      f.cleanup();
    }
  });

  it("injects once per session, filters agents, resets on gateway_start", () => {
    const fake = createFakeApi({
      id: "memory-boot-inject",
      pluginConfig: { files: ["memory/diary.md", "~/handoff.md"], agents: ["main"] },
    });
    fakes.push(fake);
    fs.mkdirSync(path.join(fake.home, "memory"), { recursive: true });
    fs.writeFileSync(path.join(fake.home, "memory", "diary.md"), "today: shipped M7");
    fs.writeFileSync(path.join(fake.home, "handoff.md"), "next: M8");
    plugin.register(fake.api);
    const before = fake.hooks.get("before_agent_start")![0] as (
      e: unknown,
      ctx: { agentId: string; sessionKey: string },
    ) => { prependContext?: string } | undefined;
    const first = before({}, { agentId: "main", sessionKey: "agent:main:main" });
    expect(first?.prependContext).toContain("today: shipped M7");
    expect(first?.prependContext).toContain("next: M8");
    expect(before({}, { agentId: "main", sessionKey: "agent:main:main" })).toBeUndefined();
    expect(before({}, { agentId: "other", sessionKey: "agent:other:main" })).toBeUndefined();
    expect(fake.audits.map((a) => a.action)).toEqual(["memory.boot_injected"]);
    (fake.hooks.get("gateway_start")![0] as () => void)();
    expect(before({}, { agentId: "main", sessionKey: "agent:main:main" })?.prependContext).toBeDefined();
  });

  it("injects every turn when once=false and skips when every file is missing", () => {
    const fake = createFakeApi({ id: "memory-boot-inject", pluginConfig: { files: ["nope.md"], once: false } });
    fakes.push(fake);
    const injector = createBootInjector(fake.api);
    // Missing file: the block says so, still injected (the agent learns the file is absent).
    expect(injector.inject({ agentId: "a", sessionKey: "s" })).toContain("not injected");
    expect(injector.inject({ agentId: "a", sessionKey: "s" })).toContain("not injected");
    expect(injector.injected.size).toBe(1);
  });
});
