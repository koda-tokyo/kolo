import type { MsgContext } from "../../auto-reply/templating.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
// Generic webhook channel (KoLo 2.0, M14a): HTTP in, HTTP out. A custom integration (or a test)
// posts an inbound message to `POST /api/channels/webhook/{account}/inbound`; the resident's
// replies are posted as JSON to the account's `outboundUrl`, chunked to `textChunkLimit`. The
// channel id is `webhook`; sessions, identities, locale, inbox, commands and the delivery queue
// work exactly as for any other channel.
import type { KoLoConfig } from "../../config/config.js";
import type { SessionChannelId } from "../../config/sessions/types.js";
import type { WebhookChannelAccountConfig } from "../../config/types.channels-resident.js";
import {
  chunkTextWithMode,
  resolveChunkMode,
  resolveTextChunkLimit,
} from "../../auto-reply/chunk.js";
import { dispatchReplyWithDispatcher } from "../../auto-reply/reply/provider-dispatcher.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { recordInboundSession } from "../session.js";
import { resolveInboxLimits, saveInboundBufferToInbox } from "./inbox.js";

export const WEBHOOK_CHANNEL_ID = "webhook";
export const WEBHOOK_DEFAULT_CHUNK_LIMIT = 4000;
export const WEBHOOK_MAX_BODY_BYTES = 8 * 1024 * 1024;

export type WebhookInboundBody = {
  /** Sender id as the integration knows it (required). */
  from: string;
  /** Display name of the sender. */
  name?: string;
  text?: string;
  /** Provider message id; repeated ids are ignored (idempotency). */
  messageId?: string;
  /** Conversation id; defaults to `from` (a direct conversation). */
  conversationId?: string;
  chatType?: "direct" | "group";
  /** Inline attachments; each is copied to the inbox under its name. */
  attachments?: Array<{ name: string; contentType?: string; dataBase64: string }>;
  /** Locale hint from the integration; the account locale wins when set. */
  locale?: string;
};

export type WebhookOutboundPost = {
  channel: typeof WEBHOOK_CHANNEL_ID;
  account: string;
  to: string;
  text: string;
  chunk: number;
  chunks: number;
  kind: "tool" | "block" | "final";
  replyToMessageId?: string;
  /** Buttons the integration may render (approval asks). */
  actions?: Array<{ id: string; label: string; value: string }>;
  dedupeKey: string;
  sessionKey: string;
};

export type WebhookSender = (
  url: string,
  post: WebhookOutboundPost,
  opts: { token?: string; dedupeKey: string },
) => Promise<void>;

export function resolveWebhookAccount(
  cfg: KoLoConfig,
  accountId: string = DEFAULT_ACCOUNT_ID,
): (WebhookChannelAccountConfig & { accountId: string }) | null {
  const root = cfg.channels?.webhook;
  if (!root) {
    return null;
  }
  const { accounts: _accounts, ...base } = root;
  const account = root.accounts?.[accountId];
  if (accountId !== DEFAULT_ACCOUNT_ID && !account) {
    return null;
  }
  const merged = { ...base, ...account, accountId };
  if (merged.enabled === false) {
    return null;
  }
  return merged;
}

export function listWebhookAccountIds(cfg: KoLoConfig): string[] {
  const root = cfg.channels?.webhook;
  if (!root || root.enabled === false) {
    return [];
  }
  const ids = new Set<string>([DEFAULT_ACCOUNT_ID, ...Object.keys(root.accounts ?? {})]);
  return [...ids].filter((id) => resolveWebhookAccount(cfg, id) !== null);
}

export function isWebhookSenderAllowed(
  account: WebhookChannelAccountConfig,
  from: string,
): boolean {
  const list = account.allowFrom ?? [];
  if (list.length === 0) {
    return true;
  }
  const want = from.trim().toLowerCase();
  return list.some((entry) => entry.trim().toLowerCase() === want || entry.trim() === "*");
}

export function validateWebhookInbound(raw: unknown): WebhookInboundBody | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "body must be a JSON object";
  }
  const b = raw as Record<string, unknown>;
  const from = typeof b.from === "string" ? b.from.trim() : "";
  if (!from) {
    return "from is required";
  }
  if (b.text !== undefined && typeof b.text !== "string") {
    return "text must be a string";
  }
  const attachments: WebhookInboundBody["attachments"] = [];
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments)) {
      return "attachments must be an array";
    }
    for (const a of b.attachments) {
      const rec = a as Record<string, unknown>;
      if (!rec || typeof rec.name !== "string" || typeof rec.dataBase64 !== "string") {
        return "each attachment needs name and dataBase64";
      }
      attachments.push({
        name: rec.name,
        dataBase64: rec.dataBase64,
        contentType: typeof rec.contentType === "string" ? rec.contentType : undefined,
      });
    }
  }
  const text = typeof b.text === "string" ? b.text : "";
  if (!text.trim() && attachments.length === 0) {
    return "text or attachments is required";
  }
  return {
    from,
    name: typeof b.name === "string" ? b.name : undefined,
    text,
    messageId: typeof b.messageId === "string" ? b.messageId : undefined,
    conversationId: typeof b.conversationId === "string" ? b.conversationId : undefined,
    chatType: b.chatType === "group" ? "group" : "direct",
    attachments,
    locale: typeof b.locale === "string" ? b.locale : undefined,
  };
}

/** Default outbound transport: one JSON POST per chunk. */
export const postWebhookOutbound: WebhookSender = async (url, post, opts) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-kolo-dedupe-key": opts.dedupeKey,
  };
  if (opts.token) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`outbound ${res.status}`);
  }
};

