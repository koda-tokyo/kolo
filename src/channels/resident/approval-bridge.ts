// Bridge between the exec approval forwarder and channel-native residents (KoLo 2.0, M14b):
// localized asks with approve/deny actions per target channel, extra targets from
// `channels.approvals.targets`, tracking for keyword resolution, and audit of ask/expiry.
import type { KoLoConfig } from "../../config/config.js";
import type { ExecApprovalForwardTarget } from "../../config/types.approvals.js";
import type {
  ExecApprovalForwarderDeps,
  ExecApprovalRequest,
  ExecApprovalResolved,
} from "../../infra/exec-approval-forwarder.js";
import { auditSafe } from "../../audit/audit-log.js";
import {
  approvalLocaleFor,
  buildApprovalAskPayload,
  buildApprovalExpiredText,
  buildApprovalResolvedText,
  type ChannelApprovalAsk,
  trackChannelApproval,
  untrackChannelApproval,
} from "./approvals.js";

export function summarizeExecRequest(request: ExecApprovalRequest): string {
  const r = request.request;
  const lines = [`command ${r.command}`];
  if (r.cwd) {
    lines.push(`cwd ${r.cwd}`);
  }
  if (r.agentId) {
    lines.push(`agent ${r.agentId}`);
  }
  if (r.host) {
    lines.push(`host ${r.host}`);
  }
  if (r.ask) {
    lines.push(`ask ${r.ask}`);
  }
  return lines.join("\n");
}

export function askOf(request: ExecApprovalRequest): ChannelApprovalAsk {
  return {
    id: request.id,
    kind: "exec",
    summary: summarizeExecRequest(request),
    agentId: request.request.agentId ?? null,
    sessionKey: request.request.sessionKey ?? null,
    createdAtMs: request.createdAtMs,
    expiresAtMs: request.expiresAtMs,
  };
}

export function channelApprovalTargets(cfg: KoLoConfig): ExecApprovalForwardTarget[] {
  return (cfg.channels?.approvals?.targets ?? []).map((t) => ({
    channel: t.channel,
    to: t.to,
    accountId: t.accountId,
    threadId: t.threadId,
  }));
}

/** Deps for `createExecApprovalForwarder` that make it channel-native. */
export function createResidentApprovalForwarderDeps(
  base: Pick<ExecApprovalForwarderDeps, "getConfig" | "deliver" | "nowMs"> & {
    getConfig: () => KoLoConfig;
  },
): ExecApprovalForwarderDeps {
  return {
    ...base,
    extraTargets: (cfg) => channelApprovalTargets(cfg),
    messages: {
      request: (request, target, nowMs) =>
        buildApprovalAskPayload(
          askOf(request),
          approvalLocaleFor(base.getConfig(), target.channel, target.accountId),
          nowMs,
        ),
      resolved: (resolved: ExecApprovalResolved, target) =>
        buildApprovalResolvedText(
          resolved.id,
          resolved.decision,
          resolved.resolvedBy,
          approvalLocaleFor(base.getConfig(), target.channel, target.accountId),
        ),
      expired: (request, target) =>
        buildApprovalExpiredText(
          request.id,
          approvalLocaleFor(base.getConfig(), target.channel, target.accountId),
        ),
    },
    onRequested: (request, targets) => {
      trackChannelApproval(askOf(request));
      void auditSafe({
        identity: request.request.agentId ?? null,
        scope: request.request.sessionKey ?? null,
        action: "channel.approval.asked",
        outcome: "ok",
        source: "channels.resident",
        detail: {
          id: request.id,
          kind: "exec",
          targets: targets.map((t) => `${t.channel}:${t.to}`),
          expiresAtMs: request.expiresAtMs,
        },
      });
    },
    onResolved: (resolved) => {
      untrackChannelApproval(resolved.id);
    },
    onExpired: (request) => {
      untrackChannelApproval(request.id);
      void auditSafe({
        identity: request.request.agentId ?? null,
        scope: request.request.sessionKey ?? null,
        action: "channel.approval.expired",
        outcome: "denied",
        source: "channels.resident",
        detail: { id: request.id, kind: "exec" },
      });
    },
  };
}
