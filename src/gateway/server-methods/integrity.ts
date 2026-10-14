// `integrity.status` (M2b): live re-verification of the constitution registry.
import type { GatewayRequestHandlers } from "./types.js";
import { getIntegrityStatus } from "../../integrity/gate.js";

export const integrityHandlers: GatewayRequestHandlers = {
  "integrity.status": async ({ respond }) => {
    const { integrity, mode, result } = getIntegrityStatus({ force: true });
    respond(
      true,
      {
        integrity,
        mode,
        state: result?.state ?? "unconfigured",
        checked: result?.checked ?? 0,
        registryPath: result?.registryPath,
        verifiedAt: result?.verifiedAt,
        problems: (result?.problems ?? []).map((p) => ({
          path: p.path,
          kind: p.kind,
          message: p.message,
        })),
      },
      undefined,
    );
  },
};