export type WebhookDeliverFn = (post: WebhookOutboundPost) => Promise<void>;

export type WebhookInboundResult = {
  ok: true;
  sessionKey: string;
  agentId: string;
  accountId: string;
  conversationId: string;
  queuedFinal: boolean;
  replies: Array<{ kind: string; text: string }>;
};

/**
 * Turn a webhook post into a resident inbound message and run it through the same dispatch
 * every channel uses. `deliver` receives each outbound chunk (the queue, M14c, wraps it).
 */
export async function handleWebhookInbound(input: {
  cfg: KoLoConfig;
  accountId: string;
  body: WebhookInboundBody;
  deliver: WebhookDeliverFn;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces the agent run. */
  replyResolver?: Parameters<typeof dispatchReplyWithDispatcher>[0]["replyResolver"];
}): Promise<WebhookInboundResult> {
  const { cfg, body } = input;
  const accountId = input.accountId || DEFAULT_ACCOUNT_ID;
  const conversationId = body.conversationId?.trim() || body.from;
  const peerKind = body.chatType === "group" ? "group" : "dm";
  const route = resolveAgentRoute({
    cfg,
    channel: WEBHOOK_CHANNEL_ID,
    accountId,
    peer: { kind: peerKind, id: conversationId },
  });

  const limits = resolveInboxLimits(cfg);
  const mediaPaths: string[] = [];
  const skipped: string[] = [];
  (body.attachments ?? []).forEach((att, index) => {
    const data = Buffer.from(att.dataBase64, "base64");
    const saved = saveInboundBufferToInbox({
      channel: WEBHOOK_CHANNEL_ID,
      messageId: body.messageId ?? null,
      name: att.name,
      data,
      index,
      limits,
      now: input.now?.(),
      env: input.env,
    });
    if ("path" in saved) {
      mediaPaths.push(saved.path);
    } else {
      skipped.push(att.name);
    }
  });

  const account = resolveWebhookAccount(cfg, accountId);
  const commandAuthorized = account ? isWebhookSenderAllowed(account, body.from) : false;
  const timestamp = (input.now?.() ?? new Date()).getTime();
  const ctx: MsgContext = {
    Body: body.text,
    RawBody: body.text,
    From: `${WEBHOOK_CHANNEL_ID}:${body.from}`,
    To: `${WEBHOOK_CHANNEL_ID}:${conversationId}`,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    MessageSid: body.messageId,
    ChatType: body.chatType === "group" ? "group" : "direct",
    ConversationLabel:
      body.chatType === "group" ? `group ${conversationId}` : (body.name ?? body.from),
    SenderId: body.from,
    SenderName: body.name ?? body.from,
    Provider: WEBHOOK_CHANNEL_ID,
    Surface: WEBHOOK_CHANNEL_ID,
    OriginatingChannel: WEBHOOK_CHANNEL_ID as MsgContext["OriginatingChannel"],
    OriginatingTo: conversationId,
    CommandAuthorized: commandAuthorized,
    Timestamp: timestamp,
    ...(mediaPaths.length > 0
      ? { MediaPath: mediaPaths[0], MediaPaths: mediaPaths, InboxPaths: mediaPaths }
      : {}),
  };

  const storePath = resolveStorePath(cfg.session?.store, { agentId: route.agentId });
  await recordInboundSession({
    storePath,
    sessionKey: route.sessionKey,
    ctx,
    createIfMissing: true,
    updateLastRoute: {
      sessionKey: route.sessionKey,
      channel: WEBHOOK_CHANNEL_ID as unknown as SessionChannelId,
      to: conversationId,
      accountId,
    },
    onRecordError: () => {},
  });

  const limit = resolveTextChunkLimit(cfg, WEBHOOK_CHANNEL_ID, accountId, {
    fallbackLimit: account?.textChunkLimit ?? WEBHOOK_DEFAULT_CHUNK_LIMIT,
  });
  const mode = resolveChunkMode(cfg, WEBHOOK_CHANNEL_ID, accountId);
  const replies: WebhookInboundResult["replies"] = [];
  let counter = 0;
  // The outbound queue retries a payload as a whole; chunks already posted are not repeated.
  const posted = new WeakMap<ReplyPayload, Set<number>>();
  const result = await dispatchReplyWithDispatcher({
    ctx,
    cfg,
    replyResolver: input.replyResolver,
    dispatcherOptions: {
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        if (!text.trim()) {
          return;
        }
        const chunks = chunkTextWithMode(text, limit, mode);
        const actions = payload.channelData?.actions as WebhookOutboundPost["actions"];
        let done = posted.get(payload);
        if (!done) {
          done = new Set<number>();
          posted.set(payload, done);
        }
        for (let i = 0; i < chunks.length; i++) {
          if (done.has(i)) {
            continue;
          }
          counter += 1;
          const post: WebhookOutboundPost = {
            channel: WEBHOOK_CHANNEL_ID,
            account: accountId,
            to: conversationId,
            text: chunks[i],
            chunk: i + 1,
            chunks: chunks.length,
            kind: info.kind,
            replyToMessageId: body.messageId,
            ...(actions && i === chunks.length - 1 ? { actions } : {}),
            dedupeKey: `${WEBHOOK_CHANNEL_ID}:${accountId}:${body.messageId ?? timestamp}:${counter}`,
            sessionKey: route.sessionKey,
          };
          await input.deliver(post);
          done.add(i);
          replies.push({ kind: info.kind, text: chunks[i] });
        }
      },
    },
  });

  return {
    ok: true,
    sessionKey: route.sessionKey,
    agentId: route.agentId,
    accountId,
    conversationId,
    queuedFinal: result.queuedFinal,
    replies,
  };
}
