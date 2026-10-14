// Per-backend tool capability (KoLo 2.0, M2a — CSO Gap B).
// `agents.defaults.cliBackends.<id>.tools`:
//   none    — no tools: the tool list is empty and any tool call that arrives is rejected + audited
//   native  — the backend CLI runs its own tools (claude-cli, codex-cli default)
//   gateway — tools are executed by the gateway (embedded providers; CLI bridges via /tools/invoke)
import type { KoLoConfig } from "../config/config.js";
import type { CliBackendConfig } from "../config/types.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { resolveAgentModelPrimary } from "./agent-scope.js";
import { resolveCliBackendConfig } from "./cli-backends.js";
import { isCliProvider } from "./model-selection.js";

export type ToolCapability = "none" | "native" | "gateway";

export const TOOL_CAPABILITIES: readonly ToolCapability[] = ["none", "native", "gateway"];

export function resolveCliBackendToolCapability(backend: CliBackendConfig): ToolCapability {
  return backend.tools ?? "none";
}

/** Capability of a provider: CLI backends declare it; embedded providers run gateway tools. */
export function resolveProviderToolCapability(provider: string, cfg?: KoLoConfig): ToolCapability {
  if (!isCliProvider(provider, cfg)) {
    return "gateway";
  }
  const backend = resolveCliBackendConfig(provider, cfg);
  return backend ? resolveCliBackendToolCapability(backend.config) : "none";
}

function providerOfModelRef(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || !trimmed.includes("/")) {
    return undefined;
  }
  return trimmed.slice(0, trimmed.indexOf("/"));
}

/** Capability of the backend an agent's primary model runs on. */
export function resolveAgentToolCapability(cfg: KoLoConfig, agentId?: string): ToolCapability {
  const fromAgent = agentId ? resolveAgentModelPrimary(cfg, agentId) : undefined;
  const defaults = cfg.agents?.defaults?.model as { primary?: string } | string | undefined;
  const fromDefaults = typeof defaults === "string" ? defaults : defaults?.primary;
  const provider = providerOfModelRef(fromAgent) ?? providerOfModelRef(fromDefaults);
  return provider ? resolveProviderToolCapability(provider, cfg) : "gateway";
}

/** The one neutral system line for a backend without tools; nothing for tool-capable backends. */
export function toolCapabilitySystemLine(capability: ToolCapability): string | undefined {
  return capability === "none" ? "This backend has no tool access in this session." : undefined;
}

export type ToolCallDecision = { ok: true } | { ok: false; reason: string };

/**
 * Policy check for a tool call that reached the runtime. With capability `none` every call is
 * rejected and an audit event is written; the model is never trusted to obey a sentence.
 */
export function checkToolCallCapability(params: {
  capability: ToolCapability;
  toolName: string;
  agentId?: string;
  sessionKey?: string;
  source: string;
  backend?: string;
}): ToolCallDecision {
  if (params.capability !== "none") {
    return { ok: true };
  }
  const reason = `tool "${params.toolName}" rejected: backend${params.backend ? ` ${params.backend}` : ""} has tools=none`;
  recordAuditEvent({
    action: "tool.call",
    outcome: "denied",
    identity: params.agentId,
    scope: params.sessionKey,
    source: params.source,
    detail: { tool: params.toolName, capability: params.capability, backend: params.backend },
  });
  return { ok: false, reason };
}
