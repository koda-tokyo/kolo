// src/cron/sentinel-job.ts
//
// Cron job definition for SENTINEL nightly aggregation pipeline.
// Wires into the existing CronService as a system event.
//
// Schedule: nightly at 02:00 UTC (after market close, before Asian open)
// Cron expression: 0 2 * * *

import type { CronJobCreate } from "./types.js";

export function createSentinelNightlyJob(): CronJobCreate {
  return {
    name: "SENTINEL Nightly Ingestion & Aggregation",
    description:
      "Pulls Polymarket CMA + Kalshi API data → E: drive raw JSONL → aggregates daily signals → pushes to Supabase signal_snapshots",
    enabled: true,
    deleteAfterRun: false,
    schedule: {
      kind: "cron" as const,
      expr: "0 2 * * *",
      tz: "UTC",
    },
    sessionTarget: "isolated" as const,
    wakeMode: "now" as const,
    payload: {
      kind: "systemEvent" as const,
      text: "sentinel:nightly-run",
    },
    isolation: {
      postToMainMode: "summary",
    },
  };
}
