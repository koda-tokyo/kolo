// Channel hook for owner binding (KoLo 2.0, M16). Telegram and LINE call this for a direct
// message before their DM access control, because the person claiming ownership is not on the
// allowlist yet. The answer goes through the outbound queue as a reply to that message.
import type { KoLoConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { getOutboundQueue } from "./outbound-queue.js";
import {
  extractOwnerCode,
  handleOwnerClaimMessage,
  ownerBindingActive,
  type OwnerBindingDeps,
} from "./owner-binding.js";
import { resolveChannelLocale } from "./templates.js";

/**
 * Returns true when the message was an owner claim (bound or refused with an answer) and must
 * not continue to the agent; false when it is an ordinary message.
 */
export async function ownerClaimHook(
  input: {
    cfg: KoLoConfig;
    channel: string;
    accountId?: string | null;
    senderId: string | undefined | null;
    text: string | undefined | null;
    /** Conversation the reply goes to (chat id, user id). */
    to: string;
    send: (text: string) => Promise<void>;
  },
  deps: OwnerBindingDeps = {},
): Promise<boolean> {
  if (!extractOwnerCode(input.text) || !ownerBindingActive(deps.env)) {
    return false;
  }
  try {
    const result = await handleOwnerClaimMessage(
      {
        cfg: input.cfg,
        channel: input.channel,
        accountId: input.accountId,
        senderId: input.senderId,
        text: input.text,
        locale: resolveChannelLocale(input.cfg, input.channel, input.accountId ?? undefined),
      },
      deps,
    );
    if (!result) {
      return false;
    }
    // Queue time, not the binding clock: the reply window is measured by the queue.
    const now = Date.now();
    await getOutboundQueue(input.cfg).enqueue({
      channel: input.channel,
      accountId: input.accountId ?? undefined,
      to: input.to,
      dedupeKey: `${input.channel}:${input.accountId ?? "default"}:owner:${input.senderId}:${now}`,
      origin: "inbound",
      // A bound owner is admitted from now on; a refused claim stays unadmitted.
      replyTo: { senderId: input.senderId ?? undefined, inboundAt: now, admitted: result.bound },
      text: result.reply,
      send: () => input.send(result.reply),
    });
    return true;
  } catch (err) {
    logVerbose(`${input.channel}: owner claim failed: ${String(err)}`);
    return false;
  }
}
