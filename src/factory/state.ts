// Factory state machine (KoLo 2.0, M15a): which column moves are legal, and where an engine task
// status lands a card. Pure functions; the store applies and audits them.
import {
  FACTORY_COLUMNS,
  FACTORY_TERMINAL_COLUMNS,
  FACTORY_TRANSITIONS,
  type FactoryColumn,
} from "./types.js";

export class FactoryTransitionError extends Error {
  constructor(
    readonly from: FactoryColumn,
    readonly to: FactoryColumn,
  ) {
    super(
      FACTORY_TERMINAL_COLUMNS.has(from)
        ? `card is ${from}; it cannot move`
        : `cannot move a card from ${from} to ${to} (allowed: ${FACTORY_TRANSITIONS[from].join(", ") || "none"})`,
    );
    this.name = "FactoryTransitionError";
  }
}

export function canTransition(from: FactoryColumn, to: FactoryColumn): boolean {
  return from !== to && FACTORY_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: FactoryColumn, to: FactoryColumn): void {
  if (!canTransition(from, to)) {
    throw new FactoryTransitionError(from, to);
  }
}

export function parseColumn(raw: unknown): FactoryColumn | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  return (FACTORY_COLUMNS as readonly string[]).includes(value) ? (value as FactoryColumn) : null;
}

/**
 * Column an engine task status maps to. `created` is the inbox (nothing ran yet); the spec
 * phase is "spec"; planning, coding and merging are "build"; QA is "review"; ready_to_merge is
 * "ready"; merged and failed/cancelled are the terminal columns. Unknown statuses map to null.
 */
export function columnForEngineStatus(status: string): FactoryColumn | null {
  switch (status) {
    case "created":
    case "queued":
      return "inbox";
    case "spec":
      return "spec";
    case "planning":
    case "coding":
    case "running":
    case "merging":
      return "build";
    case "qa":
      return "review";
    case "ready":
    case "ready_to_merge":
    case "completed":
      return "ready";
    case "merged":
      return "merged";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return null;
  }
}

/**
 * Shortest legal path from one column to another, following forward edges only (used by the
 * runner so an engine that jumps from "spec" straight to "qa" still leaves an audited trail).
 * Returns [] when `to` is not reachable forward from `from`.
 */
export function pathTo(from: FactoryColumn, to: FactoryColumn): FactoryColumn[] {
  if (from === to) {
    return [];
  }
  const order: FactoryColumn[] = ["inbox", "spec", "build", "review", "ready", "merged"];
  if (to === "failed") {
    return canTransition(from, "failed") ? ["failed"] : [];
  }
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0 || end <= start) {
    return [];
  }
  return order.slice(start + 1, end + 1);
}
