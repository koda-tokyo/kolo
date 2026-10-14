// WS plugin control (KoLo 2.0, M7): plugins.list (observe) and plugins.reload (admin).
import type { GatewayRequestHandlers } from "./types.js";
import { listPluginsLive, reloadPluginLive } from "../plugins-http.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const pluginsHandlers: GatewayRequestHandlers = {
  "plugins.list": ({ respond }) => {
    respond(true, listPluginsLive(), undefined);
  },
  "plugins.reload": async ({ params, client, respond }) => {
    const id = typeof params.id === "string" ? params.id : "";
    if (!id.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    const outcome = await reloadPluginLive({
      id,
      source: "ws:plugins.reload",
      identity: client?.pairing ? `device:${client.pairing.fingerprint}` : "owner:ws",
    });
    if (!outcome.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, outcome.message));
      return;
    }
    respond(true, { plugin: outcome.result }, undefined);
  },
};
