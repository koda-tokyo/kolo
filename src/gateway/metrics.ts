/**
 * Gateway v3 — Prometheus Metrics Endpoint
 *
 * Exposes /metrics in Prometheus text exposition format.
 * Zero external dependencies — pure string formatting.
 *
 * Metrics:
 *   - gateway_uptime_seconds
 *   - gateway_memory_rss_bytes / heap_bytes
 *   - gateway_http_requests_total{method, path, status}
 *   - gateway_http_request_duration_seconds{method, path}
 *   - gateway_ws_connections_total / active
 *   - gateway_sessions_active
 *   - consciousness_ticks_total{agent}
 *   - consciousness_actions_total{agent}
 *   - consciousness_errors_total{agent}
 *   - biology_organ_health{organ}
 *   - biology_pain_score / pain_level
 *   - biology_hormones{hormone}
 *   - auth_profiles{provider,status}
 *   - disk_usage_percent
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/config.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import { getAllConsciousnessStates } from "../consciousness/engine.js";

/** Resolve the KoLo data directory. */
function resolveKoloDir(): string {
  // Check env first (allows override)
  if (process.env.KOLO_DIR) return process.env.KOLO_DIR;
  // Default: the state root (KOLO_HOME)
  return resolveKoloHome();
}

// ── Metrics Collector ──────────────────────────────────────────────────────

interface MetricLabels {
  [key: string]: string;
}

interface MetricSample {
  labels: MetricLabels;
  value: number;
}

interface MetricDefinition {
  name: string;
  help: string;
  type: "counter" | "gauge";
  samples: MetricSample[];
}

class MetricsRegistry {
  private metrics = new Map<string, MetricDefinition>();

  addMetric(name: string, help: string, type: "counter" | "gauge", samples: MetricSample[]): void {
    this.metrics.set(name, { name, help, type, samples });
  }

