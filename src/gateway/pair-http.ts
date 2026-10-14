// HTTP handlers for the pairing routes (KoLo 2.0, M3a). Auth and scope are enforced by the
// router (pair-credential authenticator) before these run; the public redeem/refresh/nonce
// routes rely on the credential-attempt limiter (`/pair` paths count as attempts).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./http-registry.js";
import { readJsonBody } from "./hooks.js";
import { sendJson } from "./http-common.js";
import { getHttpPrincipal, principalIdentity } from "./pair-auth.js";
import { type CredentialStore, getCredentialStore } from "./pair-store.js";
import { parseInvitableScope } from "./scopes.js";
import { parseSessionAllowlist } from "./session-allowlist.js";

const MAX_BODY_BYTES = 16 * 1024;

type Deps = { store?: CredentialStore; resolveStore?: () => CredentialStore };

function storeOf(deps: Deps): CredentialStore {
  return deps.store ?? deps.resolveStore?.() ?? getCredentialStore();
}

function clientIp(req: IncomingMessage): string | undefined {
  return req.socket?.remoteAddress ?? undefined;
}

async function body(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    sendJson(res, parsed.error === "payload too large" ? 413 : 400, {
      ok: false,
      error: parsed.error,
    });
    return null;
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    sendJson(res, 400, { ok: false, error: "body must be a JSON object" });
    return null;
  }
  return parsed.value as Record<string, unknown>;
}

function requirePrincipal(req: IncomingMessage, res: ServerResponse) {
  const principal = getHttpPrincipal(req);
  if (!principal) {
    // The router authenticates first; reaching here without a principal is a wiring bug.
    sendJson(res, 401, { error: { message: "Unauthorized", type: "unauthorized" } });
    return null;
  }
  return principal;
}

