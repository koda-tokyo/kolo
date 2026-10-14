// HTTP handlers for channel-native residents (KoLo 2.0, M14): the generic webhook ingress and
// the per-channel delivery status, declared in http-routes.ts. The router authenticates
// (attach scope for inbound, observe for status).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, RouteHandler } from "./http-registry.js";
import { auditSafe } from "../audit/audit-log.js";
import { deliverySnapshot, resolveDeliveryLimits } from "../channels/resident/outbound-queue.js";
import {
  handleWebhookInbound,
  postWebhookOutbound,
  resolveWebhookAccount,
  validateWebhookInbound,
  WEBHOOK_CHANNEL_ID,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookOutboundPost,
} from "../channels/resident/webhook-channel.js";
import { loadConfig } from "../config/config.js";
import { sendJson } from "./http-common.js";

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > maxBytes) {
      return { ok: false, error: `body larger than ${maxBytes} bytes` };
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "body is not valid JSON" };
  }
}

export type ChannelsHttpDeps = {
  /** Outbound transport for the webhook channel; the delivery queue wraps it (M14c). */
  deliverWebhook?: (
    post: WebhookOutboundPost,
    target: { url: string; token?: string },
  ) => Promise<void>;
};

export function createChannelsHttpHandlers(deps: ChannelsHttpDeps = {}) {
  const postWebhookInbound: RouteHandler = async (
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
  ) => {
    res.setHeader("Cache-Control", "no-store");
    const accountId = (ctx.params.account ?? "default").trim() || "default";
    const cfg = loadConfig();
    const account = resolveWebhookAccount(cfg, accountId);
    if (!account) {
      sendJson(res, 404, {
        ok: false,
        error: `webhook channel account not configured: ${accountId}`,
      });
      return true;
    }
    const body = await readJsonBody(req, WEBHOOK_MAX_BODY_BYTES);
    if (!body.ok) {
      sendJson(res, 400, { ok: false, error: body.error });
      return true;
    }
    const inbound = validateWebhookInbound(body.value);
    if (typeof inbound === "string") {
      sendJson(res, 400, { ok: false, error: inbound });
      return true;
    }
    const outboundUrl = account.outboundUrl;
    const deliver = async (post: WebhookOutboundPost) => {
      if (!outboundUrl) {
        return;
      }
      if (deps.deliverWebhook) {
        await deps.deliverWebhook(post, { url: outboundUrl, token: account.outboundToken });
        return;
      }
      await postWebhookOutbound(outboundUrl, post, {
        token: account.outboundToken,
        dedupeKey: post.dedupeKey,
      });
    };
    try {
      const result = await handleWebhookInbound({ cfg, accountId, body: inbound, deliver });
      sendJson(res, 200, {
        ...result,
        outbound: outboundUrl ? "posted" : "none",
      });
    } catch (err) {
      void auditSafe({
        identity: inbound.from,
        action: "channel.inbound",
        outcome: "error",
        source: "channels.webhook",
        detail: { channel: WEBHOOK_CHANNEL_ID, accountId, error: String(err).slice(0, 300) },
      });
      sendJson(res, 500, { ok: false, error: "inbound dispatch failed" });
    }
    return true;
  };

  const getChannelsDeliveryStatus: RouteHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const snap = deliverySnapshot();
    sendJson(res, 200, {
      ok: true,
      ts: Date.now(),
      ...snap,
      policy: resolveDeliveryLimits(loadConfig()).policy,
    });
    return true;
  };

  return { postWebhookInbound, getChannelsDeliveryStatus };
}
