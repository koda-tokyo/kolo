// Plugin host (M7): reload in place, dispose contract, quarantine, config apply, file watcher.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { getPluginHost, loadKoLoPlugins } from "./loader.js";
import { startPluginServices } from "./services.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { greeting: { type: "string" } },
};
const tempDirs: string[] = [];

function pluginDir(id: string): string {
  const dir = path.join(os.tmpdir(), `kolo-host-${id}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "KoLo.plugin.json"),
    JSON.stringify({ id, configSchema: SCHEMA }),
  );
  tempDirs.push(dir);
  return dir;
}

/** A plugin whose observable behaviour (tool name, gateway method answer) carries a version. */
function pluginSource(
  id: string,
  version: string,
  opts: { throwOnLoad?: boolean; throwInRegister?: boolean } = {},
) {
  return `
${opts.throwOnLoad ? 'throw new Error("boom at import");' : ""}
globalThis.__hostTest ??= {};
const state = globalThis.__hostTest;
state.disposed ??= [];
state.ticks ??= 0;
export default {
  id: "${id}",
  version: "${version}",
  register(api) {
    ${opts.throwInRegister ? 'throw new Error("boom in register");' : ""}
    api.registerTool({ name: "${id}_tool_${version}", description: "t", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) }, { name: "${id}_tool_${version}" });
    api.registerGatewayMethod("${id}.version", ({ respond }) => respond(true, { version: "${version}" }, undefined));
    api.registerService({ id: "${id}-svc", start: () => { state.started = (state.started ?? 0) + 1; }, stop: () => { state.stopped = (state.stopped ?? 0) + 1; } });
    api.lifecycle.setInterval(() => { state.ticks += 1; }, 5);
    api.lifecycle.onDispose(() => { state.disposed.push("onDispose-${version}"); });
    api.signals.set("${id}.version", "${version}");
  },
  dispose() { state.disposed.push("dispose-${version}"); },
};
`;
}

const prevBundledDir = process.env.KOLO_BUNDLED_PLUGINS_DIR;

beforeEach(() => {
  // Keep the repo's bundled extensions out of these registries.
  const empty = path.join(os.tmpdir(), `kolo-host-nobundle-${randomUUID()}`);
  fs.mkdirSync(empty, { recursive: true });
  tempDirs.push(empty);
  process.env.KOLO_BUNDLED_PLUGINS_DIR = empty;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete (globalThis as { __hostTest?: unknown }).__hostTest;
  if (prevBundledDir === undefined) {
    delete process.env.KOLO_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.KOLO_BUNDLED_PLUGINS_DIR = prevBundledDir;
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const testState = () => (globalThis as { __hostTest?: Record<string, unknown> }).__hostTest ?? {};

describe("plugin host", () => {
  it("reloads a plugin in place: new tool, new gateway answer, old instance disposed, services restarted", async () => {
    const dir = pluginDir("hp");
    const file = path.join(dir, "index.ts");
    fs.writeFileSync(file, pluginSource("hp", "v1"));
    const audit: AuditEvent[] = [];
    const stop = onAuditEvent((e) => audit.push(e));
    try {
      const registry = loadKoLoPlugins({
        cache: false,
        audit: true,
        config: { plugins: { load: { paths: [dir] } } },
      });
      const host = getPluginHost(registry);
      expect(host).not.toBeNull();
      const services = await startPluginServices({ registry, config: {} });
      host!.attachServices(services);
      expect(registry.plugins.find((p) => p.id === "hp")?.status).toBe("loaded");
      expect(registry.tools.map((t) => t.names[0])).toEqual(["hp_tool_v1"]);
      expect(testState().started).toBe(1);
      await sleep(30);
      const ticksBefore = testState().ticks as number;
      expect(ticksBefore).toBeGreaterThan(0);

      fs.writeFileSync(file, pluginSource("hp", "v2"));
      const result = await host!.reload("hp", { reason: "manual" });
      expect(result).toMatchObject({ id: "hp", ok: true, status: "loaded", reloads: 1 });
      expect(registry.tools.map((t) => t.names[0])).toEqual(["hp_tool_v2"]);
      expect(Object.keys(registry.gatewayHandlers)).toEqual(["hp.version"]);
      const answers: unknown[] = [];
      await registry.gatewayHandlers["hp.version"]!({
        req: { type: "req", id: "1", method: "hp.version" },
        params: {},
        client: null,
        isWebchatConnect: () => false,
        respond: (_ok, payload) => answers.push(payload),
        context: {} as never,
      } as never);
      expect(answers).toEqual([{ version: "v2" }]);
      expect(testState().disposed).toEqual(["dispose-v1", "onDispose-v1"]);
      expect(testState().stopped).toBe(1);
      expect(testState().started).toBe(2);
      // The v1 interval is gone: ticks stop growing once v2 is disposed too.
      await host!.unload("hp");
      const ticksAfterUnload = testState().ticks as number;
      await sleep(30);
      expect(testState().ticks).toBe(ticksAfterUnload);
      expect(registry.plugins.find((p) => p.id === "hp")?.status).toBe("disabled");
      expect(audit.map((e) => e.action)).toEqual([
        "plugin.loaded",
        "plugin.disposed",
        "plugin.reloaded",
        "plugin.disposed",
      ]);
      expect(audit[1]?.detail).toMatchObject({ plugin: "hp", reason: "manual" });
      await host!.dispose();
    } finally {
      stop();
    }
  });

  it("quarantines a plugin that throws on import or in register and recovers on the next reload", async () => {
    const dir = pluginDir("q");
    const file = path.join(dir, "index.ts");
    fs.writeFileSync(file, pluginSource("q", "v1", { throwOnLoad: true }));
    const audit: AuditEvent[] = [];
    const stop = onAuditEvent((e) => audit.push(e));
    try {
      const registry = loadKoLoPlugins({
        cache: false,
        audit: true,
        config: { plugins: { load: { paths: [dir] } } },
      });
      const host = getPluginHost(registry)!;
      const record = registry.plugins.find((p) => p.id === "q");
      expect(record?.status).toBe("error");
      expect(record?.error).toContain("boom at import");
      expect(host.state().find((s) => s.id === "q")).toMatchObject({
        quarantined: true,
        status: "error",
      });
      expect(audit.map((e) => e.action)).toEqual(["plugin.failed"]);

      fs.writeFileSync(file, pluginSource("q", "v2", { throwInRegister: true }));
      const r2 = await host.reload("q");
      expect(r2.ok).toBe(false);
      expect(r2.error).toContain("boom in register");
      expect(registry.tools).toEqual([]); // partial registrations stripped
      expect(Object.keys(registry.gatewayHandlers)).toEqual([]);

      fs.writeFileSync(file, pluginSource("q", "v3"));
      const r3 = await host.reload("q");
      expect(r3).toMatchObject({ ok: true, status: "loaded" });
      expect(registry.tools.map((t) => t.names[0])).toEqual(["q_tool_v3"]);
      expect(host.state().find((s) => s.id === "q")?.quarantined).toBe(false);
      await host.dispose();
    } finally {
      stop();
    }
  });

  it("applyConfig disables, re-enables and re-reads plugin config without touching other plugins", async () => {
    const dirA = pluginDir("pa");
    const dirB = pluginDir("pb");
    fs.writeFileSync(path.join(dirA, "index.ts"), pluginSource("pa", "v1"));
    fs.writeFileSync(path.join(dirB, "index.ts"), pluginSource("pb", "v1"));
    const base = { plugins: { load: { paths: [dirA, dirB] } } };
    // Cache on: applyConfig must re-key the cached registry under the new config.
    const registry = loadKoLoPlugins({ config: base });
    const host = getPluginHost(registry)!;
    expect(registry.plugins.map((p) => [p.id, p.status])).toEqual([
      ["pa", "loaded"],
      ["pb", "loaded"],
    ]);

    const disabled = await host.applyConfig({
      plugins: { ...base.plugins, entries: { pb: { enabled: false } } },
    });
    expect(disabled).toMatchObject({ reloaded: [], disabled: ["pb"], failed: [], full: false });
    expect(registry.plugins.find((p) => p.id === "pb")?.status).toBe("disabled");
    expect(registry.tools.map((t) => t.names[0])).toEqual(["pa_tool_v1"]);
    expect(testState().disposed).toEqual(["dispose-v1", "onDispose-v1"]);

    const enabled = await host.applyConfig({
      plugins: { ...base.plugins, entries: { pb: { enabled: true, config: { greeting: "hi" } } } },
    });
    expect(enabled.reloaded).toEqual(["pb"]);
    expect(registry.tools.map((t) => t.names[0]).sort()).toEqual(["pa_tool_v1", "pb_tool_v1"]);
    expect(host.state().find((s) => s.id === "pb")?.reloads).toBe(2); // disable + enable are two re-evaluations

    // A later loadKoLoPlugins with the applied config returns the same registry (cache re-keyed).
    const again = loadKoLoPlugins({
      config: {
        plugins: {
          ...base.plugins,
          entries: { pb: { enabled: true, config: { greeting: "hi" } } },
        },
      },
    });
    expect(again).toBe(registry);
    await host.dispose();
  });

  it("applyConfig with an invalid plugin config quarantines just that plugin", async () => {
    const dir = pluginDir("pc");
    fs.writeFileSync(path.join(dir, "index.ts"), pluginSource("pc", "v1"));
    const registry = loadKoLoPlugins({
      cache: false,
      config: { plugins: { load: { paths: [dir] } } },
    });
    const host = getPluginHost(registry)!;
    const result = await host.applyConfig({
      plugins: { load: { paths: [dir] }, entries: { pc: { config: { greeting: 42 } } } },
    });
    expect(result.failed).toEqual(["pc"]);
    expect(registry.plugins.find((p) => p.id === "pc")?.error).toContain("invalid config");
    await host.dispose();
  });

  it("watches plugin directories and reloads on file change (debounced)", async () => {
    const dir = pluginDir("pw");
    const file = path.join(dir, "index.ts");
    fs.writeFileSync(file, pluginSource("pw", "v1"));
    const registry = loadKoLoPlugins({
      cache: false,
      config: { plugins: { load: { paths: [dir] } } },
    });
    const host = getPluginHost(registry)!;
    const stopWatch = host.watch({ debounceMs: 100 });
    expect(host.hasWatcher()).toBe(true);
    expect(host.state().find((s) => s.id === "pw")?.watched).toBe(true);
    await sleep(300); // chokidar ready
    fs.writeFileSync(file, pluginSource("pw", "v2"));
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && registry.tools[0]?.names[0] !== "pw_tool_v2") {
      await sleep(100);
    }
    expect(registry.tools.map((t) => t.names[0])).toEqual(["pw_tool_v2"]);
    expect(host.state().find((s) => s.id === "pw")?.reloads).toBe(1);
    await stopWatch();
    expect(host.hasWatcher()).toBe(false);
    await host.dispose();
  });

  it("hot reload settings come from plugins.hotReload", async () => {
    const dir = pluginDir("ps");
    fs.writeFileSync(path.join(dir, "index.ts"), pluginSource("ps", "v1"));
    const off = loadKoLoPlugins({
      cache: false,
      config: { plugins: { load: { paths: [dir] }, hotReload: false } },
    });
    expect(getPluginHost(off)!.settings()).toEqual({
      enabled: false,
      watch: false,
      debounceMs: 400,
    });
    const tuned = loadKoLoPlugins({
      cache: false,
      config: { plugins: { load: { paths: [dir] }, hotReload: { watch: false, debounceMs: 50 } } },
    });
    expect(getPluginHost(tuned)!.settings()).toEqual({
      enabled: true,
      watch: false,
      debounceMs: 50,
    });
    await getPluginHost(off)!.dispose();
    await getPluginHost(tuned)!.dispose();
  });
});
