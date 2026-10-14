import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { ConnectDeps } from "./connect/types.js";
import { renderQrText } from "./connect/qr.js";
import { initCommand } from "./init.js";

vi.mock(import("../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

const prevEnv = { ...process.env };
const dirs: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-init-phone-"));
  dirs.push(dir);
  return dir;
}

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  let exit: number | null = null;
  const runtime = {
    log: (...a: unknown[]) => lines.push(a.join(" ")),
    error: (...a: unknown[]) => errors.push(a.join(" ")),
    exit: (code: number) => {
      exit = code;
    },
  } as RuntimeEnv;
  return { runtime, lines, errors, exit: () => exit };
}

beforeEach(() => {
  delete process.env.KOLO_CONFIG_PATH;
  process.env.KOLO_SECRETS_BACKEND = "file";
  process.env.KOLO_SECRETS_KEY = "init-phone-test-key-0123456789abcdef";
});

afterEach(() => {
  process.env = { ...prevEnv };
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("kolo init --phone (M16)", () => {
  test("--phone skip leaves init's behaviour and output unchanged", async () => {
    const a = tempHome();
    const b = tempHome();
    const without = capture();
    await initCommand({ nonInteractive: true, stateDir: a, name: "alice" }, without.runtime);
    const skipped = capture();
    await initCommand(
      { nonInteractive: true, stateDir: b, name: "alice", phone: "skip" },
      skipped.runtime,
    );
    const norm = (lines: string[], home: string) =>
      lines.map((l) =>
        l
          .split(home)
          .join("<home>")
          .replace(/\(\d+ notes?\)|\d+ notes?/, "<n>"),
      );
    expect(norm(skipped.lines, b)).toEqual(norm(without.lines, a));
    expect(skipped.errors).toEqual(without.errors);
    const cfg = JSON.parse(fs.readFileSync(path.join(b, "kolo.json"), "utf8"));
    expect(cfg.channels).toBeUndefined();
    expect(fs.existsSync(path.join(b, "channels", "owner-codes.json"))).toBe(false);
  });

  test("an unknown --phone value is a usage error before anything is written", async () => {
    const home = tempHome();
    const run = capture();
    await initCommand(
      { nonInteractive: true, stateDir: home, phone: "pager" as never },
      run.runtime,
    );
    expect(run.exit()).toBe(2);
    expect(run.errors.join("\n")).toContain("--phone pager");
    expect(fs.existsSync(path.join(home, "kolo.json"))).toBe(false);
  });

  test("--phone telegram ends init with the deep-link QR", async () => {
    const home = tempHome();
    const run = capture();
    const store = new Map<string, string>();
    let cfgOnDisk: Record<string, unknown> = {};
    const deps: ConnectDeps = {
      runtime: run.runtime,
      readConfig: async () => JSON.parse(fs.readFileSync(path.join(home, "kolo.json"), "utf8")),
      writeConfig: async (next) => {
        cfgOnDisk = next as Record<string, unknown>;
      },
      secrets: () => ({
        backend: "file",
        location: "memory",
        get: (n) => store.get(n),
        set: (n, v) => {
          store.set(n, v);
        },
        delete: (n) => store.delete(n),
        list: () => [...store.keys()],
      }),
      renderQr: renderQrText,
      env: { KOLO_HOME: home, KOLO_STATE_DIR: home, TELEGRAM_BOT_TOKEN: "123:abc-token" },
      now: Date.now,
      sleep: async () => {},
      probeGateway: async () => false,
      whatsappLink: async () => ({ e164: null, jid: null, alreadyLinked: false }),
      telegramProbe: async () => ({ ok: true, username: "ops_bot" }),
      lineProbe: async () => ({ ok: false }),
      createInvitation: async () => ({ code: "", id: "", expiresAt: "" }),
      lanAddress: () => undefined,
      tailnetAddress: () => undefined,
    };
    await initCommand(
      { nonInteractive: true, stateDir: home, name: "alice", phone: "telegram" },
      run.runtime,
      deps,
    );
    const text = run.lines.join("\n");
    const tail = text.slice(text.lastIndexOf("phone      telegram"));
    expect(tail).toMatch(/https:\/\/t\.me\/ops_bot\?start=KOLO-/);
    expect(tail).toMatch(/[▀▄█]/);
    expect(tail).toContain("gateway is not running");
    expect(text).not.toContain("123:abc-token");
    expect(store.get("channel.telegram.botToken")).toBe("123:abc-token");
    expect((cfgOnDisk.channels as Record<string, { enabled?: boolean }>).telegram.enabled).toBe(
      true,
    );
  });

  test("--phone web on loopback explains why instead of failing init", async () => {
    const home = tempHome();
    const run = capture();
    await initCommand({ nonInteractive: true, stateDir: home, phone: "web" }, run.runtime);
    expect(run.exit()).toBe(null);
    expect(run.lines.join("\n")).toContain("phone      not connected:");
    expect(run.lines.join("\n")).toContain("loopback");
  });
});
