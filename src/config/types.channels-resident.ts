// Channel-native residents (KoLo 2.0, M14): the config that turns a chat channel into a front
// door of the resident's session. Session mode, per-channel identities and locale, the inbox
// for attachments, the outbound delivery queue and approval delivery all live under `channels`.

/**
 * How inbound channel conversations map to sessions.
 * - `per-conversation`: one session per conversation per channel (DMs: `agent:<id>:<channel>:dm:<peer>`,
 *   groups: `agent:<id>:<channel>:group:<id>`). The default once the key is set.
 * - `shared`: every channel conversation lands in the resident's main session
 *   (`agent:<id>:main`), the one the engineer sees in the terminal.
 * When the key is absent, `session.dmScope` keeps its meaning (legacy configs change nothing).
 */
export type ChannelSessionMode = "per-conversation" | "shared";

/** Role a channel identity holds for conversation commands and approvals. */
export type ChannelIdentityRole = "owner" | "admin" | "attach";

/** Sender id (as the channel reports it) → role. Keys are matched case-insensitively. */
export type ChannelIdentitiesConfig = Record<string, ChannelIdentityRole>;

/** Locale of system replies (help, approvals, errors) on a channel. English is the default. */
export type ChannelLocale = "en" | "ja" | "pt";

export type ChannelsInboxConfig = {
  /** Largest attachment copied into `<KOLO_HOME>/inbox/<channel>/` (bytes, default 20 MiB). */
  maxFileBytes?: number;
  /** Attachments kept per inbound message (default 8). */
  maxFilesPerMessage?: number;
  /** Days an inbox file is kept before `kurahi channels prune` removes it (default 30). */
  retentionDays?: number;
};

export type ChannelsDeliveryConfig = {
  /** Retries after the first failed send (default 4). */
  maxRetries?: number;
  /** First retry delay (ms, default 1000); doubles per attempt up to `maxBackoffMs`. */
  backoffMs?: number;
  /** Cap on the retry delay (ms, default 60000). */
  maxBackoffMs?: number;
  /** Dedupe window for outbound keys (ms, default 10 minutes). */
  dedupeTtlMs?: number;
  /**
   * Who may originate a proactive (unsolicited) outbound message. A reply to an inbound message
   * from an admitted sender (allowlist, pairing store, identities or an open DM policy) within
   * `replyWindowMs` is a conversation and is always delivered, whatever produced it.
   * - `human-triggered` (default): proactive sends from a terminal/CLI or a human-initiated
   *   approval flow are delivered; automated ones are dead-lettered with reason `policy`.
   * - `allow-automated`: daemons and cron lanes may also send proactively (M13
   *   `agents[].channels` still applies).
   * - `replies-only`: nothing proactive is delivered; only replies.
   */
  policy?: "human-triggered" | "allow-automated" | "replies-only";
  /** How long after an inbound message an answer still counts as a reply (ms, default 24 h). */
  replyWindowMs?: number;
};

export type ChannelsApprovalTarget = {
  channel: string;
  to: string;
  accountId?: string;
  threadId?: string | number;
};

export type ChannelsApprovalsConfig = {
  /** Deliver tool approval asks to these channel targets in addition to the originating conversation. */
  targets?: ChannelsApprovalTarget[];
  /** Identities (sender ids) allowed to approve from a channel; owner/admin roles always may. */
  identities?: string[];
};

/** Fields every channel account may carry (core and extension schemas admit them). */
export type ChannelResidentAccountFields = {
  identities?: ChannelIdentitiesConfig;
  locale?: ChannelLocale;
};

/** Fields on `channels` itself. */
export type ChannelsResidentFields = {
  sessionMode?: ChannelSessionMode;
  /** Default locale of system replies for every channel without its own `locale`. */
  locale?: ChannelLocale;
  inbox?: ChannelsInboxConfig;
  delivery?: ChannelsDeliveryConfig;
  approvals?: ChannelsApprovalsConfig;
};

/** Built-in generic webhook channel (HTTP in, HTTP out): custom integrations and tests. */
export type WebhookChannelAccountConfig = ChannelResidentAccountFields & {
  enabled?: boolean;
  name?: string;
  /** Replies are POSTed here as JSON (`{to, text, chunk, chunks, actions?, dedupeKey}`). */
  outboundUrl?: string;
  /** Bearer token sent with outbound posts (store in the secrets store; never on argv). */
  outboundToken?: string;
  /** Sender ids allowed to talk to the resident (empty: every authenticated caller). */
  allowFrom?: string[];
  textChunkLimit?: number;
  /** Set to `shared` or `per-conversation` to override `channels.sessionMode` for this account. */
  sessionMode?: ChannelSessionMode;
};

export type WebhookChannelConfig = WebhookChannelAccountConfig & {
  accounts?: Record<string, WebhookChannelAccountConfig>;
};
