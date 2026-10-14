import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
// Tools a gateway request may invoke for a session (KoLo 2.0, M4/M6). The same policy stack the
// embedded runner applies (profile, provider profile, global, agent, group, subagent) over the
// gateway tool list (core + plugin + MCP), plus the M2 backend capability gate. Shared by
// POST /tools/invoke, POST /api/code-mode/run and WS codeMode.run.
import { createKoLoTools } from "../agents/kolo-tools.js";
import {
  filterToolsByPolicy,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "../agents/pi-tools.policy.js";
import {
  checkToolCallCapability,
  resolveAgentToolCapability,
  type ToolCapability,
} from "../agents/tool-capability.js";
import {
  buildPluginToolGroups,
  collectExplicitAllowlist,
  expandPolicyWithPluginGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
  stripPluginOnlyAllowlist,
} from "../agents/tool-policy.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";

export type InvocableTools = {
  sessionKey: string;
  agentId?: string;
  capability: ToolCapability;
  tools: AnyAgentTool[];
};

export function resolveInvocableSessionKey(cfg: KoLoConfig, raw: string | undefined): string {
  const trimmed = raw?.trim();
  return !trimmed || trimmed === "main" ? resolveMainSessionKey(cfg) : trimmed;
}

export function resolveInvocableTools(params: {
  cfg: KoLoConfig;
  sessionKey: string;
  messageChannel?: GatewayMessageChannel;
  accountId?: string;
}): InvocableTools {
  const { cfg, sessionKey, messageChannel, accountId } = params;
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);
  const capability = resolveAgentToolCapability(cfg, agentId);

  const mergeAlsoAllow = (policy: typeof profilePolicy, alsoAllow?: string[]) => {
    if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) {
      return policy;
    }
    return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
  };
  const profilePolicyWithAlsoAllow = mergeAlsoAllow(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllow(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const groupPolicy = resolveGroupToolPolicy({
    config: cfg,
    sessionKey,
    messageProvider: messageChannel ?? undefined,
    accountId: accountId ?? null,
  });
  const subagentPolicy = isSubagentSessionKey(sessionKey)
    ? resolveSubagentToolPolicy(cfg)
    : undefined;

  const allTools = createKoLoTools({
    agentSessionKey: sessionKey,
    agentChannel: messageChannel ?? undefined,
    agentAccountId: accountId,
    config: cfg,
    pluginToolAllowlist: collectExplicitAllowlist([
      profilePolicy,
      providerProfilePolicy,
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      subagentPolicy,
    ]),
  });

  const coreToolNames = new Set(
    allTools
      .filter((tool) => !getPluginToolMeta(tool))
      .map((tool) => normalizeToolName(tool.name))
      .filter(Boolean),
  );
  const pluginGroups = buildPluginToolGroups({
    tools: allTools,
    toolMeta: (tool) => getPluginToolMeta(tool),
  });
  const resolvePolicy = (policy: typeof profilePolicy, label: string) => {
    const resolved = stripPluginOnlyAllowlist(policy, pluginGroups, coreToolNames);
    if (resolved.unknownAllowlist.length > 0) {
      const entries = resolved.unknownAllowlist.join(", ");
      const suffix = resolved.strippedAllowlist
        ? "Ignoring allowlist so core tools remain available. Use tools.alsoAllow for additive plugin tool enablement."
        : "These entries won't match any tool unless the plugin is enabled.";
      logWarn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
    }
    return expandPolicyWithPluginGroups(resolved.policy, pluginGroups);
  };
  const stages: Array<ReturnType<typeof resolvePolicy>> = [
    resolvePolicy(
      profilePolicyWithAlsoAllow,
      profile ? `tools.profile (${profile})` : "tools.profile",
    ),
    resolvePolicy(
      providerProfilePolicyWithAlsoAllow,
      providerProfile
        ? `tools.byProvider.profile (${providerProfile})`
        : "tools.byProvider.profile",
    ),
    resolvePolicy(globalPolicy, "tools.allow"),
    resolvePolicy(globalProviderPolicy, "tools.byProvider.allow"),
    resolvePolicy(agentPolicy, agentId ? `agents.${agentId}.tools.allow` : "agent tools.allow"),
    resolvePolicy(
      agentProviderPolicy,
      agentId ? `agents.${agentId}.tools.byProvider.allow` : "agent tools.byProvider.allow",
    ),
    resolvePolicy(groupPolicy, "group tools.allow"),
    expandPolicyWithPluginGroups(subagentPolicy, pluginGroups),
  ];
  let tools = allTools;
  for (const policy of stages) {
    if (policy) {
      tools = filterToolsByPolicy(tools, policy);
    }
  }
  return { sessionKey, agentId, capability, tools };
}

/** M2 capability gate for one call from a gateway surface; denied calls are audited. */
export function checkInvocableCapability(
  resolved: InvocableTools,
  toolName: string,
  source: string,
): { ok: true } | { ok: false; reason: string } {
  return checkToolCallCapability({
    capability: resolved.capability,
    toolName,
    agentId: resolved.agentId,
    sessionKey: resolved.sessionKey,
    source,
  });
}
