// src/consciousness/dashboard.ts
//
// Consciousness Dashboard — web UI showing all agents' states.
//
// Serves an HTML page and JSON API from the gateway's HTTP server.
// Shows: agent states, recent ticks, messages, tasks, modification history.
//
// API endpoints (mounted under /consciousness/):
//   GET /consciousness/              — Dashboard HTML page
//   GET /consciousness/api/status    — All agents' consciousness state
//   GET /consciousness/api/tasks     — Task graph
//   GET /consciousness/api/messages  — Recent messages (event log)
//   GET /consciousness/api/history   — Self-modification history

import type { IncomingMessage, ServerResponse } from "node:http";
import { CONSCIOUS_AGENT_ALLOWLIST_V1 } from "../agents/soul.js";
import { getAllConsciousnessStates } from "./engine.js";
import { MailboxManager } from "./messaging/mailbox.js";
import { getRegisteredPlugins } from "./perception-plugins.js";
import { getModificationHistory } from "./self-modify.js";
import { TaskStore } from "./tasks/task-store.js";
import { resolveTeamName } from "./team-name.js";
import { FileTransport } from "./transport/file-transport.js";

// ─── API Handler ─────────────────────────────────────────────────────────

/**
 * Handle consciousness dashboard HTTP requests.
 * Mount this on the gateway's HTTP server.
 */
export function handleConsciousnessRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";

  if (!url.startsWith("/consciousness")) return false;

  const path = url.replace("/consciousness", "") || "/";

  if (path === "/" || path === "") {
    serveDashboardHTML(res);
    return true;
  }

  if (path === "/api/status") {
    serveStatus(res);
    return true;
  }

  if (path === "/api/tasks") {
    serveTasks(res);
    return true;
  }

  if (path === "/api/messages") {
    serveMessages(res);
    return true;
  }

  if (path === "/api/history") {
    serveHistory(res);
    return true;
  }

  if (path === "/api/plugins") {
    servePlugins(res);
    return true;
  }

  return false;
}

// ─── API Endpoints ───────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, data: unknown): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}

function serveStatus(res: ServerResponse): void {
  const states = getAllConsciousnessStates();
  const agents: Record<string, unknown> = {};

  for (const [id, state] of states) {
    agents[id] = {
      running: state.running,
      totalTicks: state.totalTicks,
      totalActions: state.totalActions,
      startedAt: state.startedAt,
      sleepMode: state.sleepMode,
      sleepEnteredAt: state.sleepEnteredAt,
      consecutiveErrors: state.consecutiveErrors,
      lastTick: state.lastTick
        ? {
            tickId: state.lastTick.tickId,
            startedAt: state.lastTick.startedAt,
            durationMs: state.lastTick.durationMs,
            wasActive: state.lastTick.wasActive,
            mood: state.lastTick.cognition.mood,
            nextFocus: state.lastTick.cognition.nextFocus,
            thinking: state.lastTick.cognition.thinking?.slice(0, 200),
            actionsCount: state.lastTick.actionResults.length,
            perceptionsCount: state.lastTick.perception.perceptions.length,
            heartbeat: state.lastTick.heartbeat?.lines,
          }
        : null,
      config: {
        tickIntervalMs: state.config.tickIntervalMs,
        model: state.config.model,
        provider: state.config.provider,
        perceptionSources: state.config.perceptionSources,
      },
    };
  }

  jsonResponse(res, { timestamp: new Date().toISOString(), agents });
}

function serveTasks(res: ServerResponse): void {
  try {
    const store = new TaskStore(resolveTeamName());
    const tasks = store.list();
    const stats = store.stats();
    jsonResponse(res, { tasks, stats });
  } catch {
    jsonResponse(res, { tasks: [], stats: {} });
  }
}

function serveMessages(res: ServerResponse): void {
  try {
    const transport = new FileTransport(resolveTeamName());
    const mailbox = new MailboxManager(resolveTeamName(), transport);
    const events = mailbox.getEventLog(50);
    jsonResponse(res, { messages: events });
  } catch {
    jsonResponse(res, { messages: [] });
  }
}

function serveHistory(res: ServerResponse): void {
  const history: Record<string, unknown[]> = {};
  for (const agentId of CONSCIOUS_AGENT_ALLOWLIST_V1) {
    history[agentId] = getModificationHistory(agentId, 20);
  }
  jsonResponse(res, { history });
}

function servePlugins(res: ServerResponse): void {
  const plugins = getRegisteredPlugins().map((p) => ({
    name: p.name,
    description: p.description,
    sourceType: p.sourceType,
    enabled: p.enabled,
  }));
  jsonResponse(res, { plugins });
}

// ─── Dashboard HTML ──────────────────────────────────────────────────────

