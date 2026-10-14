// The committed OpenAPI document (openapi/kolo-gateway.openapi.json) is built here: the static
// route table plus the core WebSocket methods. Deterministic for a given package version; the
// live GET /doc adds channel-plugin methods and runtime webhook routes on top.
import { createGatewayRouter } from "./http-routes.js";
import { BASE_GATEWAY_METHODS, GATEWAY_EVENTS } from "./server-methods-list.js";

export function buildStaticGatewayOpenApi(version: string): Record<string, unknown> {
  return createGatewayRouter().toOpenAPI({
    version,
    websocket: { methods: BASE_GATEWAY_METHODS, events: GATEWAY_EVENTS },
  });
}

export function serializeOpenApi(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
