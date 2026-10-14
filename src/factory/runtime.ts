// Process-wide factory runner (KoLo 2.0, M15c): the gateway creates one on first use and closes
// it on shutdown. Nothing runs at import time; the CLI never calls this module.
import type { KoLoConfig } from "../config/config.js";
import { FactoryRunner, type FactoryRunnerOptions } from "./runner.js";
import { configureFactoryStore } from "./store.js";

let runner: FactoryRunner | null = null;

export function getFactoryRunner(opts: FactoryRunnerOptions): FactoryRunner {
  if (!runner) {
    const factory = opts.getConfig().factory;
    configureFactoryStore({ maxTimelineEntries: factory?.maxTimelineEntries, env: opts.env });
    runner = new FactoryRunner(opts);
  }
  return runner;
}

export function factoryEnabled(config: KoLoConfig): boolean {
  return config.factory?.enabled !== false;
}

export async function closeFactoryRunner(): Promise<void> {
  const current = runner;
  runner = null;
  await current?.close();
}

/** Test helper. */
export function __resetFactoryRuntimeForTest(): void {
  runner = null;
}