function serveDashboardHTML(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(DASHBOARD_HTML);
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KoLo Consciousness Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a; color: #f5f5f5;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      font-size: 14px; line-height: 1.5;
      padding: 24px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    h2 { font-size: 16px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    h3 { font-size: 14px; font-weight: 600; }
    .subtitle { font-size: 13px; color: #666; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .card {
      background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px;
    }
    .card.active { border-color: rgba(34, 197, 94, 0.3); }
    .card.sleeping { border-color: rgba(234, 179, 8, 0.2); }
    .card.error { border-color: rgba(239, 68, 68, 0.3); }
    .stat { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
    .stat-label { font-size: 12px; color: #666; }
    .stat-value { font-size: 14px; font-weight: 600; font-family: "JetBrains Mono", monospace; }
    .green { color: #22c55e; } .yellow { color: #eab308; } .red { color: #ef4444; }
    .blue { color: #3b82f6; } .purple { color: #a855f7; } .cyan { color: #06b6d4; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px;
      font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .badge-green { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .badge-yellow { background: rgba(234, 179, 8, 0.15); color: #eab308; }
    .badge-red { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .badge-blue { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .thinking { font-size: 12px; color: #888; margin-top: 8px; padding: 8px; background: #0d0d0d; border-radius: 4px; font-style: italic; }
    .heartbeat { font-size: 11px; color: #aaa; margin-top: 8px; padding: 8px; background: #0d0d0d; border-radius: 4px; font-family: "JetBrains Mono", monospace; white-space: pre-wrap; }
    .tasks-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .tasks-table th, .tasks-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #1a1a1a; font-size: 12px; }
    .tasks-table th { color: #666; font-weight: 600; text-transform: uppercase; font-size: 11px; }
    .msg-item { padding: 8px; border-bottom: 1px solid #1a1a1a; }
    .msg-meta { font-size: 11px; color: #555; }
    .msg-content { font-size: 13px; color: #ccc; margin-top: 4px; }
    .section { margin-bottom: 24px; }
    .refresh-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .refresh-btn {
      background: #1a1a1a; border: 1px solid #333; color: #aaa; padding: 6px 14px;
      border-radius: 6px; cursor: pointer; font-size: 12px;
    }
    .refresh-btn:hover { background: #222; color: #fff; }
    .auto-label { font-size: 11px; color: #555; }
    .plugin-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    .plugin-dot { width: 6px; height: 6px; border-radius: 50%; }
    .plugin-dot.on { background: #22c55e; } .plugin-dot.off { background: #555; }
  </style>
</head>
<body>
  <div class="refresh-bar">
    <div>
      <h1>KoLo Consciousness</h1>
      <p class="subtitle">Consciousness state per configured agent</p>
    </div>
    <div>
      <span class="auto-label" id="lastUpdate">Loading...</span>
      <button class="refresh-btn" onclick="refresh()">Refresh</button>
    </div>
  </div>

  <div class="grid" id="agentCards"></div>

  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <div class="section">
      <h2>Task Graph</h2>
      <div class="card" id="tasksSection">Loading...</div>
    </div>
    <div class="section">
      <h2>Recent Messages</h2>
      <div class="card" id="messagesSection">Loading...</div>
    </div>
  </div>

  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <div class="section">
      <h2>Self-Modifications</h2>
      <div class="card" id="historySection">Loading...</div>
    </div>
    <div class="section">
      <h2>Perception Plugins</h2>
      <div class="card" id="pluginsSection">Loading...</div>
    </div>
  </div>

  <script>
    const BASE = window.location.origin + '/consciousness';

    async function fetchJSON(path) {
      try {
        const r = await fetch(BASE + path);
        return await r.json();
      } catch { return null; }
    }

    function timeAgo(iso) {
      if (!iso) return 'never';
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 60000) return Math.round(ms/1000) + 's ago';
      if (ms < 3600000) return Math.round(ms/60000) + 'm ago';
      if (ms < 86400000) return Math.round(ms/3600000) + 'h ago';
      return Math.round(ms/86400000) + 'd ago';
    }

    function badge(text, color) {
      return '<span class="badge badge-' + color + '">' + text + '</span>';
    }

    async function refresh() {
      const [status, tasks, messages, history, plugins] = await Promise.all([
        fetchJSON('/api/status'),
        fetchJSON('/api/tasks'),
        fetchJSON('/api/messages'),
        fetchJSON('/api/history'),
        fetchJSON('/api/plugins'),
      ]);

      document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();

      // Agent cards
      if (status?.agents) {
        const cards = Object.entries(status.agents).map(([id, a]) => {
          const cls = a.sleepMode ? 'sleeping' : a.running ? 'active' : 'error';
          const statusBadge = a.sleepMode ? badge('SLEEPING', 'yellow') : a.running ? badge('AWAKE', 'green') : badge('OFFLINE', 'red');
          const hb = a.lastTick?.heartbeat ? '<div class="heartbeat">' + a.lastTick.heartbeat.join('\\n') + '</div>' : '';
          const think = a.lastTick?.thinking ? '<div class="thinking">' + a.lastTick.thinking + '</div>' : '';

          return '<div class="card ' + cls + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
              '<h3>' + id.charAt(0).toUpperCase() + id.slice(1) + '</h3>' + statusBadge +
            '</div>' +
            '<div class="stat"><span class="stat-label">Ticks</span><span class="stat-value blue">' + (a.totalTicks||0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Actions</span><span class="stat-value green">' + (a.totalActions||0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Errors</span><span class="stat-value ' + (a.consecutiveErrors>0?'red':'') + '">' + (a.consecutiveErrors||0) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Last Tick</span><span class="stat-value">' + timeAgo(a.lastTick?.startedAt) + '</span></div>' +
            '<div class="stat"><span class="stat-label">Mood</span><span class="stat-value purple">' + (a.lastTick?.mood||'—') + '</span></div>' +
            '<div class="stat"><span class="stat-label">Model</span><span class="stat-value" style="font-size:11px;color:#555">' + (a.config?.model||'—') + '</span></div>' +
            hb + think +
          '</div>';
        });
        document.getElementById('agentCards').innerHTML = cards.join('');
      }

      // Tasks
      if (tasks?.tasks) {
        if (tasks.tasks.length === 0) {
          document.getElementById('tasksSection').innerHTML = '<p style="color:#555;font-size:12px">No tasks yet</p>';
        } else {
          const rows = tasks.tasks.slice(0, 15).map(t => {
            const statusColor = {pending:'blue',in_progress:'yellow',completed:'green',blocked:'red',failed:'red'}[t.status]||'blue';
            return '<tr><td>' + badge(t.status, statusColor) + '</td><td>' + t.subject + '</td><td style="color:#555">' + (t.owner||'—') + '</td><td style="color:#555">' + timeAgo(t.createdAt) + '</td></tr>';
          });
          document.getElementById('tasksSection').innerHTML =
            '<div class="stat"><span class="stat-label">Total</span><span class="stat-value">' + tasks.stats.total + '</span></div>' +
            '<div class="stat"><span class="stat-label">In Progress</span><span class="stat-value yellow">' + tasks.stats.inProgress + '</span></div>' +
            '<div class="stat"><span class="stat-label">Completed</span><span class="stat-value green">' + tasks.stats.completed + '</span></div>' +
            '<table class="tasks-table"><thead><tr><th>Status</th><th>Subject</th><th>Owner</th><th>Created</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
        }
      }

      // Messages
      if (messages?.messages) {
        if (messages.messages.length === 0) {
          document.getElementById('messagesSection').innerHTML = '<p style="color:#555;font-size:12px">No messages yet</p>';
        } else {
          const items = messages.messages.slice(0, 10).map(m =>
            '<div class="msg-item"><div class="msg-meta">' + badge(m.type, 'blue') + ' ' +
            '<span style="color:#888">' + (m.from||'?') + ' → ' + (m.to||'all') + '</span> ' +
            '<span style="color:#555">' + timeAgo(m.timestamp) + '</span></div>' +
            (m.content ? '<div class="msg-content">' + m.content.slice(0,150) + '</div>' : '') +
            '</div>'
          );
          document.getElementById('messagesSection').innerHTML = items.join('');
        }
      }

      // Self-modification history
      if (history?.history) {
        const allMods = Object.entries(history.history).flatMap(([id, mods]) =>
          mods.map(m => ({...m, agentId: id}))
        ).sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||'')).slice(0, 10);

        if (allMods.length === 0) {
          document.getElementById('historySection').innerHTML = '<p style="color:#555;font-size:12px">No self-modifications yet</p>';
        } else {
          const items = allMods.map(m =>
            '<div class="msg-item"><div class="msg-meta">' +
            badge(m.applied ? 'APPLIED' : 'REJECTED', m.applied ? 'green' : 'red') + ' ' +
            '<span style="color:#888">' + m.agentId + '</span> ' +
            '<span style="color:#555">' + m.section + '.' + m.key + '</span> ' +
            '<span style="color:#555">' + timeAgo(m.timestamp) + '</span></div>' +
            '<div class="msg-content">' + m.reasoning + '</div>' +
            '</div>'
          );
          document.getElementById('historySection').innerHTML = items.join('');
        }
      }

      // Plugins
      if (plugins?.plugins) {
        if (plugins.plugins.length === 0) {
          document.getElementById('pluginsSection').innerHTML = '<p style="color:#555;font-size:12px">No plugins registered</p>';
        } else {
          const items = plugins.plugins.map(p =>
            '<div class="plugin-item"><span class="plugin-dot ' + (p.enabled?'on':'off') + '"></span>' +
            '<span style="font-size:13px">' + p.name + '</span>' +
            '<span style="font-size:11px;color:#555">' + p.description + '</span></div>'
          );
          document.getElementById('pluginsSection').innerHTML = items.join('');
        }
      }
    }

    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;
