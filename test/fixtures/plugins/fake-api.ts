// Fake KoLoPluginApi for ops-plugin unit tests (KoLo 2.0, M7).
// Real lifecycle + signal bus (so timers registered through the api respect vi.useFakeTimers and
// dispose), recording stubs for everything that would touch the gateway.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KoLoConfig } from "../../../src/config/config.js";
import type {
  KoLoPluginApi,
  KoLoPluginAuditInput,
  KoLoPluginService,
  PluginHookName,
} from "../../../src/plugins/types.js";
import { createPluginLifecycle, createPluginSignalBus } from "../../../src/plugins/lifecycle.js";

export type FakeApi = {
  api: KoLoPluginApi;
  home: string;
  audits: KoLoPluginAuditInput[];
  logs: Array<{ level: string; message: string }>;
  systemEvents: Array<{ text: string; sessionKey: string }>;
  restarts: string[];
  services: KoLoPluginService[];
  tools: Array<{ name: string; execute: (...args: unknown[]) => unknown }>;
  hooks: Map<string, Array<(...args: unknown[]) => unknown>>;
  dispose: () => Promise<void>;
  cleanup: () => void;
};

export function createFakeApi(params: {
  id: string;
  pluginConfig?: Record<string, unknown>;
  config?: KoLoConfig;
  restartOk?: boolean;
}): FakeApi {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `kolo-plugin-${params.id}-`));
  const logDir = path.join(home, "logs");
  const runDir = path.join(home, "run");
  const secretsDir = path.join(home, "secrets");
  for (const dir of [logDir, runDir, secretsDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const lifecycle = createPluginLifecycle();
  const bus = createPluginSignalBus();
  const audits: KoLoPluginAuditInput[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  const systemEvents: Array<{ text: string; sessionKey: string }> = [];
  const restarts: string[] = [];
  const services: KoLoPluginService[] = [];
  const tools: FakeApi["tools"] = [];
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();

  const api: KoLoPluginApi = {
    id: params.id,
    name: params.id,
    source: path.join(home, "plugin", "index.ts"),
    config: params.config ?? {},
    pluginConfig: params.pluginConfig ?? {},
    // Only ops plugins use this fake; they never touch runtime.*
    runtime: {} as KoLoPluginApi["runtime"],
    logger: {
      info: (m) => logs.push({ level: "info", message: m }),
      warn: (m) => logs.push({ level: "warn", message: m }),
      error: (m) => logs.push({ level: "error", message: m }),
      debug: (m) => logs.push({ level: "debug", message: m }),
    },
    registerTool: (tool) => {
      if (typeof tool !== "function") {
        tools.push({ name: tool.name, execute: tool.execute as (...args: unknown[]) => unknown });
      }
    },
    registerHook: () => {},
    registerHttpHandler: () => {},
    registerHttpRoute: () => {},
    registerChannel: () => {},
    registerGatewayMethod: () => {},
    registerCli: () => {},
    registerService: (service) => {
      services.push(service);
    },
    registerProvider: () => {},
    registerCommand: () => {},
    resolvePath: (input) => (input.startsWith("~") ? path.join(home, input.slice(1)) : input),
    on: (hookName: PluginHookName, handler) => {
      const list = hooks.get(hookName) ?? [];
      list.push(handler as (...args: unknown[]) => unknown);
      hooks.set(hookName, list);
    },
    lifecycle: lifecycle.api,
    audit: (input) => {
      audits.push(input);
    },
    paths: {
      home,
      stateDir: home,
      logDir,
      runDir,
      secretsDir,
      configPath: path.join(home, "kolo.json"),
    },
    supervisor: {
      restartGateway: (reason) => {
        restarts.push(reason);
        return { ok: params.restartOk !== false, method: "fake" };
      },
    },
    signals: bus.forPlugin(lifecycle.api),
    enqueueSystemEvent: (text, sessionKey) => {
      systemEvents.push({ text, sessionKey });
    },
  };

  return {
    api,
    home,
    audits,
    logs,
    systemEvents,
    restarts,
    services,
    tools,
    hooks,
    dispose: () => lifecycle.dispose(),
    cleanup: () => {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Start every registered service with a minimal context. */
export async function startServices(fake: FakeApi): Promise<void> {
  for (const service of fake.services) {
    await service.start({
      config: fake.api.config,
      stateDir: fake.home,
      logger: fake.api.logger,
    });
  }
}

export async function stopServices(fake: FakeApi): Promise<void> {
  for (const service of fake.services.toReversed()) {
    await service.stop?.({ config: fake.api.config, stateDir: fake.home, logger: fake.api.logger });
  }
}
