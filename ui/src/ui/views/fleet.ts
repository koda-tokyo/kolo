/**
 * Fleet view — single-pane fleet-wide monitoring.
 * Renders gate health cards, PM2 process table, disk, backup, and OAuth status.
 * Uses FleetState from controllers/fleet.ts
 *
 */

import { html, nothing } from "lit";
import type { FleetState, GateCard, Pm2Process } from "../controllers/fleet";
import { loadFleet } from "../controllers/fleet";

export type FleetViewProps = {
  state: FleetState;
  onRefresh: () => void;
};

// ── Status helpers ────────────────────────────────────────────────────────────

function statusColor(status: GateCard["status"]): string {
  switch (status) {
    case "ok":
      return "var(--green, #22c55e)";
    case "degraded":
      return "var(--yellow, #eab308)";
    case "down":
      return "var(--red, #ef4444)";
    case "known-down":
      return "var(--muted, #6b7280)";
    default:
      return "var(--muted, #6b7280)";
  }
}

function statusEmoji(status: GateCard["status"]): string {
  switch (status) {
    case "ok":
      return "●";
    case "degraded":
      return "◐";
    case "down":
      return "○";
    case "known-down":
      return "◇";
  }
}

function pm2StatusBadge(status: Pm2Process["status"]) {
  const map: Record<Pm2Process["status"], { cls: string; label: string }> = {
    online: { cls: "badge--green", label: "online" },
    stopped: { cls: "badge--yellow", label: "stopped" },
    errored: { cls: "badge--red", label: "errored" },
  };
  const b = map[status] ?? { cls: "badge--muted", label: String(status) };
  return html`<span class="badge ${b.cls}">${b.label}</span>`;
}

function formatUptime(uptime: string): string {
  if (!uptime || uptime === "—") return "—";
  return uptime;
}

// ── Gate card ─────────────────────────────────────────────────────────────────

function renderGateCard(gate: GateCard) {
  return html`
    <div class="fleet-gate-card" style="border-left: 3px solid ${statusColor(gate.status)}">
      <div class="fleet-gate-card__header">
        <span
          class="fleet-gate-card__status"
          style="color: ${statusColor(gate.status)}"
        >${statusEmoji(gate.status)}</span>
        <span class="fleet-gate-card__name">${gate.name}</span>
      </div>
      <div class="fleet-gate-card__body">
        <div class="fleet-gate-card__stat">
          <span class="fleet-gate-card__stat-label">Uptime</span>
          <span class="fleet-gate-card__stat-value">${formatUptime(gate.uptime)}</span>
        </div>
        <div class="fleet-gate-card__stat">
          <span class="fleet-gate-card__stat-label">Port</span>
          <span class="fleet-gate-card__stat-value">:${gate.port}</span>
        </div>
      </div>
    </div>
  `;
}

// ── PM2 process row ───────────────────────────────────────────────────────────

