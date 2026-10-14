// `policy.status` (observe), `policy.kill` and `policy.release` (admin; narrowed by the
// policy's `kill.mayFlip`) — KoLo 2.0, M13c. The WS scope matrix in scopes.ts gates the
// methods; this file applies `mayFlip` and shapes the answer.
import type { GatewayRequestHandlers } from "./types.js";
import { getPolicyEngine } from "../../policy/engine.js";
import { parseKillBody } from "../policy-http.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const policyHandlers: GatewayRequestHandlers = {
  "policy.status": ({ respond }) => {
    respond(true, { status: getPolicyEngine().status() });
  },

  "policy.kill": ({ params, respond, client }) => {
    flip("kill", params, respond, client);
  },

  "policy.release": ({ params, respond, client }) => {
    flip("release", params, respond, client);
  },
};

type HandlerArgs = Parameters<GatewayRequestHandlers[string]>[0];

function flip(
  action: "kill" | "release",
  params: HandlerArgs["params"],
  respond: HandlerArgs["respond"],
  client: HandlerArgs["client"],
): void {
  const engine = getPolicyEngine();
  const scope = client?.pairing?.scope ?? "owner";
  if (!engine.mayFlip(scope)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `policy kill switch may not be flipped by scope ${scope} (kill.mayFlip)`,
      ),
    );
    return;
  }
  const parsed = parseKillBody(params);
  if (!parsed.ok) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `invalid policy.${action} params: ${parsed.error}`),
    );
    return;
  }
  const agent = parsed.body.all ? null : (parsed.body.agent ?? null);
  const by = client?.pairing
    ? `device:${client.pairing.deviceName}#${client.pairing.fingerprint.slice(0, 12)}`
    : (client?.connect?.device?.id ?? "operator");
  if (action === "kill") {
    const result = engine.kill({ agent, by, reason: parsed.body.reason });
    respond(true, { agent, jobsAborted: result.jobsAborted, status: engine.status() });
    return;
  }
  const result = engine.release({ agent, by });
  respond(true, { agent, released: result.released, status: engine.status() });
}
