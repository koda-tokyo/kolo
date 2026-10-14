import type { KoLoConfig } from "../config/config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";
import {
  applyResidentNotes,
  prepareResidentInbound,
  residentGate,
} from "../channels/resident/ingress.js";
import { residentChannelOf } from "../channels/resident/ingress.js";
import { ownerBindingActive, takeOwnerWelcome } from "../channels/resident/owner-binding.js";
import { queuedReplyDeliverer } from "../channels/resident/queued-deliver.js";
import { channelText } from "../channels/resident/templates.js";
import { logVerbose } from "../globals.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatcher,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";

export type DispatchInboundResult = DispatchFromConfigResult;

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KoLoConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);
  // M14: resident ingress — identity, locale, inbox copies, attach broadcast, audit. Never
  // blocks the reply path.
  try {
    const inbound = prepareResidentInbound({ ctx: finalized, cfg: params.cfg });
    if (inbound) {
      const gate = await residentGate({ inbound, cfg: params.cfg });
      if (gate) {
        if (gate.reply) {
          params.dispatcher.sendFinalReply({ text: gate.reply });
        }
        return {
          queuedFinal: Boolean(gate.reply),
          counts: params.dispatcher.getQueuedCounts(),
        };
      }
      applyResidentNotes(finalized, inbound);
      // M16: an owner bound outside a conversation (WhatsApp linked device) gets one welcome
      // line on their first message, before the agent's answer.
      if (
        ownerBindingActive() &&
        takeOwnerWelcome({
          channel: inbound.channel,
          accountId: inbound.accountId,
          candidates: [
            finalized.SenderId,
            finalized.SenderE164,
            finalized.SenderUsername,
            finalized.From,
          ],
        })
      ) {
        params.dispatcher.sendBlockReply({ text: channelText(inbound.locale, "owner.welcome") });
      }
    }
  } catch (err) {
    logVerbose(`dispatch: resident ingress failed: ${String(err)}`);
  }
  return await dispatchReplyFromConfig({
    ctx: finalized,
    cfg: params.cfg,
    dispatcher: params.dispatcher,
    replyOptions: params.replyOptions,
    replyResolver: params.replyResolver,
  });
}

/** M14c: a channel reply goes through the per-channel outbound queue (retry, dedupe, dead letter). */
function withOutboundQueue<T extends ReplyDispatcherOptions>(
  ctx: MsgContext | FinalizedMsgContext,
  cfg: KoLoConfig,
  options: T,
): T {
  const channel = residentChannelOf(ctx);
  const to = (ctx.OriginatingTo ?? ctx.To ?? ctx.From)?.toString().trim();
  if (!channel || !to) {
    return options;
  }
  return {
    ...options,
    deliver: queuedReplyDeliverer({
      cfg,
      channel,
      accountId: ctx.AccountId?.trim() || undefined,
      to,
      messageId: ctx.MessageSid,
      origin: "inbound",
      // The message reached dispatch, so the channel's access control admitted the sender:
      // what the resident sends back is a reply (M16 reply policy), not a proactive send.
      replyTo: {
        senderId: ctx.SenderId?.toString().trim() || undefined,
        inboundAt: Date.now(),
        admitted: true,
      },
      deliver: options.deliver,
    }),
  };
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KoLoConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcherWithTyping(
    withOutboundQueue(params.ctx, params.cfg, params.dispatcherOptions),
  );

  const result = await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: {
      ...params.replyOptions,
      ...replyOptions,
    },
  });

  markDispatchIdle();
  return result;
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KoLoConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(
    withOutboundQueue(params.ctx, params.cfg, params.dispatcherOptions),
  );
  const result = await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
  await dispatcher.waitForIdle();
  return result;
}