function renderProcessRow(proc: Pm2Process) {
  return html`
    <tr class="fleet-pm2-row">
      <td class="fleet-pm2__name">${proc.name}</td>
      <td>${pm2StatusBadge(proc.status)}</td>
      <td class="fleet-pm2__mono">${formatUptime(proc.uptime)}</td>
      <td class="fleet-pm2__mono">${proc.restarts}</td>
      <td class="fleet-pm2__mono">${proc.cpu}</td>
      <td class="fleet-pm2__mono">${proc.mem}</td>
    </tr>
  `;
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderFleet(props: FleetViewProps) {
  const { state, onRefresh } = props;

  return html`
    <div class="fleet">
      <!-- Status Bar -->
      <section class="fleet-section fleet-gates">
        <h3 class="fleet-section__title">Gateways</h3>
        ${
          state.gates.length === 0
            ? html`
                <p class="fleet-empty">No gateways detected.</p>
              `
            : html`
              <div class="fleet-gates__grid">
                ${state.gates.map((gate) => renderGateCard(gate))}
              </div>
            `
        }
      </section>

      <!-- Disk + Backup + OAuth row -->
      <section class="fleet-section fleet-infra">
        <div class="fleet-infra__grid">
          ${
            state.disks.length > 0
              ? html`
                <div class="fleet-infra-card">
                  <span class="fleet-infra-card__label">Disk</span>
                  ${state.disks.map(
                    (d) => html`
                      <div class="fleet-infra-card__value">
                        <span>${d.mount}</span>
                        <span class="fleet-pm2__mono">${d.used} / ${d.total} (${d.usedPct}%)</span>
                      </div>
                    `,
                  )}
                </div>
              `
              : nothing
          }
          ${
            state.backup
              ? html`
                <div class="fleet-infra-card">
                  <span class="fleet-infra-card__label">Backup</span>
                  <div class="fleet-infra-card__value">
                    <span class="${state.backup.lastStatus === "ok" ? "fleet-ok" : "fleet-fail"}">
                      ${state.backup.lastStatus === "ok" ? "✅" : "❌"}
                      ${state.backup.lastRun}
                    </span>
                    ${
                      state.backup.consecutivePasses > 0
                        ? html`<span class="fleet-pm2__mono"
                          >${state.backup.consecutivePasses} consecutive</span
                        >`
                        : nothing
                    }
                  </div>
                </div>
              `
              : nothing
          }
          ${
            state.oauth
              ? html`
                <div class="fleet-infra-card">
                  <span class="fleet-infra-card__label">OAuth</span>
                  <div class="fleet-infra-card__value">
                    <span class="fleet-pm2__mono"
                      >Expires in ${state.oauth.expiresIn}</span
                    >
                    <span class="fleet-pm2__mono"
                      >${state.oauth.autoHealNights} nights auto-heal</span
                    >
                  </div>
                </div>
              `
              : nothing
          }
        </div>
      </section>

      <!-- PM2 Process Table -->
      <section class="fleet-section">
        <h3 class="fleet-section__title">PM2 Processes</h3>
        ${
          state.processes.length === 0
            ? html`
                <p class="fleet-empty">No PM2 data available.</p>
              `
            : html`
              <div class="fleet-table-wrap">
                <table class="fleet-pm2-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Uptime</th>
                      <th>Restarts</th>
                      <th>CPU</th>
                      <th>Mem</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${state.processes.map((proc) => renderProcessRow(proc))}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>

      <!-- Alert Stream -->
      <section class="fleet-section">
        <h3 class="fleet-section__title">
          Alerts
          <span class="fleet-section__count">${state.alerts.length}</span>
        </h3>
        ${
          state.alerts.length === 0
            ? html`
                <p class="fleet-empty">No alerts.</p>
              `
            : html`
              <div class="fleet-alerts">
                ${state.alerts.map(
                  (alert) => html`
                    <div class="fleet-alert fleet-alert--${alert.level}">
                      <span class="fleet-alert__level fleet-alert__level--${alert.level}"
                        >${alert.level === "error" ? "🔴" : alert.level === "warn" ? "🟡" : "🟢"}</span>
                      <span class="fleet-alert__ts fleet-pm2__mono"
                        >${new Date(alert.timestamp).toLocaleTimeString()}</span>
                      <span class="fleet-alert__src">${alert.source}</span>
                      <span class="fleet-alert__msg">${alert.message}</span>
                    </div>
                  `,
                )}
              </div>
            `
        }
      </section>

      <!-- Footer -->
      <div class="fleet-footer">
        <button class="btn btn--ghost btn--sm" @click=${onRefresh} ?disabled=${state.loading}>
          ${state.loading ? "Refreshing…" : "Refresh"}
        </button>
        ${state.lastError ? html`<span class="fleet-error">${state.lastError}</span>` : nothing}
      </div>
    </div>
  `;
}
