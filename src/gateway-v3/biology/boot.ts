// gateway-v3 biology boot interface
// Type-only — the real implementation is in biology/index.ts

import type { BiologySignals } from "../routing/types.js";

export interface BiologyBootSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  shutdown(): Promise<void>;
  getSignals(): BiologySignals;
  readonly running: boolean;
}
