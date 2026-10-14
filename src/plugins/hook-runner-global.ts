/**
 * Global Plugin Hook Runner
 *
 * Singleton hook runner that's initialized when plugins are loaded
 * and can be called from anywhere in the codebase.
 */

import type { PluginRegistry } from "./registry.js";
import type {
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
} from "./types.js";
import { createIntegrityWritePolicy } from "../integrity/write-policy.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createHookRunner, type HookRunner } from "./hooks.js";

const log = createSubsystemLogger("plugins");

let globalHookRunner: HookRunner | null = null;
let globalRegistry: PluginRegistry | null = null;

/**
 * Initialize the global hook runner with a plugin registry.
 * Called once when plugins are loaded during gateway startup.
 */
export function initializeGlobalHookRunner(registry: PluginRegistry): void {
  globalRegistry = registry;
  globalHookRunner = createHookRunner(registry, {
    logger: {
      debug: (msg) => log.debug(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    },
    catchErrors: true,
  });

  const hookCount = registry.hooks.length;
  if (hookCount > 0) {
    log.info(`hook runner initialized with ${hookCount} registered hooks`);
  }
}

// ── Core before_tool_call policies (KoLo 2.0, M2b) ──────────────────────────
// Core policies (integrity write-refusal) are not plugins: they run AFTER every plugin hook, on
// the params the plugins produced, cannot be overridden by a later `block: false`, and fail
// closed (a throwing policy blocks the call). They apply even when no plugin is loaded.

export type CoreBeforeToolCallPolicy = (
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext,
) =>
  | Promise<PluginHookBeforeToolCallResult | undefined>
  | PluginHookBeforeToolCallResult
  | undefined;

const corePolicies = new Map<string, CoreBeforeToolCallPolicy>();
let emptyRunner: HookRunner | null = null;

function emptyRegistry(): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}

/** Register (or replace) a core policy by id. Returns an unregister function. */
export function registerCoreBeforeToolCallPolicy(
  id: string,
  policy: CoreBeforeToolCallPolicy,
): () => void {
  corePolicies.set(id, policy);
  return () => {
    if (corePolicies.get(id) === policy) {
      corePolicies.delete(id);
    }
  };
}

// Always on: agent tools may not write registered constitution files, the integrity registry or
// its key, or the audit log (src/integrity/write-policy.ts).
registerCoreBeforeToolCallPolicy("integrity.write", createIntegrityWritePolicy());

function withCorePolicies(base: HookRunner): HookRunner {
  return {
    ...base,
    hasHooks: (name) => name === "before_tool_call" || base.hasHooks(name),
    runBeforeToolCall: async (event, ctx) => {
      const pluginResult = base.hasHooks("before_tool_call")
        ? await base.runBeforeToolCall(event, ctx)
        : undefined;
      if (pluginResult?.block) {
        return pluginResult;
      }
      const params = pluginResult?.params
        ? { ...event.params, ...pluginResult.params }
        : event.params;
      for (const [id, policy] of corePolicies) {
        let verdict: PluginHookBeforeToolCallResult | undefined;
        try {
          verdict = await policy({ ...event, params }, ctx);
        } catch (err) {
          log.error(`core policy ${id} failed; blocking ${event.toolName}: ${String(err)}`);
          return { block: true, blockReason: `Tool call blocked: core policy ${id} failed` };
        }
        if (verdict?.block) {
          return { ...pluginResult, block: true, blockReason: verdict.blockReason };
        }
      }
      return pluginResult;
    },
  };
}

/**
 * Get the global hook runner.
 * Returns null if plugins haven't been loaded yet and no core policy is registered.
 */
export function getGlobalHookRunner(): HookRunner | null {
  if (corePolicies.size === 0) {
    return globalHookRunner;
  }
  const base = globalHookRunner ?? (emptyRunner ??= createHookRunner(emptyRegistry()));
  return withCorePolicies(base);
}

/**
 * Get the global plugin registry.
 * Returns null if plugins haven't been loaded yet.
 */
export function getGlobalPluginRegistry(): PluginRegistry | null {
  return globalRegistry;
}

/**
 * Check if any hooks are registered for a given hook name.
 */
export function hasGlobalHooks(hookName: Parameters<HookRunner["hasHooks"]>[0]): boolean {
  return getGlobalHookRunner()?.hasHooks(hookName) ?? false;
}

/**
 * Reset the global hook runner (for testing).
 */
export function resetGlobalHookRunner(): void {
  globalHookRunner = null;
  globalRegistry = null;
}
