// Messaging pipes as gateway clients (KoLo 2.0, M3b).
//
// A direct-pipe send (`kurahi message send` from a terminal, to LINE, WhatsApp or any other
// channel) no longer touches the agent's session store or transcript from the CLI process.
// It opens one authenticated gateway connection, attaches to the agent session that
// conversation belongs to (`session.attach` with channel + target, mode "pipe", audited as
// session.attach / session.detach), asks the gateway to deliver through the `send` method —
// which mirrors the outbound text into that session the way every other client's turn is
// recorded — and detaches. The house rule stays intact: only an explicit TUI/CLI client ever
// triggers a send; the gateway never replies on its own through this path.
//
// If the gateway is unreachable the send fails loudly (exit 3 from the CLI); there is no
// silent in-process fallback.
import type { KoLoConfig } from "../../config/config.js";
import { resolveKoloHome } from "../../config/kolo-home.js";
import { isGatewayUnreachableError, withGatewaySession } from "../../gateway/call.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../utils/message-channel.js";

export const PIPE_UNREACHABLE_EXIT = 3;

export class PipeUnreachableError extends Error {
  readonly exitCode = PIPE_UNREACHABLE_EXIT;
  constructor(message: string) {
    super(message);
    this.name = "PipeUnreachableError";
  }
}

export type PipeSendParams = {
  cfg: KoLoConfig;
  channel: string;
  to: string;
  accountId?: string;
  message: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  gifPlayback?: boolean;
  idempotencyKey: string;
  url?: string;
  token?: string;
  timeoutMs?: number;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  mode?: GatewayClientMode;
};

export type PipeSendResult = {
  sessionKey: string;
  messageId: string;
  result: Record<string, unknown>;
};

type AttachResult = { session?: { key?: string } };

/** Where a pipe would connect, for the error line (never the token). */
export function describePipeTarget(cfg: KoLoConfig, env: NodeJS.ProcessEnv = process.env) {
  const home = resolveKoloHome({ env });
  const port = cfg.gateway?.port ?? 18789;
  return { home, port };
}

/** Send one message through the gateway as an attached pipe client of the agent's session. */
export async function sendThroughPipe(params: PipeSendParams): Promise<PipeSendResult> {
  const timeoutMs = params.timeoutMs ?? 30_000;
  try {
    return await withGatewaySession(
      {
        config: params.cfg,
        url: params.url,
        token: params.token,
        timeoutMs,
        clientName: params.clientName ?? GATEWAY_CLIENT_NAMES.CLI,
        clientDisplayName: params.clientDisplayName ?? `kurahi message send (${params.channel})`,
        mode: params.mode ?? GATEWAY_CLIENT_MODES.CLI,
      },
      async ({ request }) => {
        const attached = await request<AttachResult>("session.attach", {
          channel: params.channel,
          to: params.to,
          ...(params.accountId ? { accountId: params.accountId } : {}),
          mode: "pipe",
        });
        const sessionKey = attached.session?.key;
        if (!sessionKey) {
          throw new Error("session.attach did not return a session key");
        }
        try {
          const result = await request<Record<string, unknown>>("send", {
            to: params.to,
            message: params.message,
            ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
            ...(params.mediaUrls?.length ? { mediaUrls: params.mediaUrls } : {}),
            ...(params.gifPlayback ? { gifPlayback: true } : {}),
            channel: params.channel,
            ...(params.accountId ? { accountId: params.accountId } : {}),
            sessionKey,
            idempotencyKey: params.idempotencyKey,
          });
          const messageId = typeof result.messageId === "string" ? result.messageId : "";
          return { sessionKey, messageId, result };
        } finally {
          try {
            await request("session.detach", { key: sessionKey });
          } catch {
            // The gateway detaches on close as well.
          }
        }
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isGatewayUnreachableError(err)) {
      const { home, port } = describePipeTarget(params.cfg);
      throw new PipeUnreachableError(
        `gateway unreachable for the ${params.channel} pipe (state dir ${home}, port ${port}): ${message.split("\n")[0]}. ` +
          "Start it (`kurahi gateway` or `kurahi service start`); pipes never send without the gateway.",
      );
    }
    throw err;
  }
}
