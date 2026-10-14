// Human-in-the-loop approvals over channels (KoLo 2.0, M14b).
//
// When a tool needs approval (exec approvals today; M13 `approvals` later) the ask is delivered
// to the originating conversation and to `channels.approvals.targets` as a localized message with
// `approve <id>` / `deny <id>` keywords and, where the channel renders them, buttons
// (`channelData.actions`). The answer comes back through the same inbound path: the resident
// command layer checks the sender's role (admin or owner, or a listed `channels.approvals.identities`
// entry) and resolves through the gateway's approval manager. Asks expire; every step is audited.
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelLocale } from "../../config/types.channels-resident.js";
import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import { auditSafe } from "../../audit/audit-log.js";
import { channelText, resolveChannelLocale } from "./templates.js";

export type ChannelApprovalAsk = {
  id: string;
  kind: "exec" | "tool";
  /** One or two lines describing what is being asked (command, cwd, agent). */
  summary: string;
  agentId?: string | null;
  sessionKey?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ChannelApprovalDecision = ExecApprovalDecision;

export type ChannelApprovalResolver = (
  id: string,
  decision: ChannelApprovalDecision,
  resolvedBy: string,
) => Promise<boolean> | boolean;

export type ApprovalResolveResult =
  | { ok: true; id: string; decision: ChannelApprovalDecision }
  | { ok: false; reason: "unknown" | "expired" | "no_resolver" };

const pending = new Map<string, ChannelApprovalAsk>();
let resolver: ChannelApprovalResolver | null = null;

/** The gateway registers the function that resolves an approval in the manager. */
export function setChannelApprovalResolver(fn: ChannelApprovalResolver | null): void {
  resolver = fn;
}

export function trackChannelApproval(ask: ChannelApprovalAsk): void {
  pending.set(ask.id, ask);
}

export function untrackChannelApproval(id: string): ChannelApprovalAsk | undefined {
  const ask = pending.get(id);
  pending.delete(id);
  return ask;
}

export function getChannelApproval(id: string): ChannelApprovalAsk | undefined {
  return pending.get(id);
}

export function listPendingChannelApprovals(nowMs = Date.now()): ChannelApprovalAsk[] {
  return [...pending.values()].filter((ask) => ask.expiresAtMs > nowMs);
}

export function __resetChannelApprovalsForTest(): void {
  pending.clear();
  resolver = null;
}

export function formatExpiresIn(expiresAtMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((expiresAtMs - nowMs) / 1000));
  return s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`;
}

/** The ask as a channel payload: localized text plus approve/deny actions. */
export function buildApprovalAskPayload(
  ask: ChannelApprovalAsk,
  locale: ChannelLocale,
  nowMs = Date.now(),
): ReplyPayload {
  return {
    text: channelText(locale, "approval.ask", {
      kind: ask.kind,
      id: ask.id,
      summary: ask.summary,
      expires: formatExpiresIn(ask.expiresAtMs, nowMs),
    }),
    channelData: {
      actions: [
        {
          id: "approve",
          label: channelText(locale, "approval.button.approve"),
          value: `approve ${ask.id}`,
        },
        { id: "deny", label: channelText(locale, "approval.button.deny"), value: `deny ${ask.id}` },
      ],
      approvalId: ask.id,
    },
  };
}

export function buildApprovalResolvedText(
  id: string,
  decision: ChannelApprovalDecision,
  by: string | null | undefined,
  locale: ChannelLocale,
): string {
  return channelText(locale, "approval.resolved", {
    id,
    decision: channelText(locale, `approval.decision.${decision}`),
    by: by ?? "-",
  });
}

export function buildApprovalExpiredText(id: string, locale: ChannelLocale): string {
  return channelText(locale, "approval.expired", { id });
}

/** Locale for a delivery target (channel + account). */
export function approvalLocaleFor(
  cfg: KoLoConfig,
  channel?: string | null,
  accountId?: string | null,
): ChannelLocale {
  return resolveChannelLocale(cfg, channel, accountId);
}

/** Resolve a pending ask from a channel; the caller has already checked permission. */
export async function resolveChannelApproval(input: {
  id: string;
  decision: ChannelApprovalDecision;
  resolvedBy: string;
  channel: string;
  sessionKey?: string;
  nowMs?: number;
}): Promise<ApprovalResolveResult> {
  const nowMs = input.nowMs ?? Date.now();
  const ask = pending.get(input.id);
  if (!ask) {
    return { ok: false, reason: "unknown" };
  }
  if (ask.expiresAtMs <= nowMs) {
    pending.delete(input.id);
    return { ok: false, reason: "expired" };
  }
  if (!resolver) {
    return { ok: false, reason: "no_resolver" };
  }
  const ok = await resolver(input.id, input.decision, input.resolvedBy);
  if (!ok) {
    pending.delete(input.id);
    return { ok: false, reason: "unknown" };
  }
  pending.delete(input.id);
  void auditSafe({
    identity: input.resolvedBy,
    scope: input.sessionKey ?? ask.sessionKey ?? null,
    action: "channel.approval.resolved",
    outcome: input.decision === "deny" ? "denied" : "ok",
    source: "channels.resident",
    detail: { id: input.id, decision: input.decision, channel: input.channel, kind: ask.kind },
  });
  return { ok: true, id: input.id, decision: input.decision };
}

/** Parse `approve <id>`, `deny <id>`, `/approve <id> [allow-once|allow-always|deny]`, `/deny <id>`. */
export function parseApprovalReply(
  text: string,
): { id: string; decision: ChannelApprovalDecision } | null {
  const m = text
    .trim()
    .match(/^\/?(approve|deny)\s+([A-Za-z0-9_.:-]+)(?:\s+(allow-once|allow-always|deny))?\s*$/i);
  if (!m) {
    return null;
  }
  const verb = m[1].toLowerCase();
  const id = m[2];
  if (verb === "deny") {
    return { id, decision: "deny" };
  }
  const explicit = m[3]?.toLowerCase() as ChannelApprovalDecision | undefined;
  return { id, decision: explicit ?? "allow-once" };
}
