// Adapters that put existing deliver functions behind the outbound queue (KoLo 2.0, M14c).
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { KoLoConfig } from "../../config/config.js";
import type { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import { getOutboundQueue, type OutboundOrigin, type OutboundReplyTo } from "./outbound-queue.js";

type Deliverer = (
  payload: ReplyPayload,
  info: { kind: "tool" | "block" | "final" },
) => Promise<void>;

let dispatchCounter = 0;

/** Wrap a reply dispatcher's `deliver` so each payload is a queued, retried, deduped job. */
export function queuedReplyDeliverer(input: {
  cfg: KoLoConfig;
  channel: string;
  accountId?: string;
  to: string;
  /** Provider message id of the inbound message (dedupe base); a timestamp when absent. */
  messageId?: string;
  origin?: OutboundOrigin;
  /** The inbound message these payloads answer (reply policy, M16). */
  replyTo?: OutboundReplyTo;
  deliver: Deliverer;
}): Deliverer {
  const queue = getOutboundQueue(input.cfg);
  // One dispatch = one producer; the key is message id + dispatch number + chunk, so a
  // re-dispatch of the same inbound id (already dropped by inbound dedupe) never collides
  // with an earlier delivery, while a job enqueued twice within one dispatch is dropped.
  dispatchCounter += 1;
  const base = `${input.messageId?.trim() || `t${Date.now()}`}:d${dispatchCounter}`;
  let seq = 0;
  return async (payload, info) => {
    seq += 1;
    const status = await queue.enqueue({
      channel: input.channel,
      accountId: input.accountId,
      to: input.to,
      dedupeKey: `${input.channel.toLowerCase()}:${input.accountId ?? "default"}:${base}:${seq}`,
      origin: input.origin ?? "inbound",
      replyTo: input.replyTo,
      text: payload.text,
      send: () => input.deliver(payload, info),
    });
    if (status === "dead_letter") {
      throw new Error(`delivery to ${input.channel}:${input.to} dead-lettered`);
    }
  };
}

/** Wrap `deliverOutboundPayloads` (approvals, routed replies) with the queue. */
export function queuedOutboundDeliver(
  deliver: typeof deliverOutboundPayloads,
  origin: OutboundOrigin,
): typeof deliverOutboundPayloads {
  return async (params) => {
    const queue = getOutboundQueue(params.cfg);
    const results: Awaited<ReturnType<typeof deliverOutboundPayloads>> = [];
    let seq = 0;
    for (const payload of params.payloads) {
      seq += 1;
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const status = await queue.enqueue({
        channel: params.channel,
        accountId: params.accountId ?? undefined,
        to: params.to,
        dedupeKey: `${params.channel}:${params.accountId ?? "default"}:${origin}:${stamp}:${seq}`,
        origin,
        text: payload.text,
        send: async () => {
          const out = await deliver({ ...params, payloads: [payload] });
          results.push(...out);
        },
      });
      if (status === "dead_letter") {
        throw new Error(`delivery to ${params.channel}:${params.to} dead-lettered`);
      }
    }
    return results;
  };
}
