// WS methods for M6: `codeMode.run` (attach scope; the dispatcher has already applied the
// session allowlist to `sessionKey`) and `mcp.status` (observe scope).
import type { GatewayRequestHandlers } from "./types.js";
import { getMcpManager } from "../../mcp/client/manager.js";
import { runCodeModeRequest } from "../code-mode-http.js";
import { principalIdentity } from "../pair-auth.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCodeModeRunParams,
} from "../protocol/index.js";

export const codeModeHandlers: GatewayRequestHandlers = {
  "codeMode.run": async ({ params, respond, client }) => {
    if (!validateCodeModeRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid codeMode.run params: ${formatValidationErrors(validateCodeModeRunParams.errors)}`,
        ),
      );
      return;
    }
    const outcome = await runCodeModeRequest(params, {
      source: "ws:codeMode.run",
      principal: client?.pairing ? principalIdentity(client.pairing) : undefined,
    });
    if (!outcome.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, outcome.message));
      return;
    }
    respond(true, outcome.result, undefined);
  },

  "mcp.status": ({ respond }) => {
    respond(true, { servers: getMcpManager().servers() }, undefined);
  },
};
