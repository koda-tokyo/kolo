import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The external-runtime set is read from the environment when the module loads.
vi.hoisted(() => {
  process.env.KOLO_EXTERNAL_RUNTIME_AGENTS = "atlas";
});

vi.mock("../gateway/call.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../gateway/call.js")>()),
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));
vi.mock("../security/audit-log.js", () => ({
  recordAuditEvent: vi.fn((e: Record<string, unknown>) => e),
}));

import type { KoLoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<KoLoConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses gateway by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway).mockResolvedValue({
      runId: "idem-1",
      status: "ok",
      result: {
        payloads: [{ text: "hello" }],
        meta: { stub: true },
      },
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never falls back to the embedded agent: unreachable gateway exits 3 naming state dir and port", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store, { gateway: { port: 18877 } as KoLoConfig["gateway"] });
    const prevHome = process.env.KOLO_HOME;
    process.env.KOLO_HOME = dir;

    vi.mocked(callGateway).mockRejectedValue(
      new Error("gateway closed (1006 abnormal closure (no close frame)): no close reason"),
    );

    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.exit).toHaveBeenCalledWith(3);
      const message = vi
        .mocked(runtime.error)
        .mock.calls.map((c) => String(c[0]))
        .join("\n");
      expect(message).toContain("gateway unreachable");
      expect(message).toContain(dir);
      expect(message).toContain("18877");
      expect(message).toContain("--local");
    } finally {
      if (prevHome === undefined) delete process.env.KOLO_HOME;
      else process.env.KOLO_HOME = prevHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("propagates a gateway error that is not unreachability (no fallback either)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    mockConfig(path.join(dir, "sessions.json"));
    vi.mocked(callGateway).mockRejectedValue(new Error("invalid agent params: unknown agent id"));
    try {
      await expect(agentCliCommand({ message: "hi", to: "+1555" }, runtime)).rejects.toThrow(
        /unknown agent id/,
      );
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.exit).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the port in the gateway lease under KOLO_HOME over the config port", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    mockConfig(path.join(dir, "sessions.json"), {
      gateway: { port: 18877 } as KoLoConfig["gateway"],
    });
    fs.mkdirSync(path.join(dir, "run"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "run", "gateway.lock"),
      JSON.stringify({ pid: 1, port: 18911 }),
    );
    const prevHome = process.env.KOLO_HOME;
    process.env.KOLO_HOME = dir;
    vi.mocked(callGateway).mockResolvedValue({
      runId: "idem-1",
      status: "ok",
      result: { payloads: [] },
    });
    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);
      const call = vi.mocked(callGateway).mock.calls[0][0] as { url?: string };
      expect(call.url).toBe("ws://127.0.0.1:18911");
    } finally {
      if (prevHome === undefined) delete process.env.KOLO_HOME;
      else process.env.KOLO_HOME = prevHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("acks external-runtime agents (inbox delivery, no live reply)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    // The inbox is resolved from the shared state root (KOLO_SHARED_HOME, else the per-OS
    // default); HOME would only move it on POSIX.
    const prevShared = process.env.KOLO_SHARED_HOME;
    process.env.KOLO_SHARED_HOME = path.join(dir, ".kolo");

    try {
      await agentCliCommand({ message: "hi", agent: "atlas" }, runtime);

      expect(callGateway).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith(
        expect.stringContaining("Delivered to atlas's inbox"),
      );

      const inboxDir = path.join(dir, ".kolo", "workspace-atlas", "inbox");
      const files = fs.readdirSync(inboxDir);
      expect(files.length).toBe(1);
      const content = fs.readFileSync(path.join(inboxDir, files[0]), "utf-8");
      expect(content).toContain("hi");
    } finally {
      if (prevShared === undefined) delete process.env.KOLO_SHARED_HOME;
      else process.env.KOLO_SHARED_HOME = prevShared;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits JSON for external-runtime agents in --json mode", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    const prevHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      await agentCliCommand({ message: "hi", agent: "atlas", json: true }, runtime);

      expect(runtime.log).toHaveBeenCalledTimes(1);
      const logged = vi.mocked(runtime.log).mock.calls[0][0] as string;
      const parsed = JSON.parse(logged);
      expect(parsed.status).toBe("delivered_to_inbox");
      expect(parsed.summary).toContain("atlas");
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--local runs embedded explicitly: one notice line and an agent.local_run audit entry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
      rt.log?.("local");
      return { payloads: [{ text: "local" }], meta: { stub: true } };
    });

    try {
      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
      expect(runtime.error).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(runtime.error).mock.calls[0][0])).toContain("--local");
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "agent.local_run",
          outcome: "allowed",
          source: "cli.agent",
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
