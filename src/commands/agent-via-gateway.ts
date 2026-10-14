import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps } from "../cli/deps.js";
import type { RuntimeEnv } from "../runtime.js";
import { listAgentIds } from "../agents/agent-scope.js";
import { DEFAULT_CHAT_CHANNEL } from "../channels/registry.js";
import { formatCliCommand } from "../cli/command-format.js";
import { withProgress } from "../cli/progress.js";
import { loadConfig } from "../config/config.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import { resolveSiblingInboxDir } from "../config/sibling-paths.js";
import {
  buildGatewayConnectionDetails,
  callGateway,
  isGatewayUnreachableError,
  randomIdempotencyKey,
} from "../gateway/call.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { recordAuditEvent } from "../security/audit-log.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { agentCommand } from "./agent.js";
import { resolveSessionKeyForRequest } from "./agent/session.js";

// Agent-to-agent delivery has two shapes. Agents hosted by this gateway are woken live
// through their session. Agents hosted outside the gateway (another runtime the gateway
// cannot wake) are reached by inbox write + ack. An agent must be in exactly one set: an
// agent that is hosted here but listed as external gets a silent inbox write and no reply.
// External agents are declared with KOLO_EXTERNAL_RUNTIME_AGENTS (comma-separated ids).
const EXTERNAL_RUNTIME_AGENTS = new Set(
  (process.env.KOLO_EXTERNAL_RUNTIME_AGENTS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean),
);

function deliverToInbox(
  agentId: string,
  message: string,
  sender?: string,
): {
  runId: string;
  status: string;
  summary: string;
  inboxPath: string;
} {
  // External-runtime workspaces: siblings[] in config, else the shared family root.
  const inboxDir = resolveSiblingInboxDir(agentId);
  mkdirSync(inboxDir, { recursive: true });
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mn = String(now.getMinutes()).padStart(2, "0");
  const senderTag = (sender ?? "a2a").replace(/[^a-z0-9_-]/gi, "");
  const slug =
    message
      .slice(0, 40)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "msg";
  const filename = `from_${senderTag}_${yyyy}-${mm}-${dd}_${hh}${mn}_${slug}.md`;
  const inboxPath = join(inboxDir, filename);
  const body = [
    `# A2A → ${agentId}`,
    `**from:** ${senderTag}`,
    `**at:** ${now.toISOString()}`,
    `**runtime:** ${agentId} (external-runtime — inbox delivery)`,
    "",
    "---",
    "",
    message,
    "",
  ].join("\n");
  writeFileSync(inboxPath, body, { encoding: "utf-8" });
  return {
    runId: `inbox-${Date.now()}`,
    status: "delivered_to_inbox",
    summary: `Delivered to ${agentId}'s inbox. Will be read on next session start. Path: ${inboxPath}`,
    inboxPath,
  };
}

function inferSenderFromEnv(): string | undefined {
  // KOLO_AGENT_ID is set on agent-bound TUI sessions
  const fromEnv = process.env.KOLO_AGENT_ID ?? process.env.KOLO_SESSION_AGENT;
  if (fromEnv) return fromEnv.trim().toLowerCase();
  // A per-agent state dir names the agent: .kolo-<id> → <id>
  const stateDir = process.env.KOLO_STATE_DIR ?? "";
  const match = stateDir.match(/\.kolo-([a-z]+)/);
  if (match) return match[1];
  return undefined;
}

type AgentGatewayResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string | null;
    mediaUrls?: string[];
  }>;
  meta?: unknown;
};

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: AgentGatewayResult;
};

export type AgentCliOpts = {
  message: string;
  agent?: string;
  to?: string;
  sessionId?: string;
  thinking?: string;
  verbose?: string;
  json?: boolean;
  timeout?: string;
  deliver?: boolean;
  channel?: string;
  replyTo?: string;
  replyChannel?: string;
  replyAccount?: string;
  bestEffortDeliver?: boolean;
  lane?: string;
  runId?: string;
  extraSystemPrompt?: string;
  local?: boolean;
};

