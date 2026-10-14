import type { KoLoConfig } from "../config/config.js";
import type { PluginRegistry, PluginServiceRegistration } from "./registry.js";
import type { KoLoPluginServiceContext } from "./types.js";
import { STATE_DIR } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("plugins");

export type PluginServicesHandle = {
  stop: () => Promise<void>;
  /** M7: start the services one plugin registered (after a reload / enable). */
  startPlugin: (pluginId: string) => Promise<void>;
  /** M7: stop the running services of one plugin (before a reload / disable). */
  stopPlugin: (pluginId: string) => Promise<void>;
  /** Ids of the services currently running, by plugin. */
  running: () => Record<string, string[]>;
};

type RunningService = {
  pluginId: string;
  id: string;
  stop?: () => void | Promise<void>;
};

function serviceContext(params: {
  config: KoLoConfig;
  workspaceDir?: string;
}): KoLoPluginServiceContext {
  return {
    config: params.config,
    workspaceDir: params.workspaceDir,
    stateDir: STATE_DIR,
    logger: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
      debug: (msg) => log.debug(msg),
    },
  };
}

export async function startPluginServices(params: {
  registry: PluginRegistry;
  config: KoLoConfig;
  workspaceDir?: string;
}): Promise<PluginServicesHandle> {
  const running: RunningService[] = [];
  let config = params.config;

  const startOne = async (entry: PluginServiceRegistration) => {
    const service = entry.service;
    const ctx = serviceContext({ config, workspaceDir: params.workspaceDir });
    try {
      await service.start(ctx);
      running.push({
        pluginId: entry.pluginId,
        id: service.id,
        stop: service.stop ? () => service.stop?.(ctx) : undefined,
      });
    } catch (err) {
      log.error(`plugin service failed (${service.id}): ${String(err)}`);
    }
  };

  const stopOne = async (entry: RunningService) => {
    if (!entry.stop) {
      return;
    }
    try {
      await entry.stop();
    } catch (err) {
      log.warn(`plugin service stop failed (${entry.id}): ${String(err)}`);
    }
  };

  for (const entry of params.registry.services) {
    await startOne(entry);
  }

  return {
    stop: async () => {
      for (const entry of running.splice(0).toReversed()) {
        await stopOne(entry);
      }
    },
    startPlugin: async (pluginId) => {
      config = params.config;
      for (const entry of params.registry.services) {
        if (entry.pluginId !== pluginId) {
          continue;
        }
        if (running.some((r) => r.pluginId === pluginId && r.id === entry.service.id)) {
          continue;
        }
        await startOne(entry);
      }
    },
    stopPlugin: async (pluginId) => {
      const mine = running.filter((entry) => entry.pluginId === pluginId);
      for (const entry of mine.toReversed()) {
        const index = running.indexOf(entry);
        if (index >= 0) {
          running.splice(index, 1);
        }
        await stopOne(entry);
      }
    },
    running: () => {
      const out: Record<string, string[]> = {};
      for (const entry of running) {
        (out[entry.pluginId] ??= []).push(entry.id);
      }
      return out;
    },
  };
}