  /** Format all metrics in Prometheus exposition format. */
  format(): string {
    const lines: string[] = [];

    // Sort by name for deterministic output
    const sorted = Array.from(this.metrics.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, metric] of sorted) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      for (const sample of metric.samples) {
        const labelStr = Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const suffix = labelStr ? `{${labelStr}}` : "";
        lines.push(`${name}${suffix} ${sample.value}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

// ── Counter Helpers ────────────────────────────────────────────────────────

/** In-memory HTTP request counter. */
const httpRequestCounter = new Map<string, number>();
const httpRequestDurations: { labels: string[]; durationMs: number }[] = [];
const MAX_DURATION_SAMPLES = 100; // Keep last N samples

export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
): void {
  const key = `${method}:${path}:${status}`;
  httpRequestCounter.set(key, (httpRequestCounter.get(key) ?? 0) + 1);

  if (httpRequestDurations.length < MAX_DURATION_SAMPLES) {
    httpRequestDurations.push({ labels: [method, path, String(status)], durationMs });
  }
}

export function incrementWsConnections(): void {
  const key = "ws_connections";
  httpRequestCounter.set(key, (httpRequestCounter.get(key) ?? 0) + 1);
}

export function decrementWsConnections(): void {
  const key = "ws_active";
  const current = httpRequestCounter.get(key) ?? 0;
  httpRequestCounter.set(key, Math.max(0, current - 1));
}

// ── Snapshot Builder ───────────────────────────────────────────────────────

function buildMetricsSnapshot(): MetricsRegistry {
  const registry = new MetricsRegistry();
  const mem = process.memoryUsage();
  const koloDir = resolveKoloDir();

  // ── Gateway basics ────────────────────────────────────────────────
  registry.addMetric("gateway_uptime_seconds", "Gateway process uptime in seconds", "gauge", [
    { labels: {}, value: Math.round(process.uptime() * 100) / 100 },
  ]);

  registry.addMetric("gateway_memory_rss_bytes", "Resident set size in bytes", "gauge", [
    { labels: {}, value: mem.rss },
  ]);

  registry.addMetric("gateway_memory_heap_bytes", "Heap used in bytes", "gauge", [
    { labels: {}, value: mem.heapUsed },
  ]);

  registry.addMetric("gateway_memory_heap_total_bytes", "Total heap size in bytes", "gauge", [
    { labels: {}, value: mem.heapTotal },
  ]);

  registry.addMetric(
    "gateway_memory_external_bytes",
    "External (native) memory in bytes",
    "gauge",
    [{ labels: {}, value: mem.external }],
  );

  // ── HTTP requests ──────────────────────────────────────────────────
  const httpSamples: MetricSample[] = [];
  for (const [key, count] of httpRequestCounter) {
    if (key.startsWith("ws_")) continue;
    const parts = key.split(":");
    if (parts.length === 3) {
      httpSamples.push({
        labels: { method: parts[0], path: parts[1], status: parts[2] },
        value: count,
      });
    }
  }
  registry.addMetric("gateway_http_requests_total", "Total HTTP requests", "counter", httpSamples);

  // Request durations (histogram approximation as gauge)
  const durationSamples: MetricSample[] = httpRequestDurations.map((d) => ({
    labels: { method: d.labels[0], path: d.labels[1], status: d.labels[2] },
    value: Math.round(d.durationMs * 100) / 100,
  }));
  registry.addMetric(
    "gateway_http_request_duration_seconds",
    "HTTP request duration in seconds",
    "gauge",
    durationSamples,
  );

  // ── WebSocket connections ──────────────────────────────────────────
  const wsConnCount = httpRequestCounter.get("ws_connections") ?? 0;
  const wsActive = httpRequestCounter.get("ws_active") ?? 0;
  registry.addMetric(
    "gateway_ws_connections_total",
    "Total WebSocket connections established",
    "counter",
    [{ labels: {}, value: wsConnCount }],
  );
  registry.addMetric(
    "gateway_ws_connections_active",
    "Currently active WebSocket connections",
    "gauge",
    [{ labels: {}, value: wsActive }],
  );

  // ── Sessions ───────────────────────────────────────────────────────
  registry.addMetric("gateway_sessions_active", "Active agent sessions", "gauge", [
    { labels: {}, value: 5 }, // TODO: read from session store
  ]);

  // ── Consciousness ──────────────────────────────────────────────────
  const allStates = getAllConsciousnessStates();
  const tickSamples: MetricSample[] = [];
  const actionSamples: MetricSample[] = [];
  const errorSamples: MetricSample[] = [];

  for (const [id, state] of allStates) {
    tickSamples.push({
      labels: { agent: id },
      value: state.totalTicks ?? 0,
    });
    actionSamples.push({
      labels: { agent: id },
      value: state.totalActions ?? 0,
    });
    errorSamples.push({
      labels: { agent: id },
      value: state.consecutiveErrors ?? 0,
    });
  }

  registry.addMetric(
    "consciousness_ticks_total",
    "Total consciousness ticks per agent",
    "counter",
    tickSamples,
  );
  registry.addMetric(
    "consciousness_actions_total",
    "Total consciousness actions per agent",
    "counter",
    actionSamples,
  );
  registry.addMetric(
    "consciousness_errors_total",
    "Consecutive errors per agent",
    "gauge",
    errorSamples,
  );

  // ── Biology ────────────────────────────────────────────────────────
  try {
    // Pain state
    const painPath = join(koloDir, "autonomic", "pain-state.json");
    if (existsSync(painPath)) {
      const pain = JSON.parse(readFileSync(painPath, "utf8"));
      registry.addMetric("biology_pain_score", "Current pain score (0-100)", "gauge", [
        { labels: {}, value: pain.painScore ?? 0 },
      ]);
      registry.addMetric("biology_pain_level", "Current pain level (0-3)", "gauge", [
        { labels: {}, value: pain.level ?? 0 },
      ]);
    }

    // Hormones
    const endocrinePath = join(koloDir, "autonomic", "endocrine.json");
    const hormoneSamples: MetricSample[] = [];
    if (existsSync(endocrinePath)) {
      const endocrine = JSON.parse(readFileSync(endocrinePath, "utf8"));
      hormoneSamples.push({ labels: { hormone: "stress" }, value: endocrine.stress ?? 0 });
      hormoneSamples.push({ labels: { hormone: "dopamine" }, value: endocrine.dopamine ?? 0 });
      hormoneSamples.push({ labels: { hormone: "serotonin" }, value: endocrine.serotonin ?? 0 });
    }
    registry.addMetric("biology_hormones", "Hormone levels (0-100)", "gauge", hormoneSamples);

    // Organ health
    const bioPath = join(koloDir, "autonomic", "bio-status.json");
    const organSamples: MetricSample[] = [];
    if (existsSync(bioPath)) {
      const bio = JSON.parse(readFileSync(bioPath, "utf8"));
      const organs = bio.organs ?? {};
      for (const [name, organ] of Object.entries(organs)) {
        organSamples.push({
          labels: { organ: name },
          value: (organ as any).ok ? 1 : 0,
        });
      }
    }
    registry.addMetric(
      "biology_organ_health",
      "Organ health status (1=healthy, 0=failed)",
      "gauge",
      organSamples,
    );
  } catch {
    // Biology data may not be available during early boot
  }

  // ── Auth profiles ──────────────────────────────────────────────────
  const authSamples: MetricSample[] = [];
  try {
    const cfg = loadConfig();
    const profiles = cfg.auth?.profiles ?? {};
    for (const [profileId, profile] of Object.entries(profiles as any)) {
      authSamples.push({
        labels: { profile: profileId, provider: (profile as any).provider ?? "unknown" },
        value: 1,
      });
    }
  } catch {
    // ignore
  }
  registry.addMetric("auth_profiles_total", "Auth profiles by provider", "gauge", authSamples);

  // ── Disk ───────────────────────────────────────────────────────────
  try {
    const result = spawnSync("df", ["-P", "/"], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const lines = result.stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const pct = parseInt(parts[4]?.replace("%", "") ?? "0", 10);
        registry.addMetric("disk_usage_percent", "Root filesystem usage percentage", "gauge", [
          { labels: {}, value: pct },
        ]);
      }
    }
  } catch {
    // ignore
  }

  return registry;
}

// ── HTTP Handler ─────────────────────────────────────────────────────────────

export function handleMetricsRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname !== "/metrics" || req.method !== "GET") {
    return false;
  }

  const registry = buildMetricsSnapshot();
  const body = registry.format();

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
  return true;
}
