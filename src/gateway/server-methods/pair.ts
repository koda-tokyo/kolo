import type { PairScope } from "../scopes.js";
// WebSocket surface of pairing (KoLo 2.0, M3a): pair.redeem for a connected surface that
// pairs a device key, plus the admin verbs the TUI/Control UI use. Scope enforcement happens
// in server-methods.ts (wsMethodMinScope) before any handler here runs.
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { getCredentialStore } from "../pair-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validatePairApproveParams,
  validatePairDevicesParams,
  validatePairInviteParams,
  validatePairListParams,
  validatePairMeParams,
  validatePairNonceParams,
  validatePairRedeemParams,
  validatePairRefreshParams,
  validatePairRevokeParams,
} from "../protocol/index.js";
import { parseSessionAllowlist } from "../session-allowlist.js";

type Validator = { (value: unknown): boolean; errors?: unknown };

function invalid(respond: GatewayRequestHandlerOptions["respond"], method: string, v: Validator) {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(v.errors as Parameters<typeof formatValidationErrors>[0])}`,
    ),
  );
}

/** Who is acting: the paired device, or the owner-authenticated client. */
function actor(client: GatewayRequestHandlerOptions["client"]): {
  identity: string;
  scope: PairScope;
} {
  if (client?.pairing) {
    return { identity: `device:${client.pairing.fingerprint}`, scope: client.pairing.scope };
  }
  return { identity: `owner:ws:${client?.connect.client.id ?? "unknown"}`, scope: "owner" };
}

export const pairHandlers: GatewayRequestHandlers = {
  "pair.nonce": ({ params, respond }) => {
    if (!validatePairNonceParams(params)) {
      return invalid(respond, "pair.nonce", validatePairNonceParams);
    }
    respond(true, getCredentialStore().issueNonce(), undefined);
  },
  "pair.redeem": ({ params, respond }) => {
    if (!validatePairRedeemParams(params)) {
      return invalid(respond, "pair.redeem", validatePairRedeemParams);
    }
    const result = getCredentialStore().redeem(
      params as Parameters<ReturnType<typeof getCredentialStore>["redeem"]>[0],
    );
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_PAIRED, `pair.redeem: ${result.reason}`));
      return;
    }
    respond(true, result.credential, undefined);
  },
  "pair.refresh": ({ params, respond }) => {
    if (!validatePairRefreshParams(params)) {
      return invalid(respond, "pair.refresh", validatePairRefreshParams);
    }
    const result = getCredentialStore().refresh(
      params as Parameters<ReturnType<typeof getCredentialStore>["refresh"]>[0],
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_PAIRED, `pair.refresh: ${result.reason}`),
      );
      return;
    }
    respond(true, result.credential, undefined);
  },
  "pair.me": ({ params, respond, client }) => {
    if (!validatePairMeParams(params)) {
      return invalid(respond, "pair.me", validatePairMeParams);
    }
    const p = client?.pairing;
    respond(
      true,
      p
        ? {
            kind: "pair",
            scope: p.scope,
            fingerprint: p.fingerprint,
            deviceName: p.deviceName,
            familyId: p.familyId,
            accessExpiresAt: p.accessExpiresAt,
            ...(p.sessions ? { sessions: p.sessions } : {}),
          }
        : { kind: "owner", scope: "owner" },
      undefined,
    );
  },
  "pair.invite": ({ params, respond, client }) => {
    if (!validatePairInviteParams(params)) {
      return invalid(respond, "pair.invite", validatePairInviteParams);
    }
    const { identity, scope } = actor(client);
    const p = params as {
      scope: string;
      ttlMinutes?: number;
      label?: string;
      autoApprove?: boolean;
      sessions?: string[];
    };
    const allowlist = parseSessionAllowlist(p.sessions);
    if (!allowlist.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, allowlist.reason));
      return;
    }
    const result = getCredentialStore().createInvitation({
      scope: p.scope,
      ttlMs: p.ttlMinutes ? p.ttlMinutes * 60_000 : undefined,
      label: p.label,
      createdBy: identity,
      creatorScope: scope,
      autoApprove: p.autoApprove,
      sessions: allowlist.sessions,
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    const { codeHash: _hash, ...invitation } = result.invitation;
    respond(
      true,
      { invitation: { ...invitation, status: "pending" }, code: result.code },
      undefined,
    );
  },
  "pair.list": ({ params, respond }) => {
    if (!validatePairListParams(params)) {
      return invalid(respond, "pair.list", validatePairListParams);
    }
    respond(true, { invitations: getCredentialStore().listInvitations() }, undefined);
  },
  "pair.devices": ({ params, respond }) => {
    if (!validatePairDevicesParams(params)) {
      return invalid(respond, "pair.devices", validatePairDevicesParams);
    }
    respond(true, { devices: getCredentialStore().listDevices() }, undefined);
  },
  "pair.approve": ({ params, respond, client }) => {
    if (!validatePairApproveParams(params)) {
      return invalid(respond, "pair.approve", validatePairApproveParams);
    }
    const { fingerprint } = params as { fingerprint: string };
    if (!getCredentialStore().approveDevice(fingerprint, actor(client).identity)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device not found or not pending"),
      );
      return;
    }
    respond(true, { fingerprint }, undefined);
  },
  "pair.revoke": ({ params, respond, client }) => {
    if (!validatePairRevokeParams(params)) {
      return invalid(respond, "pair.revoke", validatePairRevokeParams);
    }
    const { fingerprint, invitationId } = params as { fingerprint?: string; invitationId?: string };
    const store = getCredentialStore();
    const by = actor(client).identity;
    if (fingerprint) {
      if (!store.revokeDevice(fingerprint, by)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "device not found or already revoked"),
        );
        return;
      }
      respond(true, { fingerprint }, undefined);
      return;
    }
    if (invitationId) {
      if (!store.revokeInvitation(invitationId, by)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invitation not found or already spent"),
        );
        return;
      }
      respond(true, { invitationId }, undefined);
      return;
    }
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "fingerprint or invitationId required"),
    );
  },
};
