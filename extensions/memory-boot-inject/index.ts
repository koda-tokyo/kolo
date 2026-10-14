/**
 * Memory boot inject (KoLo 2.0, M7). Off by default.
 *
 * On the first agent turn of each session after a gateway start (`once: true`, the default) the
 * configured files are read and prepended to the prompt through the `before_agent_start` hook
 * (`prependContext`). Paths may use `~`; relative paths resolve against the state root. Each file
 * is capped at `maxBytesPerFile` (tail kept: the newest entries of a diary matter most) and the
 * whole block at `maxTotalBytes`. Missing files are listed, not fatal. A `gateway_start` hook
 * resets the per-session bookkeeping, so a restarted gateway injects again.
 */
import fs from "node:fs";
import path from "node:path";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

export type BootInjectConfig = {
  files: string[];
  maxBytesPerFile: number;
  maxTotalBytes: number;
  agents: string[] | null;
  once: boolean;
  header: string;
};

export function resolveBootInjectConfig(raw: Record<string, unknown> | undefined): BootInjectConfig {
  const cfg = raw ?? {};
  const int = (key: string, fallback: number, min: number) => {
    const v = cfg[key];
    return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
  };
  const files = Array.isArray(cfg.files)
    ? (cfg.files as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
  const agents = Array.isArray(cfg.agents)
    ? (cfg.agents as unknown[]).filter((v): v is string => typeof v === "string")
    : null;
  return {
    files,
    maxBytesPerFile: int("maxBytesPerFile", 16_384, 256),
    maxTotalBytes: int("maxTotalBytes", 65_536, 256),
    agents: agents && agents.length > 0 ? agents : null,
    once: cfg.once !== false,
    header: typeof cfg.header === "string" ? cfg.header : "Boot context (injected by memory-boot-inject):",
  };
}

export type BootFile = { path: string; content: string | null };

/** Keeps the tail of a text within `max` bytes, with a marker when cut. */
export function tailBytes(text: string, max: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.byteLength <= max) {
    return text;
  }
  const marker = "[...truncated...]\n";
  const keep = Math.max(0, max - Buffer.byteLength(marker, "utf-8"));
  return marker + buf.subarray(buf.byteLength - keep).toString("utf-8");
}

/** Pure: files → one context block (or "" when nothing could be read). */
export function buildBootContext(files: BootFile[], cfg: BootInjectConfig): string {
  const parts: string[] = [];
  const missing: string[] = [];
  let used = 0;
  for (const file of files) {
    if (file.content === null) {
      missing.push(file.path);
      continue;
    }
    const body = tailBytes(file.content.trimEnd(), cfg.maxBytesPerFile);
    const block = `--- ${path.basename(file.path)} (${file.path}) ---\n${body}\n`;
    const size = Buffer.byteLength(block, "utf-8");
    if (used + size > cfg.maxTotalBytes) {
      const room = cfg.maxTotalBytes - used;
      if (room > 200) {
        parts.push(`--- ${path.basename(file.path)} (${file.path}) ---\n${tailBytes(body, room - 100)}\n`);
      }
      missing.push(`${file.path} (over total budget)`);
      used = cfg.maxTotalBytes;
      continue;
    }
    used += size;
    parts.push(block);
  }
  if (parts.length === 0 && missing.length === 0) {
    return "";
  }
  const lines = [cfg.header, ...parts];
  if (missing.length > 0) {
    lines.push(`(not injected: ${missing.join(", ")})`);
  }
  return lines.join("\n");
}

export function readBootFiles(files: string[], resolve: (p: string) => string): BootFile[] {
  return files.map((file) => {
    const resolved = resolve(file);
    try {
      return { path: resolved, content: fs.readFileSync(resolved, "utf-8") };
    } catch {
      return { path: resolved, content: null };
    }
  });
}

export function createBootInjector(api: KoLoPluginApi, read: typeof readBootFiles = readBootFiles) {
  const cfg = resolveBootInjectConfig(api.pluginConfig);
  const injected = new Set<string>();
  const resolve = (p: string) => {
    const expanded = api.resolvePath(p);
    return path.isAbsolute(expanded) ? expanded : path.join(api.paths.stateDir, expanded);
  };
  const shouldInject = (ctx: { agentId?: string; sessionKey?: string }): boolean => {
    if (cfg.files.length === 0) {
      return false;
    }
    if (cfg.agents && (!ctx.agentId || !cfg.agents.includes(ctx.agentId))) {
      return false;
    }
    const key = ctx.sessionKey ?? ctx.agentId ?? "default";
    if (cfg.once && injected.has(key)) {
      return false;
    }
    return true;
  };
  const inject = (ctx: { agentId?: string; sessionKey?: string }): string | null => {
    if (!shouldInject(ctx)) {
      return null;
    }
    const key = ctx.sessionKey ?? ctx.agentId ?? "default";
    const files = read(cfg.files, resolve);
    const context = buildBootContext(files, cfg);
    if (!context) {
      return null;
    }
    injected.add(key);
    api.audit({
      action: "memory.boot_injected",
      scope: ctx.sessionKey,
      identity: ctx.agentId,
      detail: {
        files: files.map((f) => ({ path: f.path, ok: f.content !== null })),
        bytes: Buffer.byteLength(context, "utf-8"),
      },
    });
    return context;
  };
  return { cfg, inject, reset: () => injected.clear(), injected };
}

const memoryBootInjectPlugin = {
  id: "memory-boot-inject",
  name: "Memory Boot Inject",
  description: "Prepends configured files to the first agent turn after a gateway start",
  register(api: KoLoPluginApi) {
    const injector = createBootInjector(api);
    if (injector.cfg.files.length === 0) {
      api.logger.warn("[memory-boot-inject] no files configured; nothing will be injected");
    }
    api.on("gateway_start", () => {
      injector.reset();
    });
    api.on("before_agent_start", (_event, ctx) => {
      const context = injector.inject(ctx);
      return context ? { prependContext: context } : undefined;
    });
  },
};

export default memoryBootInjectPlugin;