function parseTimeoutSeconds(opts: { cfg: ReturnType<typeof loadConfig>; timeout?: string }) {
  const raw =
    opts.timeout !== undefined
      ? Number.parseInt(String(opts.timeout), 10)
      : (opts.cfg.agents?.defaults?.timeoutSeconds ?? 600);
  if (Number.isNaN(raw) || raw <= 0) {
    throw new Error("--timeout must be a positive integer (seconds)");
  }
  return raw;
}

function formatPayloadForLog(payload: {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string | null;
}) {
  const lines: string[] = [];
  if (payload.text) {
    lines.push(payload.text.trimEnd());
  }
  const mediaUrl =
    typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()
      ? payload.mediaUrl.trim()
      : undefined;
  const media = payload.mediaUrls ?? (mediaUrl ? [mediaUrl] : []);
  for (const url of media) {
    lines.push(`MEDIA:${url}`);
  }
  return lines.join("\n").trimEnd();
}

export const AGENT_EXIT = { ok: 0, error: 1, usage: 2, unreachable: 3 } as const;

/**
 * Where `kolo agent` connects (M3b). Routing follows KOLO_HOME / KOLO_STATE_DIR: the config
 * (and so the port and the token file) is the one under that state root, so a sibling is
 * addressed through its own gateway by pointing the env at its home. When the running
 * gateway's lease (`<home>/run/gateway.lock`) names a port, it wins over the config value.
 */
export function describeAgentGatewayTarget(
  cfg: ReturnType<typeof loadConfig>,
  env: NodeJS.ProcessEnv = process.env,
): { url?: string; display: string; home: string; port: number; source: string } {
  const home = resolveKoloHome({ env });
  const details = buildGatewayConnectionDetails({ config: cfg });
  let url: string | undefined;
  let source = details.urlSource;
  let port = Number.parseInt(new URL(details.url).port || "0", 10) || 0;
  const remote = cfg.gateway?.mode === "remote";
  if (!remote && !env.KOLO_GATEWAY_URL) {
    try {
      const lock = JSON.parse(readFileSync(join(home, "run", "gateway.lock"), "utf8")) as {
        port?: unknown;
      };
      const lockPort = typeof lock.port === "number" ? lock.port : Number.NaN;
      if (Number.isInteger(lockPort) && lockPort > 0 && lockPort !== port) {
        port = lockPort;
        url = `ws://127.0.0.1:${lockPort}`;
        source = "lease run/gateway.lock";
      }
    } catch {
      // no lease: config port
    }
  }
  return { url, display: url ?? details.url, home, port, source };
}

