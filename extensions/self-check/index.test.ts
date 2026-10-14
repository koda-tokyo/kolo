import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, startServices } from "../../test/fixtures/plugins/fake-api.js";
import plugin, {
  checkPermissions,
  checkPorts,
  createSelfCheck,
  isLoopbackListener,
  parseProcNetTcp,
  scanForSecrets,
  type PermEntry,
  type PermFs,
} from "./index.js";

function memPerm(entries: Record<string, { mode: number; isDir?: boolean }>): PermFs & { chmods: string[] } {
  const chmods: string[] = [];
  return {
    chmods,
    stat: (p): PermEntry => {
      const e = entries[p];
      return e ? { path: p, mode: e.mode, isDir: e.isDir ?? false, exists: true } : { path: p, mode: 0, isDir: false, exists: false };
    },
    list: (dir) => Object.keys(entries).filter((p) => path.dirname(p) === dir),
    chmod: (p, mode) => {
      chmods.push(`${p}:${mode.toString(8)}`);
      entries[p]!.mode = mode;
    },
  };
}

describe("checkPermissions", () => {
  it("flags group/other bits on secrets, config and key; fixes when asked", () => {
    const io = memPerm({
      "/h/secrets": { mode: 0o755, isDir: true },
      "/h/secrets/gateway.token": { mode: 0o644 },
      "/h/secrets/ok.key": { mode: 0o600 },
      "/h/kolo.json": { mode: 0o664 },
    });
    const strict = checkPermissions({ secretsDir: "/h/secrets", configPath: "/h/kolo.json" }, io, false);
    expect(strict.map((f) => f.message)).toEqual([
      "/h/secrets is mode 755; expected 700 (set autoFix to repair)",
      "/h/secrets/gateway.token is mode 644; expected 600 (set autoFix to repair)",
      "/h/kolo.json is mode 664; expected 600 (set autoFix to repair)",
    ]);
    const fixed = checkPermissions({ secretsDir: "/h/secrets", configPath: "/h/kolo.json" }, io, true);
    expect(fixed.every((f) => f.level === "warn")).toBe(true);
    expect(io.chmods).toEqual(["/h/secrets:700", "/h/secrets/gateway.token:600", "/h/kolo.json:600"]);
    expect(checkPermissions({ secretsDir: "/h/secrets", configPath: "/h/kolo.json" }, io, false)).toEqual([]);
  });
});

describe("ports", () => {
  const TCP4 =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n" +
    "   0: 0100007F:4965 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1\n" +
    "   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2\n" +
    "   2: 00000000:4966 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 3\n" +
    "   3: 0100007F:9999 0100007F:1234 01 00000000:00000000 00:00000000 00000000  1000        0 4\n";
  const TCP6 =
    "  sl  local_address                         remote_address                        st\n" +
    "   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 0 0 0 0 0\n" +
    "   1: 00000000000000000000000000000000:0C1A 00000000000000000000000000000000:0000 0A 0 0 0 0 0\n";
  it("parses LISTEN rows and classifies loopback", () => {
    const l4 = parseProcNetTcp(TCP4, false);
    expect(l4.map((l) => [l.port, isLoopbackListener(l)])).toEqual([[18789, true], [22, false], [18790, false]]);
    const l6 = parseProcNetTcp(TCP6, true);
    expect(l6.map((l) => [l.port, isLoopbackListener(l)])).toEqual([[8080, true], [3098, false]]);
  });
  it("applies the bind policy and the allowlist", () => {
    const listeners = [...parseProcNetTcp(TCP4, false), ...parseProcNetTcp(TCP6, true)];
    const f = checkPorts(listeners, { gatewayPort: 18790, bind: "loopback", allowPublicPorts: [22] });
    expect(f.map((x) => [x.level, x.message])).toEqual([
      ["error", 'gateway port 18790 listens on all interfaces but gateway.bind is "loopback"'],
      ["warn", "port 3098 listens on all interfaces (not in allowPublicPorts)"],
    ]);
    expect(checkPorts(listeners, { gatewayPort: 18790, bind: "lan", allowPublicPorts: [22, 3098] })).toEqual([]);
  });
});

