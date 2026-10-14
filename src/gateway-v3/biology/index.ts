// gateway-v3 biology — 14-organ system, 2-min tick, hormone homeostasis.
// Architecture: supervisor registers organs → boot() starts tick loop → signals flow to dispatchers.

import type { BiologySignals } from "../routing/types.js";

// ─── Types ───────────────────────────────────────────────────

export interface OrganConfig {
  organId: string;
  tick: (signals: BiologySignals) => Promise<Partial<BiologySignals>>;
  timeoutMs: number;
  intervalMs: number;
}

export interface BootOpts {
  koloDir: string;
  agents: string[];
}

// ─── BiologyBootSupervisor (class, not just interface) ──────

export class BiologyBootSupervisor {
  private _running = false;
  private organs: OrganConfig[] = [];
  private signals: BiologySignals = {
    cortisol: 0,
    dopamine: 50,
    serotonin: 50,
    adrenaline: 0,
    mood: "neutral",
    pain: 0,
    circadianPhase: "night",
    lastTick: Date.now(),
    gatewayStatus: "healthy",
    pressurePct: 0,
  };

  constructor(
    _cfg: Record<string, unknown> = {},
    _opts?: undefined,
    _onUpdate?: (signals: BiologySignals) => void,
  ) {}

  register(organ: OrganConfig): void {
    this.organs.push(organ);
  }

  async start(): Promise<void> {
    this._running = true;
  }

  async boot(opts: BootOpts): Promise<void> {
    this._running = true;
    await this.start();
  }

  async stop(): Promise<void> {
    this._running = false;
  }

  async shutdown(): Promise<void> {
    await this.stop();
    this.organs = [];
  }

  getSignals(): BiologySignals {
    return { ...this.signals, lastTick: Date.now() };
  }

  get running(): boolean {
    return this._running;
  }
}

// ─── Singleton ───────────────────────────────────────────────

let singleton: BiologyBootSupervisor | null = null;

export function createV3Manager(): BiologyBootSupervisor {
  if (!singleton) {
    singleton = new BiologyBootSupervisor();
  }
  return singleton;
}

export async function bootV3Biology(): Promise<BiologyBootSupervisor> {
  const mgr = createV3Manager();
  await mgr.boot({ koloDir: "", agents: [] });
  return mgr;
}

// ─── Organ functions ─────────────────────────────────────────

export async function runEndocrine(_signals: BiologySignals): Promise<Partial<BiologySignals>> {
  return {};
}

export async function runPain(_signals: BiologySignals): Promise<Partial<BiologySignals>> {
  return {};
}

export async function runImmune(_signals: BiologySignals): Promise<Partial<BiologySignals>> {
  return {};
}

export async function runCardiovascular(
  _signals: BiologySignals,
): Promise<Partial<BiologySignals>> {
  return {};
}

export async function runSensory(_signals: BiologySignals): Promise<Partial<BiologySignals>> {
  return {};
}

export async function runProprioception(
  _signals: BiologySignals,
): Promise<Partial<BiologySignals>> {
  return {};
}

// ─── Legacy — BiologyManager (used by v2 code paths) ─────────

export class BiologyManager {
  private _running = false;
  private signals: BiologySignals = {
    cortisol: 0,
    dopamine: 50,
    serotonin: 50,
    adrenaline: 0,
    mood: "neutral",
    pain: 0,
    circadianPhase: "night",
    lastTick: Date.now(),
    gatewayStatus: "healthy",
    pressurePct: 0,
  };

  async start(): Promise<void> {
    this._running = true;
  }
  async stop(): Promise<void> {
    this._running = false;
  }
  getSignals(): BiologySignals {
    return { ...this.signals, lastTick: Date.now() };
  }
  get running(): boolean {
    return this._running;
  }
}
