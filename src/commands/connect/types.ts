// Shared shapes for `kurahi connect <channel>` (KoLo 2.0, M16). Every network or device touch is a
// dependency so each flow runs end to end in tests against fake channel adapters.
import type { KoLoConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { SecretStore } from "../../secrets/types.js";

export type PhoneChannel = "whatsapp" | "telegram" | "line" | "web";
export const PHONE_CHANNELS: readonly PhoneChannel[] = ["whatsapp", "telegram", "line", "web"];

export type Prompter = {
  /** Hidden input; null when the person cancelled. */
  secret: (message: string) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  select: <T extends string>(
    message: string,
    options: Array<{ value: T; label: string; hint?: string }>,
    initial?: T,
  ) => Promise<T | null>;
};

export type WhatsAppLinker = (input: {
  accountId?: string;
  force?: boolean;
  onQr: (qr: string) => void;
}) => Promise<{ e164: string | null; jid: string | null; alreadyLinked: boolean }>;

export type TelegramProbe = (
  token: string,
) => Promise<{ ok: boolean; username?: string; error?: string }>;

export type LineProbe = (
  accessToken: string,
) => Promise<{ ok: boolean; basicId?: string; displayName?: string; error?: string }>;

export type PairInvitationMaker = (input: {
  ttlMinutes: number;
  label: string;
}) => Promise<{ code: string; id: string; expiresAt: string }>;

export type ConnectDeps = {
  runtime: RuntimeEnv;
  /** Present when prompts are allowed (TTY and not --non-interactive). */
  prompter?: Prompter;
  readConfig: () => Promise<KoLoConfig>;
  writeConfig: (cfg: KoLoConfig) => Promise<void>;
  secrets: () => SecretStore;
  renderQr: (text: string) => string;
  /** Secrets piped on stdin (`--stdin`): one value per line. */
  readStdin?: () => Promise<string>;
  env: NodeJS.ProcessEnv;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** True when the local gateway answers /health. */
  probeGateway: (cfg: KoLoConfig) => Promise<boolean>;
  whatsappLink: WhatsAppLinker;
  telegramProbe: TelegramProbe;
  lineProbe: LineProbe;
  createInvitation: PairInvitationMaker;
  /** First non-internal IPv4 of this machine (LAN bind). */
  lanAddress: () => string | undefined;
  tailnetAddress: () => string | undefined;
};

export type ConnectOptions = {
  channel: PhoneChannel;
  accountId?: string;
  /** Read secrets from stdin instead of prompting. */
  stdin?: boolean;
  /** Wait for the owner's first message (default: when interactive and the gateway runs). */
  wait?: boolean;
  /** WhatsApp: relink even when a session exists. */
  force?: boolean;
  json?: boolean;
  /** Called from `kurahi init`: problems are reported, not fatal. */
  fromInit?: boolean;
};

export type ConnectResult = {
  ok: boolean;
  channel: PhoneChannel;
  /** What the QR encodes (deep link, add-friend URL, dashboard URL); null for WhatsApp. */
  link: string | null;
  /** One-time owner code (Telegram, LINE) or pairing invitation code (web). */
  code: string | null;
  expiresAt: string | null;
  owner: string | null;
  /** Exit code the CLI should use when not ok. */
  exitCode: number;
  message: string;
};
