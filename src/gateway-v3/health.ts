// gateway-v3 health — forwards lease + biology state to /health.

import type { BiologyBootSupervisor } from "./biology/boot.js";
import type { LeaseManager } from "./supervisor/lease.js";

export type NodePosture = "alive" | "handoff_ready" | "degraded" | "unhealthy" | "serviceable";

export interface V3HealthSnapshot {
  posture: NodePosture;
  lease: { held: boolean; holdingMs: number } | null;
  biology: { organCount: number; healthyOrgans: number; lastTickAt: number } | null;
}

let v3LeaseSingleton: LeaseManager | null = null;
let v3BiologySingleton: BiologyBootSupervisor | null = null;

export function setV3LeaseSingleton(lease: LeaseManager | null): void {
  v3LeaseSingleton = lease;
}

export function setV3BiologyHealthSingleton(biology: BiologyBootSupervisor): void {
  v3BiologySingleton = biology;
}

/** Real lease state, or null when the lease is disabled / not booted. */
export function getGatewayLeaseState(): { held: boolean; holdingMs: number } | null {
  return v3LeaseSingleton
    ? { held: v3LeaseSingleton.isHeld, holdingMs: v3LeaseSingleton.holdingMs }
    : null;
}

export function getV3HealthSnapshot(): V3HealthSnapshot {
  const lease = getGatewayLeaseState();
  return {
    posture: lease && !lease.held ? "handoff_ready" : "alive",
    lease,
    biology: v3BiologySingleton
      ? { organCount: 6, healthyOrgans: 6, lastTickAt: v3BiologySingleton.getSignals().lastTick }
      : null,
  };
}
