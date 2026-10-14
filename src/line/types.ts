import type {
  WebhookEvent,
  TextMessage,
  ImageMessage,
  VideoMessage,
  AudioMessage,
  StickerMessage,
  LocationMessage,
} from "@line/bot-sdk";

export type LineTokenSource = "config" | "env" | "file" | "none";

export interface LineConfig {
  enabled?: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
  tokenFile?: string;
  secretFile?: string;
  name?: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  mediaMaxMb?: number;
  webhookPath?: string;
  /**
   * Route inbound messages into an existing agent session (e.g. "agent:alice:main")
   * instead of spawning an isolated per-conversation session, so the agent sees them
   * live in their TUI. Replies still route back out via LINE (OriginatingChannel/
   * OriginatingTo are preserved on the inbound context).
   */
  routeToSession?: string;
  /** Sender id → role for conversation commands and approvals (KoLo 2.0, M14). */
  identities?: Record<string, "owner" | "admin" | "attach">;
  /** Locale of system replies on this channel (M14). */
  locale?: "en" | "ja" | "pt";
  accounts?: Record<string, LineAccountConfig>;
  groups?: Record<string, LineGroupConfig>;
}

export interface LineAccountConfig {
  enabled?: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
  tokenFile?: string;
  secretFile?: string;
  name?: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  mediaMaxMb?: number;
  webhookPath?: string;
  /** Per-account override of {@link LineConfig.routeToSession}. */
  routeToSession?: string;
  identities?: Record<string, "owner" | "admin" | "attach">;
  locale?: "en" | "ja" | "pt";
  groups?: Record<string, LineGroupConfig>;
}

export interface LineGroupConfig {
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  requireMention?: boolean;
  systemPrompt?: string;
  skills?: string[];
}

export interface ResolvedLineAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  tokenSource: LineTokenSource;
  config: LineConfig & LineAccountConfig;
}

export type LineMessageType =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | StickerMessage
  | LocationMessage;

export interface LineWebhookContext {
  event: WebhookEvent;
  replyToken?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineSendResult {
  messageId: string;
  chatId: string;
}

export interface LineProbeResult {
  ok: boolean;
  bot?: {
    displayName?: string;
    userId?: string;
    basicId?: string;
    pictureUrl?: string;
  };
  error?: string;
}

export type LineFlexMessagePayload = {
  altText: string;
  contents: unknown;
};

export type LineTemplateMessagePayload =
  | {
      type: "confirm";
      text: string;
      confirmLabel: string;
      confirmData: string;
      cancelLabel: string;
      cancelData: string;
      altText?: string;
    }
  | {
      type: "buttons";
      title: string;
      text: string;
      actions: Array<{
        type: "message" | "uri" | "postback";
        label: string;
        data?: string;
        uri?: string;
      }>;
      thumbnailImageUrl?: string;
      altText?: string;
    }
  | {
      type: "carousel";
      columns: Array<{
        title?: string;
        text: string;
        thumbnailImageUrl?: string;
        actions: Array<{
          type: "message" | "uri" | "postback";
          label: string;
          data?: string;
          uri?: string;
        }>;
      }>;
      altText?: string;
    };

export type LineChannelData = {
  quickReplies?: string[];
  location?: {
    title: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  flexMessage?: LineFlexMessagePayload;
  templateMessage?: LineTemplateMessagePayload;
};