export async function agentViaGatewayCommand(opts: AgentCliOpts, runtime: RuntimeEnv) {
  const body = (opts.message ?? "").trim();
  if (!body) {
    throw new Error("Message (--message) is required");
  }
  if (!opts.to && !opts.sessionId && !opts.agent) {
    throw new Error("Pass --to <E.164>, --session-id, or --agent to choose a session");
  }

  const cfg = loadConfig();
  const agentIdRaw = opts.agent?.trim();
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
  if (agentId) {
    const knownAgents = listAgentIds(cfg);
    // External-runtime agents are not in the gateway agent config (no session to
    // register). Accept them from the declared set; they get inbox delivery only.
    if (!knownAgents.includes(agentId) && !EXTERNAL_RUNTIME_AGENTS.has(agentId)) {
      throw new Error(
        `Unknown agent id "${agentIdRaw}". Use "${formatCliCommand("kolo agents list")}" to see configured agents.`,
      );
    }
    // Polymorphic delivery: external-runtime → inbox + ack, skip gateway call.
    if (EXTERNAL_RUNTIME_AGENTS.has(agentId)) {
      const sender = inferSenderFromEnv();
      const result = deliverToInbox(agentId, body, sender);
      const response = {
        runId: result.runId,
        status: result.status,
        summary: result.summary,
        result: { payloads: [{ text: result.summary }] },
      };
      // External-runtime siblings are CLI-only (no gateway session to wake), so
      // there is no live reply. Still ack the caller: delivery confirmation in
      // text mode, full object in --json mode. (defaultRuntime has no `info`,
      // so the old runtime.info?.() path was a silent no-op in production.)
      if (opts.json) {
        runtime.log(JSON.stringify(response, null, 2));
      } else {
        runtime.log(result.summary);
      }
      return response;
    }
  }
  const timeoutSeconds = parseTimeoutSeconds({ cfg, timeout: opts.timeout });
  const gatewayTimeoutMs = Math.max(10_000, (timeoutSeconds + 30) * 1000);

  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    agentId,
    to: opts.to,
    sessionId: opts.sessionId,
  }).sessionKey;

  const channel = normalizeMessageChannel(opts.channel) ?? DEFAULT_CHAT_CHANNEL;
  const idempotencyKey = opts.runId?.trim() || randomIdempotencyKey();
  const target = describeAgentGatewayTarget(cfg);

  const response = await withProgress(
    {
      label: "Waiting for agent reply…",
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway<GatewayAgentResponse>({
        url: target.url,
        method: "agent",
        params: {
          message: body,
          agentId,
          to: opts.to,
          replyTo: opts.replyTo,
          sessionId: opts.sessionId,
          sessionKey,
          thinking: opts.thinking,
          deliver: Boolean(opts.deliver),
          channel,
          replyChannel: opts.replyChannel,
          replyAccountId: opts.replyAccount,
          timeout: timeoutSeconds,
          lane: opts.lane,
          extraSystemPrompt: opts.extraSystemPrompt,
          idempotencyKey,
        },
        expectFinal: true,
        timeoutMs: gatewayTimeoutMs,
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );

  if (opts.json) {
    runtime.log(JSON.stringify(response, null, 2));
    return response;
  }

  const result = response?.result;
  const payloads = result?.payloads ?? [];

  if (payloads.length === 0) {
    runtime.log(response?.summary ? String(response.summary) : "No reply from agent.");
    return response;
  }

  for (const payload of payloads) {
    const out = formatPayloadForLog(payload);
    if (out) {
      runtime.log(out);
    }
  }

  return response;
}

export async function agentCliCommand(opts: AgentCliOpts, runtime: RuntimeEnv, deps?: CliDeps) {
  const localOpts = {
    ...opts,
    agentId: opts.agent,
    replyAccountId: opts.replyAccount,
  };
  if (opts.local === true) {
    // Explicit embedded run: say so once and leave a trace in the audit chain.
    const cfg = loadConfig();
    const target = describeAgentGatewayTarget(cfg);
    runtime.error(
      `kolo agent: --local runs the embedded agent in this process; the gateway at ${target.display} is bypassed (audited as agent.local_run).`,
    );
    recordAuditEvent({
      action: "agent.local_run",
      outcome: "allowed",
      source: "cli.agent",
      identity: inferSenderFromEnv() ?? "cli",
      scope: opts.agent?.trim() || opts.sessionId?.trim() || opts.to?.trim() || undefined,
      detail: {
        agent: opts.agent ?? null,
        to: opts.to ?? null,
        sessionId: opts.sessionId ?? null,
        home: target.home,
        gateway: target.display,
      },
    });
    return await agentCommand(localOpts, runtime, deps);
  }

  try {
    return await agentViaGatewayCommand(opts, runtime);
  } catch (err) {
    // M3b: never fall back to the embedded agent on our own. Unreachable → exit 3 naming the
    // state dir and port; any other gateway error propagates as-is.
    if (isGatewayUnreachableError(err)) {
      const cfg = loadConfig();
      const target = describeAgentGatewayTarget(cfg);
      runtime.error(
        `kolo agent: gateway unreachable at ${target.display} (state dir ${target.home}, port ${target.port}, from ${target.source}): ${String(err instanceof Error ? err.message : err).split("\n")[0]}\n` +
          `Start it with ${formatCliCommand("kolo gateway")} or ${formatCliCommand("kolo service start")}, or pass --local to run the embedded agent in this process (audited).`,
      );
      runtime.exit(AGENT_EXIT.unreachable);
      return undefined;
    }
    throw err;
  }
}
