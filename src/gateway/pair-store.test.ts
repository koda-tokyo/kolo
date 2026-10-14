import { generateDeviceKey, pairProofPayload, signWithDeviceKey } from "@kodasoken/kolo-client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../security/audit-log.js";
import {
  ACCESS_TOKEN_PREFIX,
  CredentialStore,
  INVITATION_CODE_PREFIX,
  MAX_INVITE_TTL_MS,
  REFRESH_TOKEN_PREFIX,
} from "./pair-store.js";

type Clock = { now: number };

function makeStore(clock: Clock, opts: ConstructorParameters<typeof CredentialStore>[0] = {}) {
  const events: AuditEvent[] = [];
  const store = new CredentialStore({
    filePath: null,
    now: () => new Date(clock.now),
    audit: (event) => {
      const full = { ts: new Date(clock.now).toISOString(), ...event } as AuditEvent;
      events.push(full);
      return full;
    },
    ...opts,
  });
  return { store, events };
}

async function proof(
  key: { privateKeyPem: string },
  purpose: "redeem" | "refresh",
  nonce: string,
  secret: string,
) {
  return await signWithDeviceKey(key.privateKeyPem, await pairProofPayload(purpose, nonce, secret));
}

async function redeemAs(
  store: CredentialStore,
  key: Awaited<ReturnType<typeof generateDeviceKey>>,
  code: string,
  name = "laptop",
) {
  const { nonce } = store.issueNonce();
  return store.redeem({
    code,
    deviceKeyPub: key.publicKey,
    deviceName: name,
    nonce,
    signature: await proof(key, "redeem", nonce, code),
  });
}

async function refreshAs(
  store: CredentialStore,
  key: Awaited<ReturnType<typeof generateDeviceKey>>,
  refreshToken: string,
) {
  const { nonce } = store.issueNonce();
  return store.refresh({
    refreshToken,
    nonce,
    signature: await proof(key, "refresh", nonce, refreshToken),
  });
}

const T0 = Date.parse("2026-10-13T10:00:00Z");