describe("scanForSecrets", () => {
  it("reports file + pattern, never the value, and skips big files and node_modules", () => {
    const files: Record<string, string> = {
      "/d/notes.md": "token sk-" + "a".repeat(40) + " here",
      "/d/big.log": "sk-" + "b".repeat(40),
      "/d/node_modules/x.js": "ghp_" + "c".repeat(40),
      "/d/clean.md": "nothing",
    };
    const io = {
      list: (dir: string) =>
        dir === "/d"
          ? [
              { path: "/d/notes.md", size: 60, isDir: false },
              { path: "/d/big.log", size: 10_000, isDir: false },
              { path: "/d/node_modules", size: 0, isDir: true },
              { path: "/d/clean.md", size: 7, isDir: false },
            ]
          : [{ path: "/d/node_modules/x.js", size: 50, isDir: false }],
      read: (p: string) => files[p]!,
    };
    const f = scanForSecrets(["/d"], [/sk-[a-zA-Z0-9_-]{30,}/, /ghp_[a-zA-Z0-9]{30,}/], 1000, io);
    expect(f).toEqual([{ check: "secrets", level: "error", message: "/d/notes.md matches sk-[a-zA-Z0-9_-]{30,}" }]);
    expect(JSON.stringify(f)).not.toContain("aaaa");
  });
});

describe("self-check plugin", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const f of fakes.splice(0)) {
      await f.dispose();
      f.cleanup();
    }
  });

  it("writes the report, audits the run and each new finding once", async () => {
    const fake = createFakeApi({
      id: "self-check",
      pluginConfig: { allowPublicPorts: [22] },
      config: { gateway: { port: 18790, bind: "loopback" } },
    });
    fakes.push(fake);
    fs.writeFileSync(path.join(fake.api.paths.secretsDir, "gateway.token"), "t", { mode: 0o600 });
    fs.writeFileSync(fake.api.paths.configPath, "{}", { mode: 0o600 });
    let listeners = [{ port: 18790, addr: "00000000", v6: false }];
    const check = createSelfCheck(fake.api, {
      listeners: () => listeners,
      configSnapshot: async () => ({ valid: true, exists: true, issues: [] }),
      integrity: () => ({ ok: true, summary: "registry verified", present: true }),
      now: () => new Date("2026-10-13T00:00:00Z"),
    });
    const first = await check.run();
    expect(first.ok).toBe(false);
    // Mode bits are not representable on NTFS; the plugin skips the check there.
    const permissions = process.platform === "win32" ? "skip" : "pass";
    expect(first.checks).toEqual({ permissions, config: "pass", integrity: "pass", ports: "fail", secrets: "skip" });
    expect(JSON.parse(fs.readFileSync(check.reportFile, "utf-8")).ranAt).toBe("2026-10-13T00:00:00.000Z");
    expect(fake.audits.map((a) => a.action)).toEqual(["self_check.run", "self_check.finding"]);
    await check.run();
    expect(fake.audits.map((a) => a.action)).toEqual(["self_check.run", "self_check.finding", "self_check.run"]);
    listeners = [{ port: 18790, addr: "0100007f", v6: false }];
    const third = await check.run();
    expect(third.ok).toBe(true);
    expect(fake.api.signals.get<{ ok: boolean }>("self_check")?.ok).toBe(true);
  });

  it("skips the permissions check on Windows, where mode bits are not representable", async () => {
    const fake = createFakeApi({ id: "self-check", pluginConfig: {} });
    fakes.push(fake);
    fs.writeFileSync(path.join(fake.api.paths.secretsDir, "gateway.token"), "t", { mode: 0o644 });
    const check = createSelfCheck(fake.api, {
      platform: "win32",
      listeners: () => [],
      configSnapshot: async () => ({ valid: true, exists: true, issues: [] }),
      integrity: () => ({ ok: true, summary: "registry verified", present: true }),
    });
    const report = await check.run();
    expect(report.checks.permissions).toBe("skip");
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.check === "permissions").map((f) => f.level)).toEqual(["info"]);
  });

  it("runs on start and on the interval through the lifecycle", async () => {
    vi.useFakeTimers();
    const fake = createFakeApi({ id: "self-check", pluginConfig: { intervalMs: 30_000 } });
    fakes.push(fake);
    plugin.register(fake.api);
    await startServices(fake);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fake.audits.filter((a) => a.action === "self_check.run")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.audits.filter((a) => a.action === "self_check.run")).toHaveLength(2);
    expect(fs.existsSync(path.join(fake.home, "self-check", "latest.json"))).toBe(true);
  });
});
