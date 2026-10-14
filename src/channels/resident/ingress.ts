// Resident ingress (KoLo 2.0, M14a): the one place every inbound channel message passes
// through after its context is finalized and before the agent runs. It resolves the sender's
// role and the channel locale, copies attachments into the inbox, announces the message to
// attached clients and writes the audit entry. Commands and approvals (M14b) and the pause
// gate hook in here as well.
import path from "node:path";
import type { FinalizedMsgContext } from "../../auto-reply/templating.js";
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelLocale } from "../../config/types.channels-resident.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { auditSafe } from "../../audit/audit-log.js";
import { handleResidentCommand } from "./commands.js";
import { type ChannelIdentity, resolveChannelIdentity } from "./identity.js";
import { emitChannelInbound, hasChannelInboundListeners } from "./inbound-bus.js";
import { resolveInboxLimits, saveInboundFilesToInbox } from "./inbox.js";
import { getPause, markPauseNoticed } from "./pause.js";
import { channelText, resolveChannelLocale } from "./templates.js";

export type ResidentInbound = {
  channel: string;
  accountId?: string;
  sessionKey: string;
  agentId: string;
  identity: ChannelIdentity | null;
  locale: ChannelLocale;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  conversationId?: string;
  text: string;
  attachments: Array<{ path: string; size: number; name: string }>;
  /** Lines appended to the agent's view of the message (inbox paths, skipped files). */
  notes: string[];
};

export function residentChannelOf(ctx: {
  OriginatingChannel?: string;
  Provider?: string;
  Surface?: string;
}): string {
  return String(ctx.OriginatingChannel ?? ctx.Provider ?? ctx.Surface ?? "")
    .trim()
    .toLowerCase();
}

function bodyOf(ctx: FinalizedMsgContext): string {
  const raw = ctx.RawBody ?? ctx.BodyForCommands ?? ctx.Body ?? "";
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * Resolve the resident view of an inbound message and perform the side effects that do not
 * depend on the agent run: inbox copy, attach broadcast, audit. Returns null when the context
 * carries no channel (direct gateway chat, tests without a provider).
 */
export function prepareResidentInbound(input: {
  ctx: FinalizedMsgContext;
  cfg: KoLoConfig;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}): ResidentInbound | null {
  const { ctx, cfg } = input;
  const channel = residentChannelOf(ctx);
  const sessionKey = ctx.SessionKey?.trim();
  if (!channel || !sessionKey) {
    return null;
  }
  const accountId = ctx.AccountId?.trim() || undefined;
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const identity = resolveChannelIdentity({
    cfg,
    channel,
    accountId,
    candidates: [ctx.SenderId, ctx.SenderUsername, ctx.SenderE164, ctx.From],
    commandAuthorized: ctx.CommandAuthorized === true,
  });
  const locale = resolveChannelLocale(cfg, channel, accountId);
  const messageId = ctx.MessageSid?.trim() || undefined;
  const text = bodyOf(ctx);
  const notes: string[] = [];

  const mediaPaths = (
    ctx.MediaPaths?.length ? ctx.MediaPaths : ctx.MediaPath ? [ctx.MediaPath] : []
  ).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  const limits = resolveInboxLimits(cfg);
  const saved = saveInboundFilesToInbox({
    channel,
    messageId,
    files: mediaPaths.map((p) => ({ path: p })),
    limits,
    now: input.now?.(),
    env: input.env,
  });
  if (saved.saved.length > 0) {
    ctx.InboxPaths = saved.saved.map((f) => f.path);
    notes.push(channelText(locale, "attachment.saved", { count: saved.saved.length }));
    for (const f of saved.saved) {
      notes.push(`inbox ${f.path}`);
    }
  }
  for (const s of saved.skipped) {
    if (s.reason === "too_large") {
      notes.push(
        channelText(locale, "attachment.tooLarge", {
          name: path.basename(s.name),
          limit: `${Math.round(limits.maxFileBytes / (1024 * 1024))} MiB`,
        }),
      );
    }
  }

  const inbound: ResidentInbound = {
    channel,
    accountId,
    sessionKey,
    agentId,
    identity,
    locale,
    messageId,
    senderId: ctx.SenderId?.trim() || undefined,
    senderName: ctx.SenderName?.trim() || undefined,
    conversationId: (ctx.OriginatingTo ?? ctx.To ?? ctx.From)?.toString().trim() || undefined,
    text,
    attachments: saved.saved,
    notes,
  };

  if (hasChannelInboundListeners()) {
    emitChannelInbound({
      channel,
      accountId,
      sessionKey,
      agentId,
      messageId,
      sender: { id: inbound.senderId, name: inbound.senderName, role: identity?.role },
      conversation: {
        id: inbound.conversationId,
        label: ctx.ConversationLabel?.toString(),
        type: ctx.ChatType?.toString(),
      },
      text,
      attachments: saved.saved,
      ts: (input.now?.() ?? new Date()).getTime(),
    });
  }

  void auditSafe({
    identity: inbound.senderId ?? inbound.senderName ?? null,
    scope: sessionKey,
    action: "channel.inbound",
    outcome: "ok",
    source: "channels.resident",
    detail: {
      channel,
      accountId: accountId ?? null,
      agent: agentId,
      messageId: messageId ?? null,
      role: identity?.role ?? null,
      chars: text.length,
      attachments: saved.saved.length,
      skipped: saved.skipped.length,
    },
  });

  return inbound;
}

/** Append the resident notes (inbox paths etc.) to what the agent reads. */
export function applyResidentNotes(ctx: FinalizedMsgContext, inbound: ResidentInbound): void {
  if (inbound.notes.length === 0) {
    return;
  }
  const suffix = `\n\n[${inbound.notes.join("\n")}]`;
  if (typeof ctx.BodyForAgent === "string" && ctx.BodyForAgent.length > 0) {
    ctx.BodyForAgent = `${ctx.BodyForAgent}${suffix}`;
  } else if (typeof ctx.Body === "string") {
    ctx.Body = `${ctx.Body}${suffix}`;
  }
}

/**
 * Commands and the pause gate (M14b). Returns null when the message should reach the agent;
 * otherwise the reply to send (empty string: drop silently).
 */
export async function residentGate(input: {
  inbound: ResidentInbound;
  cfg: KoLoConfig;
  nowMs?: number;
}): Promise<{ reply: string } | null> {
  const { inbound, cfg } = input;
  const command = await handleResidentCommand({ inbound, cfg, nowMs: input.nowMs });
  if (command) {
    return { reply: command.reply };
  }
  const pause = getPause({
    channel: inbound.channel,
    accountId: inbound.accountId,
    conversationId: inbound.conversationId ?? inbound.sessionKey,
  });
  if (pause) {
    void auditSafe({
      identity: inbound.senderId ?? null,
      scope: inbound.sessionKey,
      action: "channel.inbound.paused",
      outcome: "denied",
      source: "channels.resident",
      detail: { channel: inbound.channel, messageId: inbound.messageId ?? null },
    });
    return { reply: markPauseNoticed(pause) ? channelText(inbound.locale, "paused.notice") : "" };
  }
  return null;
}