describe("CredentialStore (M3a)", () => {
  let clock: Clock;
  beforeEach(() => {
    clock = { now: T0 };
  });

  describe("invitations", () => {
    it("are single use, random 128-bit codes stored only as a hash, capped at 60 minutes", async () => {
      const { store, events } = makeStore(clock);
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "owner:token",
        creatorScope: "owner",
        label: "phone",
        ttlMs: 5 * 60 * 60 * 1000,
      });
      expect(made.ok).toBe(true);
      if (!made.ok) {
        return;
      }
      expect(made.code.startsWith(INVITATION_CODE_PREFIX)).toBe(true);
      // 16 random bytes → 22 base64url chars
      expect(made.code.length).toBe(INVITATION_CODE_PREFIX.length + 22);
      expect(Date.parse(made.invitation.expiresAt) - T0).toBe(MAX_INVITE_TTL_MS);
      expect(JSON.stringify(store.listInvitations())).not.toContain(made.code);
      expect(events.at(-1)).toMatchObject({ action: "pair.invite", outcome: "allowed" });

      const key = await generateDeviceKey();
      const first = await redeemAs(store, key, made.code);
      expect(first.ok).toBe(true);
      const second = await redeemAs(store, await generateDeviceKey(), made.code);
      expect(second).toMatchObject({ ok: false, reason: "code_used" });
      expect(store.listInvitations()[0]).toMatchObject({
        status: "redeemed",
        redeemedBy: key.fingerprint,
      });
    });

    it("expire after their TTL (default 10 minutes) and can be revoked before use", async () => {
      const { store } = makeStore(clock);
      const made = store.createInvitation({
        scope: "observe",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      expect(Date.parse(made.invitation.expiresAt) - T0).toBe(10 * 60 * 1000);
      clock.now = T0 + 10 * 60 * 1000 + 1;
      expect(await redeemAs(store, await generateDeviceKey(), made.code)).toMatchObject({
        ok: false,
        reason: "code_expired",
      });
      expect(store.listInvitations()[0].status).toBe("expired");

      clock.now = T0;
      const other = store.createInvitation({
        scope: "observe",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!other.ok) {
        throw new Error("invite failed");
      }
      expect(store.revokeInvitation(other.invitation.id, "o")).toBe(true);
      expect(store.revokeInvitation(other.invitation.id, "o")).toBe(false);
      expect(await redeemAs(store, await generateDeviceKey(), other.code)).toMatchObject({
        ok: false,
        reason: "code_revoked",
      });
      expect(await redeemAs(store, await generateDeviceKey(), "kpi_nope")).toMatchObject({
        ok: false,
        reason: "invalid_code",
      });
    });

    it("never grant more than the creator holds, and never owner", () => {
      const { store } = makeStore(clock);
      expect(
        store.createInvitation({ scope: "owner", createdBy: "o", creatorScope: "owner" }),
      ).toMatchObject({
        ok: false,
        reason: "invalid_scope",
      });
      expect(
        store.createInvitation({ scope: "admin", createdBy: "d", creatorScope: "attach" }),
      ).toMatchObject({
        ok: false,
        reason: "scope_exceeds_creator",
      });
      expect(
        store.createInvitation({ scope: "attach", createdBy: "d", creatorScope: "admin" }).ok,
      ).toBe(true);
    });
  });

  describe("device-key proof", () => {
    it("rejects a redeem whose signature does not match the presented key, or whose nonce is stale/reused", async () => {
      const { store } = makeStore(clock);
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const honest = await generateDeviceKey();
      const thief = await generateDeviceKey();
      const { nonce } = store.issueNonce();
      // Thief presents the honest public key but signs with their own key.
      expect(
        store.redeem({
          code: made.code,
          deviceKeyPub: honest.publicKey,
          nonce,
          signature: await proof(thief, "redeem", nonce, made.code),
        }),
      ).toMatchObject({ ok: false, reason: "invalid_signature" });
      // Nonce was consumed by the failed attempt: a correct signature over it is now refused.
      expect(
        store.redeem({
          code: made.code,
          deviceKeyPub: honest.publicKey,
          nonce,
          signature: await proof(honest, "redeem", nonce, made.code),
        }),
      ).toMatchObject({ ok: false, reason: "invalid_nonce" });
      // Expired nonce.
      const late = store.issueNonce();
      clock.now = T0 + 3 * 60 * 1000;
      expect(
        store.redeem({
          code: made.code,
          deviceKeyPub: honest.publicKey,
          nonce: late.nonce,
          signature: await proof(honest, "redeem", late.nonce, made.code),
        }),
      ).toMatchObject({ ok: false, reason: "invalid_nonce" });
      // A bad public key is refused before the invitation is spent.
      expect(
        store.redeem({ code: made.code, deviceKeyPub: "not-a-key", nonce: "x", signature: "y" }),
      ).toMatchObject({ ok: false, reason: "invalid_public_key" });
      expect(store.listInvitations()[0].status).toBe("pending");
      // Finally the honest device redeems.
      expect((await redeemAs(store, honest, made.code)).ok).toBe(true);
    });
  });

  describe("access + refresh families", () => {
    it("issues bound tokens, rotates on refresh and revokes the family on reuse", async () => {
      const { store, events } = makeStore(clock);
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      const c0 = issued.credential;
      expect(c0.accessToken.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
      expect(c0.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
      expect(c0.device).toMatchObject({
        fingerprint: key.fingerprint,
        scope: "attach",
        status: "approved",
      });
      expect(Date.parse(c0.accessExpiresAt) - T0).toBe(60 * 60 * 1000);
      expect(Date.parse(c0.refreshExpiresAt) - T0).toBe(30 * 24 * 60 * 60 * 1000);
      const p0 = store.verifyAccess(c0.accessToken);
      expect(p0).toMatchObject({
        ok: true,
        principal: { kind: "pair", scope: "attach", familyId: c0.familyId },
      });

      // Rotate: new pair, old access token dead, generation bumps.
      const r1 = await refreshAs(store, key, c0.refreshToken);
      if (!r1.ok) {
        throw new Error(r1.reason);
      }
      const c1 = r1.credential;
      expect(c1.familyId).toBe(c0.familyId);
      expect(c1.generation).toBe(1);
      expect(c1.accessToken).not.toBe(c0.accessToken);
      expect(c1.refreshToken).not.toBe(c0.refreshToken);
      expect(store.verifyAccess(c0.accessToken)).toMatchObject({
        ok: false,
        reason: "invalid_token",
      });
      expect(store.verifyAccess(c1.accessToken).ok).toBe(true);
      expect(events.at(-1)).toMatchObject({ action: "pair.refresh", outcome: "allowed" });

      // Reuse of the retired refresh token: whole family revoked, audited.
      const reuse = await refreshAs(store, key, c0.refreshToken);
      expect(reuse).toMatchObject({ ok: false, reason: "reuse_detected" });
      expect(events.at(-1)).toMatchObject({
        action: "pair.reuse_detected",
        outcome: "denied",
        device: key.fingerprint,
      });
      expect(store.verifyAccess(c1.accessToken)).toMatchObject({
        ok: false,
        reason: "family_revoked",
      });
      expect(await refreshAs(store, key, c1.refreshToken)).toMatchObject({
        ok: false,
        reason: "family_revoked",
      });
      // A second replay is still reported as reuse (not "invalid").
      expect(await refreshAs(store, key, c0.refreshToken)).toMatchObject({
        ok: false,
        reason: "reuse_detected",
      });
      expect(store.listFamilies(key.fingerprint)[0]).toMatchObject({
        revokedReason: "reuse_detected",
      });
    });

    it("expires access tokens on their TTL while the refresh token still rotates", async () => {
      const { store } = makeStore(clock, { accessTtlMs: 1000 });
      const made = store.createInvitation({
        scope: "observe",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      clock.now = T0 + 1001;
      expect(store.verifyAccess(issued.credential.accessToken)).toMatchObject({
        ok: false,
        reason: "token_expired",
      });
      const rotated = await refreshAs(store, key, issued.credential.refreshToken);
      expect(rotated.ok).toBe(true);
      if (rotated.ok) {
        expect(store.verifyAccess(rotated.credential.accessToken).ok).toBe(true);
      }
      // Family expiry ends refresh too.
      clock.now = T0 + 31 * 24 * 60 * 60 * 1000;
      if (rotated.ok) {
        expect(await refreshAs(store, key, rotated.credential.refreshToken)).toMatchObject({
          ok: false,
          reason: "family_expired",
        });
      }
    });

    it("binds the refresh to the device key: another key cannot rotate the family", async () => {
      const { store } = makeStore(clock);
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      const thief = await generateDeviceKey();
      expect(await refreshAs(store, thief, issued.credential.refreshToken)).toMatchObject({
        ok: false,
        reason: "invalid_signature",
      });
      // The legitimate holder can still rotate afterwards (no reuse was triggered).
      expect((await refreshAs(store, key, issued.credential.refreshToken)).ok).toBe(true);
    });
  });

  describe("TOFU, approval and revocation", () => {
    it("auto-approves only through an auto-approve invitation; otherwise pending until approved", async () => {
      const { store, events } = makeStore(clock);
      const manual = store.createInvitation({
        scope: "attach",
        createdBy: "owner:token",
        creatorScope: "owner",
        autoApprove: false,
      });
      if (!manual.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, manual.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      expect(issued.credential.device.status).toBe("pending");
      expect(store.verifyAccess(issued.credential.accessToken)).toMatchObject({
        ok: false,
        reason: "device_pending",
      });
      // Pending devices may still refresh (they keep their family alive while waiting).
      const rotated = await refreshAs(store, key, issued.credential.refreshToken);
      expect(rotated.ok).toBe(true);
      expect(store.approveDevice("nope", "o")).toBe(false);
      expect(store.approveDevice(key.fingerprint, "owner:token")).toBe(true);
      expect(events.at(-1)).toMatchObject({
        action: "pair.approve",
        outcome: "allowed",
        device: key.fingerprint,
      });
      if (rotated.ok) {
        expect(store.verifyAccess(rotated.credential.accessToken)).toMatchObject({
          ok: true,
          principal: { scope: "attach", fingerprint: key.fingerprint },
        });
      }
      expect(store.approveDevice(key.fingerprint, "o")).toBe(false);
    });

    it("revoking a device kills every family and is audited", async () => {
      const { store, events } = makeStore(clock);
      const made = store.createInvitation({
        scope: "admin",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      expect(store.revokeDevice(key.fingerprint, "owner:token")).toBe(true);
      expect(events.at(-1)).toMatchObject({
        action: "pair.revoke",
        outcome: "allowed",
        device: key.fingerprint,
      });
      expect(store.verifyAccess(issued.credential.accessToken)).toMatchObject({
        ok: false,
        reason: "device_revoked",
      });
      expect(await refreshAs(store, key, issued.credential.refreshToken)).toMatchObject({
        ok: false,
        reason: "device_revoked",
      });
      expect(store.listDevices()[0]).toMatchObject({
        status: "revoked",
        families: { active: 0, total: 1 },
      });
      expect(store.revokeDevice(key.fingerprint, "o")).toBe(false);
    });
  });

  describe("dated re-consent", () => {
    it("forces a device paired longer than reconsentDays ago to pair again, once, audited", async () => {
      const { store, events } = makeStore(clock, { reconsentDays: 2 });
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      clock.now = T0 + 2 * 24 * 60 * 60 * 1000 + 1;
      expect(store.verifyAccess(issued.credential.accessToken)).toMatchObject({
        ok: false,
        reason: "reconsent_required",
      });
      const reconsent = events.filter((e) => e.action === "pair.reconsent");
      expect(reconsent).toHaveLength(1);
      expect(reconsent[0]).toMatchObject({ device: key.fingerprint, outcome: "denied" });
      expect(await refreshAs(store, key, issued.credential.refreshToken)).toMatchObject({
        ok: false,
        reason: "reconsent_required",
      });
      expect(store.listDevices()[0]).toMatchObject({ status: "reconsent" });
      expect(events.filter((e) => e.action === "pair.reconsent")).toHaveLength(1);

      // Re-pair with the same key through a fresh invitation: trusted again, old family stays dead.
      const again = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!again.ok) {
        throw new Error("invite failed");
      }
      const fresh = await redeemAs(store, key, again.code);
      expect(fresh.ok).toBe(true);
      if (fresh.ok) {
        expect(store.verifyAccess(fresh.credential.accessToken).ok).toBe(true);
        expect(fresh.credential.familyId).not.toBe(issued.credential.familyId);
      }
      expect(store.listDevices()).toHaveLength(1);
      expect(store.listDevices()[0]).toMatchObject({
        status: "approved",
        families: { active: 1, total: 2 },
      });
    });
  });

  describe("persistence", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-pair-"));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes credentials.json 0600 atomically with hashes only, and reloads revocation state", async () => {
      const file = path.join(dir, "secrets", "credentials.json");
      const { store } = makeStore(clock, { filePath: file });
      const made = store.createInvitation({
        scope: "attach",
        createdBy: "o",
        creatorScope: "owner",
      });
      if (!made.ok) {
        throw new Error("invite failed");
      }
      const key = await generateDeviceKey();
      const issued = await redeemAs(store, key, made.code);
      if (!issued.ok) {
        throw new Error(issued.reason);
      }
      const rotated = await refreshAs(store, key, issued.credential.refreshToken);
      if (!rotated.ok) {
        throw new Error(rotated.reason);
      }
      const raw = fs.readFileSync(file, "utf8");
      for (const secret of [
        made.code,
        issued.credential.accessToken,
        issued.credential.refreshToken,
        rotated.credential.accessToken,
        rotated.credential.refreshToken,
      ]) {
        expect(raw).not.toContain(secret);
      }
      if (process.platform !== "win32") {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      }
      expect(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp"))).toEqual([]);

      // A fresh process sees the same families: the live token works, the retired one is reuse.
      const { store: reloaded } = makeStore(clock, { filePath: file });
      expect(reloaded.verifyAccess(rotated.credential.accessToken)).toMatchObject({ ok: true });
      expect(reloaded.verifyAccess(issued.credential.accessToken)).toMatchObject({ ok: false });
      expect(await refreshAs(reloaded, key, issued.credential.refreshToken)).toMatchObject({
        ok: false,
        reason: "reuse_detected",
      });
      const { store: third } = makeStore(clock, { filePath: file });
      expect(third.verifyAccess(rotated.credential.accessToken)).toMatchObject({
        ok: false,
        reason: "family_revoked",
      });
    });
  });
});