export function createPairHttpHandlers(deps: Deps = {}) {
  return {
    createPairInvitation: async (req: IncomingMessage, res: ServerResponse) => {
      const principal = requirePrincipal(req, res);
      if (!principal) {
        return true;
      }
      const data = await body(req, res);
      if (!data) {
        return true;
      }
      const scope = parseInvitableScope(data.scope);
      if (!scope) {
        sendJson(res, 400, { ok: false, error: "scope must be observe, attach or admin" });
        return true;
      }
      const ttlRaw = data.ttlMinutes;
      if (ttlRaw !== undefined && (typeof ttlRaw !== "number" || !(ttlRaw > 0 && ttlRaw <= 60))) {
        sendJson(res, 400, { ok: false, error: "ttlMinutes must be a number in 1..60" });
        return true;
      }
      if (data.label !== undefined && typeof data.label !== "string") {
        sendJson(res, 400, { ok: false, error: "label must be a string" });
        return true;
      }
      if (data.autoApprove !== undefined && typeof data.autoApprove !== "boolean") {
        sendJson(res, 400, { ok: false, error: "autoApprove must be a boolean" });
        return true;
      }
      const allowlist = parseSessionAllowlist(data.sessions);
      if (!allowlist.ok) {
        sendJson(res, 400, { ok: false, error: allowlist.reason });
        return true;
      }
      const result = storeOf(deps).createInvitation({
        scope,
        ttlMs: typeof ttlRaw === "number" ? ttlRaw * 60_000 : undefined,
        label: typeof data.label === "string" ? data.label : undefined,
        createdBy: principalIdentity(principal),
        creatorScope: principal.scope,
        autoApprove: typeof data.autoApprove === "boolean" ? data.autoApprove : undefined,
        sessions: allowlist.sessions,
      });
      if (!result.ok) {
        sendJson(res, result.reason === "scope_exceeds_creator" ? 403 : 400, {
          ok: false,
          error: result.reason,
        });
        return true;
      }
      const { codeHash: _hash, ...invitation } = result.invitation;
      sendJson(res, 201, {
        ok: true,
        invitation: { ...invitation, status: "pending" },
        // Shown once: the store keeps only its hash.
        code: result.code,
      });
      return true;
    },

    listPairInvitations: (_req: IncomingMessage, res: ServerResponse) => {
      sendJson(res, 200, { ok: true, invitations: storeOf(deps).listInvitations() });
      return true;
    },

    revokePairInvitation: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const principal = requirePrincipal(req, res);
      if (!principal) {
        return true;
      }
      const id = ctx.params.id;
      if (!storeOf(deps).revokeInvitation(id, principalIdentity(principal))) {
        sendJson(res, 404, { ok: false, error: "invitation not found or already spent" });
        return true;
      }
      sendJson(res, 200, { ok: true, id });
      return true;
    },

    createPairNonce: (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, { ok: true, ...storeOf(deps).issueNonce() });
      return true;
    },

    redeemPairInvitation: async (req: IncomingMessage, res: ServerResponse) => {
      const data = await body(req, res);
      if (!data) {
        return true;
      }
      for (const key of ["code", "deviceKeyPub", "nonce", "signature"]) {
        const value = data[key];
        if (typeof value !== "string" || !value.trim()) {
          sendJson(res, 400, { ok: false, error: `${key} is required` });
          return true;
        }
      }
      const result = storeOf(deps).redeem({
        code: data.code,
        deviceKeyPub: data.deviceKeyPub,
        deviceName: data.deviceName,
        nonce: data.nonce,
        signature: data.signature,
        remoteIp: clientIp(req),
      });
      res.setHeader("Cache-Control", "no-store");
      if (!result.ok) {
        sendJson(res, 401, { ok: false, error: result.reason });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.credential });
      return true;
    },

    refreshPairCredential: async (req: IncomingMessage, res: ServerResponse) => {
      const data = await body(req, res);
      if (!data) {
        return true;
      }
      for (const key of ["refreshToken", "nonce", "signature"]) {
        const value = data[key];
        if (typeof value !== "string" || !value.trim()) {
          sendJson(res, 400, { ok: false, error: `${key} is required` });
          return true;
        }
      }
      const result = storeOf(deps).refresh({
        refreshToken: data.refreshToken,
        nonce: data.nonce,
        signature: data.signature,
        remoteIp: clientIp(req),
      });
      res.setHeader("Cache-Control", "no-store");
      if (!result.ok) {
        sendJson(res, 401, { ok: false, error: result.reason });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.credential });
      return true;
    },

    getPairPrincipal: (req: IncomingMessage, res: ServerResponse) => {
      const principal = requirePrincipal(req, res);
      if (!principal) {
        return true;
      }
      const view =
        principal.kind === "owner"
          ? {
              kind: "owner",
              scope: "owner",
              method: principal.method,
              ...(principal.user ? { user: principal.user } : {}),
            }
          : {
              kind: "pair",
              scope: principal.scope,
              fingerprint: principal.fingerprint,
              deviceName: principal.deviceName,
              familyId: principal.familyId,
              accessExpiresAt: principal.accessExpiresAt,
              ...(principal.sessions ? { sessions: principal.sessions } : {}),
            };
      sendJson(res, 200, { ok: true, principal: view });
      return true;
    },

    listPairDevices: (_req: IncomingMessage, res: ServerResponse) => {
      sendJson(res, 200, { ok: true, devices: storeOf(deps).listDevices() });
      return true;
    },

    approvePairDevice: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const principal = requirePrincipal(req, res);
      if (!principal) {
        return true;
      }
      const fingerprint = ctx.params.fingerprint;
      if (!storeOf(deps).approveDevice(fingerprint, principalIdentity(principal))) {
        sendJson(res, 404, { ok: false, error: "device not found or not pending" });
        return true;
      }
      sendJson(res, 200, { ok: true, fingerprint });
      return true;
    },

    revokePairDevice: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const principal = requirePrincipal(req, res);
      if (!principal) {
        return true;
      }
      const fingerprint = ctx.params.fingerprint;
      if (!storeOf(deps).revokeDevice(fingerprint, principalIdentity(principal))) {
        sendJson(res, 404, { ok: false, error: "device not found or already revoked" });
        return true;
      }
      sendJson(res, 200, { ok: true, fingerprint });
      return true;
    },
  };
}
