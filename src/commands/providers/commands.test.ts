import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../runtime.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { loadConfig } from "../../config/config.js";
import { modelsListCommand } from "../models/list.list-command.js";
import {
  collectProviderRows,
  providersAddCommand,
  providersDefaultCommand,
  providersListCommand,
  providersRemoveCommand,
  providersTestCommand,
} from "./commands.js";
import { probeProvider } from "./probe.js";
import { PROVIDERS_EXIT } from "./shared.js";

const SECRET = "sk-test-0123456789abcdef";

function makeRuntime() {
  const logs: string[] = [];
  const errors: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    },
    exit: ((code: number) => {
      throw new Error(`exit:${code}`);
    }) as RuntimeEnv["exit"],
  };
  return { runtime, logs, errors };
}

type FakeServer = { url: string; close: () => Promise<void>; hits: string[] };

async function startFakeProvider(
  opts: { auth?: string; status?: number } = {},
): Promise<FakeServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? "-"}`);
    if (opts.auth && req.headers.authorization !== `Bearer ${opts.auth}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad key" }));
      return;
    }
    if (opts.status) {
      res.writeHead(opts.status);
      res.end();
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }));
      return;
    }
    if (req.url?.endsWith("/chat/completions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "x" } }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let home: string;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-providers-"));
  for (const key of [
    "KOLO_HOME",
    "KOLO_AGENT_DIR",
    "KOLO_CONFIG_CACHE_MS",
    "SAKURA_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    envBackup[key] = process.env[key];
  }
  process.env.KOLO_HOME = home;
  process.env.KOLO_AGENT_DIR = path.join(home, "agent");
  process.env.KOLO_CONFIG_CACHE_MS = "0";
  delete process.env.SAKURA_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const agentDir = () => path.join(home, "agent");

describe("kolo providers", () => {
  it("lists every registry entry as unconfigured on a fresh home", async () => {
    const { runtime, logs } = makeRuntime();
    await providersListCommand({ json: true }, runtime, { agentDir });
    const parsed = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      providers: Array<Record<string, unknown>>;
    };
    expect(parsed.ok).toBe(true);
    const sakura = parsed.providers.find((p) => p.id === "sakura");
    expect(sakura).toMatchObject({ configured: false, default: false, api: "openai-compatible" });
    // No key is needed for a local runtime: it counts as configured.
    expect(parsed.providers.find((p) => p.id === "ollama")).toMatchObject({
      configured: true,
      source: "none-needed",
    });
    const { runtime: table, logs: tableLogs } = makeRuntime();
    await providersListCommand({}, table, { agentDir });
    expect(tableLogs.join("\n")).toContain("Sakura AI Engine");
    expect(tableLogs.join("\n")).toContain("Hosted in Japan");
    // Catalogue entries stay behind --all or --search; the footer counts them.
    expect(parsed.providers.every((p) => p.catalogue === false)).toBe(true);
    expect(typeof (parsed as { hidden?: number }).hidden).toBe("number");
    expect(tableLogs.join("\n")).toMatch(/\d+ more providers from the public catalogue/);
    const { runtime: all, logs: allLogs } = makeRuntime();
    await providersListCommand({ json: true, all: true }, all, { agentDir });
    const everything = JSON.parse(allLogs.join("\n")) as { providers: unknown[]; hidden: number };
    expect(everything.providers.length).toBeGreaterThanOrEqual(50);
    expect(everything.hidden).toBe(0);
    const { runtime: search, logs: searchLogs } = makeRuntime();
    await providersListCommand({ json: true, search: "sakura" }, search, { agentDir });
    const found = JSON.parse(searchLogs.join("\n")) as { providers: Array<{ id: string }> };
    expect(found.providers.map((p) => p.id)).toEqual(["sakura"]);
  });

  it("add stores the key outside kolo.json, writes the provider entry and never prints the key", async () => {
    const { runtime, logs, errors } = makeRuntime();
    await providersAddCommand("sakura", { apiKeyStdin: true }, runtime, {
      agentDir,
      readStdin: async () => `${SECRET}\n`,
    });
    const output = [...logs, ...errors].join("\n");
    expect(output).not.toContain(SECRET);
    expect(output).toContain("stored (profile sakura:default)");
    const configText = fs.readFileSync(path.join(home, "kolo.json"), "utf8");
    expect(configText).not.toContain(SECRET);
    const cfg = loadConfig();
    expect(cfg.models?.providers?.sakura).toMatchObject({
      baseUrl: "https://api.ai.sakura.ad.jp/v1",
      api: "openai-completions",
      models: [expect.objectContaining({ id: "gpt-oss-120b" })],
    });
    expect(cfg.auth?.profiles?.["sakura:default"]).toEqual({ provider: "sakura", mode: "api_key" });
    const store = ensureAuthProfileStore(agentDir(), { allowKeychainPrompt: false });
    expect(store.profiles["sakura:default"]).toEqual({
      type: "api_key",
      provider: "sakura",
      key: SECRET,
    });
    const rows = collectProviderRows({ cfg, agentDir: agentDir(), env: {} });
    expect(rows.find((r) => r.id === "sakura")).toMatchObject({
      configured: true,
      source: "profile",
    });
  });

  it("add needs a base url for generic entries and rejects keys on argv-like paths", async () => {
    const { runtime } = makeRuntime();
    await expect(
      providersAddCommand("openai-compatible", { apiKeyStdin: true }, runtime, {
        agentDir,
        readStdin: async () => SECRET,
      }),
    ).rejects.toMatchObject({
      exitCode: PROVIDERS_EXIT.usage,
      message: expect.stringContaining("--base-url"),
    });
    await expect(providersAddCommand("nope", {}, runtime, { agentDir })).rejects.toMatchObject({
      exitCode: PROVIDERS_EXIT.usage,
      message: expect.stringContaining("unknown provider id"),
    });
    await expect(
      providersAddCommand("sakura", {}, runtime, { agentDir, isTty: () => false, env: {} }),
    ).rejects.toMatchObject({
      exitCode: PROVIDERS_EXIT.usage,
      message: expect.stringContaining("SAKURA_API_KEY"),
    });
  });

  it("add takes the key from the registry env var when nothing else gives one", async () => {
    const { runtime } = makeRuntime();
    await providersAddCommand("openai-compatible", { baseUrl: "https://llm.example/v1" }, runtime, {
      agentDir,
      isTty: () => false,
      env: {},
    }).catch((err: unknown) => {
      expect((err as { exitCode?: number }).exitCode).toBe(PROVIDERS_EXIT.usage);
    });
    await providersAddCommand("sakura", { model: "llm-jp-3.1-8x13b-instruct" }, runtime, {
      agentDir,
      isTty: () => false,
      env: { SAKURA_API_KEY: SECRET },
    });
    const store = ensureAuthProfileStore(agentDir(), { allowKeychainPrompt: false });
    expect(store.profiles["sakura:default"]).toMatchObject({ key: SECRET });
    expect(loadConfig().models?.providers?.sakura?.models.map((m) => m.id)).toEqual([
      "llm-jp-3.1-8x13b-instruct",
    ]);
  });

  it("test reports latency and the number of models from the models endpoint", async () => {
    const server = await startFakeProvider({ auth: SECRET });
    try {
      const { runtime: addRt } = makeRuntime();
      await providersAddCommand(
        "openai-compatible",
        { baseUrl: server.url, apiKeyStdin: true },
        addRt,
        { agentDir, readStdin: async () => SECRET },
      );
      const { runtime, logs } = makeRuntime();
      await providersTestCommand("openai-compatible", {}, runtime, { agentDir });
      expect(logs[0]).toMatch(/^ok {2}openai-compatible {2}\d+ ms {2}2 models$/);
      expect(server.hits[0]).toContain("GET /v1/models");
      const { runtime: jsonRt, logs: jsonLogs } = makeRuntime();
      await providersTestCommand("openai-compatible", { json: true }, jsonRt, { agentDir });
      const parsed = JSON.parse(jsonLogs.join("")) as {
        ok: boolean;
        models: string[];
        latencyMs: number;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.models).toEqual(["model-a", "model-b"]);
      expect(parsed.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await server.close();
    }
  });

  it("test exits 4 on a rejected key, 3 when unreachable and 4 when no key is stored", async () => {
    const server = await startFakeProvider({ auth: "other-key" });
    try {
      const { runtime: addRt } = makeRuntime();
      await providersAddCommand(
        "openai-compatible",
        { baseUrl: server.url, apiKeyStdin: true },
        addRt,
        { agentDir, readStdin: async () => SECRET },
      );
      const { runtime } = makeRuntime();
      await expect(
        providersTestCommand("openai-compatible", {}, runtime, { agentDir }),
      ).rejects.toMatchObject({
        exitCode: PROVIDERS_EXIT.auth,
        message: expect.stringContaining("HTTP 401"),
      });
    } finally {
      await server.close();
    }
    // The port is closed now: connection refused.
    const { runtime: deadRt } = makeRuntime();
    await expect(
      providersTestCommand("openai-compatible", { timeout: 2000 }, deadRt, { agentDir }),
    ).rejects.toMatchObject({ exitCode: PROVIDERS_EXIT.unreachable });
    const { runtime: noKeyRt } = makeRuntime();
    await expect(
      providersTestCommand("sakura", {}, noKeyRt, { agentDir, env: {} }),
    ).rejects.toMatchObject({
      exitCode: PROVIDERS_EXIT.auth,
      message: expect.stringContaining("no key"),
    });
  });

  it("probe falls back to a one-token chat request when there is no models endpoint", async () => {
    const server = await startFakeProvider({ auth: SECRET });
    try {
      const entry = {
        ...(await import("../../providers/registry.js")).getProvider("zai")!,
        baseUrl: server.url,
      };
      const result = await probeProvider({ entry, apiKey: SECRET });
      expect(result).toMatchObject({ ok: true, via: "chat", models: [] });
      expect(server.hits[0]).toContain("POST /v1/chat/completions");
      const noModel = await probeProvider({
        entry: { ...entry, defaultModel: undefined },
        apiKey: SECRET,
      });
      expect(noModel).toMatchObject({ ok: false, exitCode: PROVIDERS_EXIT.usage });
    } finally {
      await server.close();
    }
  });

  it("default sets the primary model and remove clears config and keys", async () => {
    const { runtime: addRt } = makeRuntime();
    await providersAddCommand("sakura", { apiKeyStdin: true }, addRt, {
      agentDir,
      readStdin: async () => SECRET,
    });
    const { runtime, logs } = makeRuntime();
    await providersDefaultCommand("sakura", {}, runtime, { agentDir });
    expect(logs[0]).toBe("primary    sakura/gpt-oss-120b");
    expect(loadConfig().agents?.defaults?.model?.primary).toBe("sakura/gpt-oss-120b");
    const rows = collectProviderRows({ cfg: loadConfig(), agentDir: agentDir(), env: {} });
    expect(rows.find((r) => r.id === "sakura")?.default).toBe(true);
    await providersDefaultCommand("sakura", { model: "Kimi-K2.6" }, runtime, { agentDir });
    expect(loadConfig().agents?.defaults?.model?.primary).toBe("sakura/Kimi-K2.6");
    await expect(providersDefaultCommand("groq", {}, runtime, { agentDir })).rejects.toMatchObject({
      exitCode: PROVIDERS_EXIT.usage,
    });

    await expect(
      providersRemoveCommand("sakura", {}, runtime, { agentDir, isTty: () => false }),
    ).rejects.toMatchObject({ exitCode: PROVIDERS_EXIT.usage });
    const { runtime: rmRt, logs: rmLogs } = makeRuntime();
    await providersRemoveCommand("sakura", { yes: true }, rmRt, { agentDir });
    expect(rmLogs[0]).toBe("removed    sakura (config, 1 stored key)");
    const cfg = loadConfig();
    expect(cfg.models?.providers?.sakura).toBeUndefined();
    expect(cfg.auth?.profiles?.["sakura:default"]).toBeUndefined();
    const store = ensureAuthProfileStore(agentDir(), { allowKeychainPrompt: false });
    expect(store.profiles["sakura:default"]).toBeUndefined();
  });

  it("models list --live adds models the provider reports", async () => {
    const server = await startFakeProvider({ auth: SECRET });
    try {
      const { runtime: addRt } = makeRuntime();
      await providersAddCommand(
        "openai-compatible",
        { baseUrl: server.url, apiKeyStdin: true, model: "model-a" },
        addRt,
        { agentDir, readStdin: async () => SECRET },
      );
      const { runtime, logs, errors } = makeRuntime();
      await modelsListCommand({ live: true, json: true, provider: "openai-compatible" }, runtime, {
        agentDir: agentDir(),
      });
      const parsed = JSON.parse(logs.join("")) as {
        models: Array<{ key: string; tags: string[] }>;
      };
      const keys = parsed.models.map((m) => m.key);
      expect(keys).toContain("openai-compatible/model-b");
      expect(parsed.models.find((m) => m.key === "openai-compatible/model-b")?.tags).toEqual([
        "live",
      ]);
      expect(errors).toEqual([]);
      expect(logs.join("")).not.toContain(SECRET);
    } finally {
      await server.close();
    }
  });
});
