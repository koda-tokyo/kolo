// Pairing credential store (KoLo 2.0, M3a).
//
// One-shot invitations → device-bound credentials: a short-lived access token plus a rotating
// refresh token that belong to a *family*. Presenting a refresh token that was already rotated
// is reuse (a stolen copy raced the legitimate client): the whole family is revoked. Every
// credential is bound to an Ed25519 device key; the client proves possession by signing a
// server nonce when it redeems, refreshes and connects.
//
// State lives in memory (revocation is checked on every request without touching disk) and is
// mirrored to `<KOLO_HOME>/secrets/credentials.json` (0600, written atomically) after each
// mutation, so a restart keeps devices, families and retired refresh tokens. Secrets are stored
// hashed (SHA-256); the file never holds a usable token or invitation code.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveKoloHome } from "../config/kolo-home.js";
import {
  deriveDeviceIdFromPublicKey,
  normalizeDevicePublicKeyBase64Url,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import { recordAuditEvent } from "../security/audit-log.js";
import {
  type InvitableScope,
  type PairScope,
  parseInvitableScope,
  scopeSatisfies,
} from "./scopes.js";

export const CREDENTIALS_FILENAME = "credentials.json";
export const ACCESS_TOKEN_PREFIX = "kpa_";
export const REFRESH_TOKEN_PREFIX = "kpr_";
export const INVITATION_CODE_PREFIX = "kpi_";

export const DEFAULT_ACCESS_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_INVITE_TTL_MS = 10 * 60 * 1000;
export const MAX_INVITE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_RECONSENT_DAYS = 90;
export const DEFAULT_NONCE_TTL_MS = 2 * 60 * 1000;
const MAX_RETIRED_REFRESH_HASHES = 64;
const MAX_NONCES = 4096;

export type PairDeviceStatus = "approved" | "pending" | "revoked" | "reconsent";

export type PairInvitation = {
  id: string;
  codeHash: string;
  scope: InvitableScope;
  label?: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  /** TOFU: the device key that redeems this invitation is trusted without a separate approve. */
  autoApprove: boolean;
  /** M3b: session allowlist (globs over session keys / agent ids / labels); absent = all. */
  sessions?: string[];
  redeemedAt?: string;
  redeemedBy?: string;
  revokedAt?: string;
};

export type PairDevice = {
  fingerprint: string;
  /** Raw Ed25519 public key, base64url. */
  publicKey: string;
  name: string;
  scope: InvitableScope;
  status: PairDeviceStatus;
  pairedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  lastSeenAt?: string;
  invitationId: string;
  /** M3b: copied from the invitation; enforced on discovery, attach and every session call. */
  sessions?: string[];
  revokedAt?: string;
  reconsentAt?: string;
};

export type PairFamily = {
  id: string;
  fingerprint: string;
  scope: InvitableScope;
  createdAt: string;
  expiresAt: string;
  generation: number;
  refreshHash: string;
  accessHash: string;
  accessExpiresAt: string;
  retiredRefreshHashes: string[];
  revokedAt?: string;
  revokedReason?: string;
};

type StateFile = {
  version: 1;
  invitations: Record<string, PairInvitation>;
  devices: Record<string, PairDevice>;
  families: Record<string, PairFamily>;
};

export type PairPrincipal = {
  kind: "pair";
  scope: InvitableScope;
  fingerprint: string;
  deviceName: string;
  familyId: string;
  accessHash: string;
  accessExpiresAt: string;
  /** M3b: session allowlist of the device; absent = every session. */
  sessions?: string[];
};

export type OwnerPrincipal = {
  kind: "owner";
  scope: "owner";
  method: "token" | "password" | "tailscale";
  user?: string;
};

export type HttpPrincipal = PairPrincipal | OwnerPrincipal;

export type IssuedCredential = {
  device: Pick<PairDevice, "fingerprint" | "name" | "scope" | "status">;
  familyId: string;
  generation: number;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

export type PairDenial = {
  ok: false;
  reason:
    | "invalid_code"
    | "code_expired"
    | "code_used"
    | "code_revoked"
    | "invalid_public_key"
    | "invalid_nonce"
    | "invalid_signature"
    | "invalid_token"
    | "token_expired"
    | "family_revoked"
    | "family_expired"
    | "reuse_detected"
    | "device_pending"
    | "device_revoked"
    | "reconsent_required"
    | "device_mismatch"
    | "unknown_device";
};

export type CredentialStoreOptions = {
  /** State file path; null keeps everything in memory (tests). */
  filePath?: string | null;
  now?: () => Date;
  accessTtlMs?: number;
  refreshTtlMs?: number;
  inviteTtlMs?: number;
  reconsentDays?: number;
  nonceTtlMs?: number;
  audit?: typeof recordAuditEvent;
};

export type AuditSink = typeof recordAuditEvent;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function newId(prefix: string): string {
  return `${prefix}${b64url(randomBytes(9))}`;
}

function cleanName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/[\p{Cc}]/gu, "") : "";
  return (value || "device").slice(0, 80);
}

/** The exact string a device signs for redeem/refresh: binds nonce and secret to one key. */
export function pairProofPayload(purpose: "redeem" | "refresh", nonce: string, secret: string) {
  return `kolo-pair-v1|${purpose}|${nonce}|${sha256(secret)}`;
}

export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveKoloHome({ env }), "secrets", CREDENTIALS_FILENAME);
}

export class CredentialStore {
  private readonly filePath: string | null;
  private readonly now: () => Date;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  private readonly inviteTtlMs: number;
  private readonly reconsentMs: number;
  private readonly nonceTtlMs: number;
  private readonly audit: AuditSink;

  private invitations = new Map<string, PairInvitation>();
  private devices = new Map<string, PairDevice>();
  private families = new Map<string, PairFamily>();
  private codeIndex = new Map<string, string>();
  private refreshIndex = new Map<string, string>();
  private retiredIndex = new Map<string, string>();
  private accessIndex = new Map<string, string>();
  private nonces = new Map<string, number>();

  constructor(opts: CredentialStoreOptions = {}) {
    this.filePath = opts.filePath === undefined ? defaultCredentialsPath() : opts.filePath;
    this.now = opts.now ?? (() => new Date());
    this.accessTtlMs = opts.accessTtlMs ?? DEFAULT_ACCESS_TTL_MS;
    this.refreshTtlMs = opts.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;
    this.inviteTtlMs = Math.min(opts.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS, MAX_INVITE_TTL_MS);
    this.reconsentMs = (opts.reconsentDays ?? DEFAULT_RECONSENT_DAYS) * 24 * 60 * 60 * 1000;
    this.nonceTtlMs = opts.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
    this.audit = opts.audit ?? recordAuditEvent;
    this.load();
  }

  get path(): string | null {
    return this.filePath;
  }

  // ── persistence ─────────────────────────────────────────────────────────────────────────

  private load(): void {
    if (!this.filePath) {
      return;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let parsed: StateFile;
    try {
      parsed = JSON.parse(raw) as StateFile;
    } catch {
      throw new Error(`pairing credentials file is not valid JSON: ${this.filePath}`);
    }
    if (!parsed || parsed.version !== 1) {
      throw new Error(`pairing credentials file has an unsupported version: ${this.filePath}`);
    }
    for (const inv of Object.values(parsed.invitations ?? {})) {
      this.invitations.set(inv.id, inv);
      this.codeIndex.set(inv.codeHash, inv.id);
    }
    for (const dev of Object.values(parsed.devices ?? {})) {
      this.devices.set(dev.fingerprint, dev);
    }
    for (const fam of Object.values(parsed.families ?? {})) {
      this.families.set(fam.id, fam);
      this.refreshIndex.set(fam.refreshHash, fam.id);
      this.accessIndex.set(fam.accessHash, fam.id);
      for (const hash of fam.retiredRefreshHashes ?? []) {
        this.retiredIndex.set(hash, fam.id);
      }
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    const state: StateFile = {
      version: 1,
      invitations: Object.fromEntries(this.invitations),
      devices: Object.fromEntries(this.devices),
      families: Object.fromEntries(this.families),
    };
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(tmp, 0o600);
      } catch {
        // best-effort; the file was created with mode 0600
      }
    }
    fs.renameSync(tmp, this.filePath);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private iso(offsetMs = 0): string {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }

  private expired(iso: string): boolean {
    return Date.parse(iso) <= this.now().getTime();
  }

  private log(
    action: string,
    outcome: "allowed" | "denied",
    detail: Record<string, unknown>,
    extra: { identity?: string; device?: string; scope?: string } = {},
  ): void {
    this.audit({ action, outcome, source: "gateway.pair", detail, ...extra });
  }

  // ── nonces ──────────────────────────────────────────────────────────────────────────────

  /** A single-use nonce the device signs. Expires after nonceTtlMs. */
  issueNonce(): { nonce: string; expiresAt: string } {
    const nowMs = this.now().getTime();
    if (this.nonces.size >= MAX_NONCES) {
      for (const [nonce, exp] of this.nonces) {
        if (exp <= nowMs) {
          this.nonces.delete(nonce);
        }
      }
      if (this.nonces.size >= MAX_NONCES) {
        // Still full: drop the oldest entries (insertion order).
        const drop = this.nonces.size - MAX_NONCES + 1;
        let i = 0;
        for (const nonce of this.nonces.keys()) {
          if (i++ >= drop) {
            break;
          }
          this.nonces.delete(nonce);
        }
      }
    }
    const nonce = b64url(randomBytes(24));
    const expiresAtMs = nowMs + this.nonceTtlMs;
    this.nonces.set(nonce, expiresAtMs);
    return { nonce, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  private consumeNonce(nonce: unknown): boolean {
    if (typeof nonce !== "string" || !nonce) {
      return false;
    }
    const exp = this.nonces.get(nonce);
    if (exp === undefined) {
      return false;
    }
    this.nonces.delete(nonce);
    return exp > this.now().getTime();
  }

  private verifyProof(params: {
    purpose: "redeem" | "refresh";
    publicKey: string;
    nonce: unknown;
    signature: unknown;
    secret: string;
  }): PairDenial["reason"] | null {
    if (!this.consumeNonce(params.nonce)) {
      return "invalid_nonce";
    }
    if (typeof params.signature !== "string" || !params.signature) {
      return "invalid_signature";
    }
    const payload = pairProofPayload(params.purpose, params.nonce as string, params.secret);
    return verifyDeviceSignature(params.publicKey, payload, params.signature)
      ? null
      : "invalid_signature";
  }

  // ── invitations ─────────────────────────────────────────────────────────────────────────

  createInvitation(params: {
    scope: InvitableScope | string;
    ttlMs?: number;
    label?: string;
    createdBy: string;
    /** The creator's own scope; the invitation can never exceed it. */
    creatorScope: PairScope;
    autoApprove?: boolean;
    /** Already parsed by parseSessionAllowlist(); undefined = no restriction. */
    sessions?: string[];
  }): { ok: true; invitation: PairInvitation; code: string } | { ok: false; reason: string } {
    const scope = parseInvitableScope(params.scope);
    if (!scope) {
      return { ok: false, reason: "invalid_scope" };
    }
    if (!scopeSatisfies(params.creatorScope, scope)) {
      this.log(
        "pair.invite",
        "denied",
        { scope, creatorScope: params.creatorScope },
        {
          identity: params.createdBy,
        },
      );
      return { ok: false, reason: "scope_exceeds_creator" };
    }
    const ttlMs = Math.max(1000, Math.min(params.ttlMs ?? this.inviteTtlMs, MAX_INVITE_TTL_MS));
    const code = `${INVITATION_CODE_PREFIX}${b64url(randomBytes(16))}`;
    const invitation: PairInvitation = {
      id: newId("inv_"),
      codeHash: sha256(code),
      scope,
      ...(params.label?.trim() ? { label: params.label.trim().slice(0, 80) } : {}),
      createdAt: this.iso(),
      expiresAt: this.iso(ttlMs),
      createdBy: params.createdBy,
      autoApprove: params.autoApprove ?? true,
      ...(params.sessions && params.sessions.length > 0 ? { sessions: [...params.sessions] } : {}),
    };
    this.invitations.set(invitation.id, invitation);
    this.codeIndex.set(invitation.codeHash, invitation.id);
    this.persist();
    this.log(
      "pair.invite",
      "allowed",
      {
        invitationId: invitation.id,
        scope,
        ttlMs,
        label: invitation.label ?? null,
        autoApprove: invitation.autoApprove,
        sessions: invitation.sessions ?? null,
      },
      { identity: params.createdBy, scope },
    );
    return { ok: true, invitation, code };
  }

  invitationStatus(
    inv: Pick<PairInvitation, "revokedAt" | "redeemedAt" | "expiresAt">,
  ): "pending" | "redeemed" | "expired" | "revoked" {
    if (inv.revokedAt) {
      return "revoked";
    }
    if (inv.redeemedAt) {
      return "redeemed";
    }
    return this.expired(inv.expiresAt) ? "expired" : "pending";
  }

  listInvitations(): Array<Omit<PairInvitation, "codeHash"> & { status: string }> {
    return [...this.invitations.values()]
      .map(({ codeHash: _hash, ...rest }) => ({ ...rest, status: this.invitationStatus(rest) }))
      .toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  revokeInvitation(id: string, by: string): boolean {
    const inv = this.invitations.get(id);
    if (!inv || inv.revokedAt || inv.redeemedAt) {
      return false;
    }
    inv.revokedAt = this.iso();
    this.persist();
    this.log("pair.revoke", "allowed", { invitationId: id, kind: "invitation" }, { identity: by });
    return true;
  }

  // ── redeem ──────────────────────────────────────────────────────────────────────────────

  redeem(params: {
    code: unknown;
    deviceKeyPub: unknown;
    deviceName?: unknown;
    nonce: unknown;
    signature: unknown;
    remoteIp?: string;
  }): { ok: true; credential: IssuedCredential } | PairDenial {
    const deny = (reason: PairDenial["reason"], detail: Record<string, unknown> = {}) => {
      this.log("pair.redeem", "denied", { reason, ip: params.remoteIp ?? null, ...detail });
      return { ok: false, reason } as PairDenial;
    };
    const code = typeof params.code === "string" ? params.code.trim() : "";
    if (!code) {
      return deny("invalid_code");
    }
    const invitationId = this.codeIndex.get(sha256(code));
    const inv = invitationId ? this.invitations.get(invitationId) : undefined;
    if (!inv) {
      return deny("invalid_code");
    }
    if (inv.revokedAt) {
      return deny("code_revoked", { invitationId: inv.id });
    }
    if (inv.redeemedAt) {
      return deny("code_used", { invitationId: inv.id });
    }
    if (this.expired(inv.expiresAt)) {
      return deny("code_expired", { invitationId: inv.id });
    }
    const publicKey =
      typeof params.deviceKeyPub === "string"
        ? normalizeDevicePublicKeyBase64Url(params.deviceKeyPub)
        : null;
    const fingerprint = publicKey ? deriveDeviceIdFromPublicKey(publicKey) : null;
    if (!publicKey || !fingerprint || Buffer.from(publicKey, "base64url").length !== 32) {
      return deny("invalid_public_key", { invitationId: inv.id });
    }
    const proofError = this.verifyProof({
      purpose: "redeem",
      publicKey,
      nonce: params.nonce,
      signature: params.signature,
      secret: code,
    });
    if (proofError) {
      return deny(proofError, { invitationId: inv.id, fingerprint });
    }

    // One shot: the invitation is spent now, whatever happens next.
    const at = this.iso();
    inv.redeemedAt = at;
    inv.redeemedBy = fingerprint;

    // A re-pair (same key again) replaces the previous trust: old families die with it.
    const previous = this.devices.get(fingerprint);
    if (previous) {
      this.revokeFamiliesOf(fingerprint, "re-paired");
    }
    const device: PairDevice = {
      fingerprint,
      publicKey,
      name: cleanName(params.deviceName),
      scope: inv.scope,
      status: inv.autoApprove ? "approved" : "pending",
      pairedAt: at,
      ...(inv.autoApprove ? { approvedAt: at, approvedBy: inv.createdBy } : {}),
      lastSeenAt: at,
      invitationId: inv.id,
      ...(inv.sessions && inv.sessions.length > 0 ? { sessions: [...inv.sessions] } : {}),
    };
    this.devices.set(fingerprint, device);
    const issued = this.issueFamily(device);
    this.persist();
    this.log(
      "pair.redeem",
      "allowed",
      {
        invitationId: inv.id,
        scope: inv.scope,
        deviceName: device.name,
        status: device.status,
        familyId: issued.familyId,
        rePaired: Boolean(previous),
        sessions: device.sessions ?? null,
        ip: params.remoteIp ?? null,
      },
      { identity: inv.createdBy, device: fingerprint, scope: inv.scope },
    );
    return { ok: true, credential: issued };
  }

  private issueFamily(device: PairDevice): IssuedCredential {
    const family: PairFamily = {
      id: newId("fam_"),
      fingerprint: device.fingerprint,
      scope: device.scope,
      createdAt: this.iso(),
      expiresAt: this.iso(this.refreshTtlMs),
      generation: 0,
      refreshHash: "",
      accessHash: "",
      accessExpiresAt: this.iso(),
      retiredRefreshHashes: [],
    };
    this.families.set(family.id, family);
    return this.rotate(family, device);
  }

  /** Mint a new access + refresh pair for the family, retiring the current refresh hash. */
  private rotate(family: PairFamily, device: PairDevice): IssuedCredential {
    if (family.refreshHash) {
      this.refreshIndex.delete(family.refreshHash);
      family.retiredRefreshHashes.push(family.refreshHash);
      this.retiredIndex.set(family.refreshHash, family.id);
      while (family.retiredRefreshHashes.length > MAX_RETIRED_REFRESH_HASHES) {
        const dropped = family.retiredRefreshHashes.shift();
        if (dropped) {
          this.retiredIndex.delete(dropped);
        }
      }
      family.generation += 1;
    }
    if (family.accessHash) {
      this.accessIndex.delete(family.accessHash);
    }
    const accessToken = `${ACCESS_TOKEN_PREFIX}${b64url(randomBytes(32))}`;
    const refreshToken = `${REFRESH_TOKEN_PREFIX}${b64url(randomBytes(32))}`;
    family.accessHash = sha256(accessToken);
    family.refreshHash = sha256(refreshToken);
    family.accessExpiresAt = this.iso(this.accessTtlMs);
    this.accessIndex.set(family.accessHash, family.id);
    this.refreshIndex.set(family.refreshHash, family.id);
    return {
      device: {
        fingerprint: device.fingerprint,
        name: device.name,
        scope: device.scope,
        status: device.status,
      },
      familyId: family.id,
      generation: family.generation,
      accessToken,
      accessExpiresAt: family.accessExpiresAt,
      refreshToken,
      refreshExpiresAt: family.expiresAt,
    };
  }

  // ── refresh ─────────────────────────────────────────────────────────────────────────────

  refresh(params: {
    refreshToken: unknown;
    nonce: unknown;
    signature: unknown;
    remoteIp?: string;
  }): { ok: true; credential: IssuedCredential } | PairDenial {
    const deny = (
      reason: PairDenial["reason"],
      detail: Record<string, unknown> = {},
      extra: { device?: string } = {},
    ) => {
      this.log("pair.refresh", "denied", { reason, ip: params.remoteIp ?? null, ...detail }, extra);
      return { ok: false, reason } as PairDenial;
    };
    const token = typeof params.refreshToken === "string" ? params.refreshToken.trim() : "";
    if (!token.startsWith(REFRESH_TOKEN_PREFIX)) {
      return deny("invalid_token");
    }
    const hash = sha256(token);
    const currentId = this.refreshIndex.get(hash);
    if (!currentId) {
      const retiredId = this.retiredIndex.get(hash);
      const family = retiredId ? this.families.get(retiredId) : undefined;
      if (family) {
        // Reuse: a refresh token that was already rotated came back. Someone holds a copy.
        const alreadyRevoked = Boolean(family.revokedAt);
        this.revokeFamily(family, "reuse_detected");
        this.persist();
        this.audit({
          action: "pair.reuse_detected",
          outcome: "denied",
          source: "gateway.pair",
          device: family.fingerprint,
          scope: family.scope,
          detail: {
            familyId: family.id,
            generation: family.generation,
            alreadyRevoked,
            ip: params.remoteIp ?? null,
          },
        });
        return { ok: false, reason: "reuse_detected" };
      }
      return deny("invalid_token");
    }
    const family = this.families.get(currentId);
    if (!family) {
      return deny("invalid_token");
    }
    const device = this.devices.get(family.fingerprint);
    if (!device) {
      return deny("unknown_device", { familyId: family.id });
    }
    // Device status first: a re-consent or device revocation explains the dead family.
    const status = this.effectiveStatus(device);
    if (status === "reconsent") {
      return deny("reconsent_required", { familyId: family.id }, { device: device.fingerprint });
    }
    if (status === "revoked") {
      return deny("device_revoked", { familyId: family.id }, { device: device.fingerprint });
    }
    if (family.revokedAt) {
      return deny("family_revoked", { familyId: family.id }, { device: device.fingerprint });
    }
    if (this.expired(family.expiresAt)) {
      return deny("family_expired", { familyId: family.id }, { device: device.fingerprint });
    }
    const proofError = this.verifyProof({
      purpose: "refresh",
      publicKey: device.publicKey,
      nonce: params.nonce,
      signature: params.signature,
      secret: token,
    });
    if (proofError) {
      return deny(proofError, { familyId: family.id }, { device: device.fingerprint });
    }
    const issued = this.rotate(family, device);
    device.lastSeenAt = this.iso();
    this.persist();
    this.log(
      "pair.refresh",
      "allowed",
      { familyId: family.id, generation: family.generation, ip: params.remoteIp ?? null },
      { device: device.fingerprint, scope: device.scope },
    );
    return { ok: true, credential: issued };
  }

  // ── access ──────────────────────────────────────────────────────────────────────────────

  /** Resolve an access token to its principal. Checked on every request; no disk access. */
  verifyAccess(token: unknown): { ok: true; principal: PairPrincipal } | PairDenial {
    const value = typeof token === "string" ? token.trim() : "";
    if (!value.startsWith(ACCESS_TOKEN_PREFIX)) {
      return { ok: false, reason: "invalid_token" };
    }
    const familyId = this.accessIndex.get(sha256(value));
    const family = familyId ? this.families.get(familyId) : undefined;
    if (!family) {
      return { ok: false, reason: "invalid_token" };
    }
    return this.principalFor(family, family.accessHash);
  }

  /**
   * Re-check a principal resolved at connect time (WS connections hold one per socket): family
   * revocation, family expiry and device status apply to every request; the access token's
   * own lifetime only bounds the connect.
   */
  verifyPrincipal(principal: PairPrincipal): { ok: true; principal: PairPrincipal } | PairDenial {
    const family = this.families.get(principal.familyId);
    if (!family) {
      return { ok: false, reason: "invalid_token" };
    }
    return this.principalFor(family, principal.accessHash, { ignoreAccessExpiry: true });
  }

  private principalFor(
    family: PairFamily,
    accessHash: string,
    opts: { ignoreAccessExpiry?: boolean } = {},
  ): { ok: true; principal: PairPrincipal } | PairDenial {
    const device = this.devices.get(family.fingerprint);
    if (!device) {
      return { ok: false, reason: "unknown_device" };
    }
    // Same order as refresh(): device status, then the family, then the access token itself.
    const status = this.effectiveStatus(device);
    if (status === "reconsent") {
      return { ok: false, reason: "reconsent_required" };
    }
    if (status === "revoked") {
      return { ok: false, reason: "device_revoked" };
    }
    if (family.revokedAt) {
      return { ok: false, reason: "family_revoked" };
    }
    if (this.expired(family.expiresAt)) {
      return { ok: false, reason: "family_expired" };
    }
    if (!opts.ignoreAccessExpiry && this.expired(family.accessExpiresAt)) {
      return { ok: false, reason: "token_expired" };
    }
    if (status === "pending") {
      return { ok: false, reason: "device_pending" };
    }
    device.lastSeenAt = this.iso();
    return {
      ok: true,
      principal: {
        kind: "pair",
        scope: device.scope,
        fingerprint: device.fingerprint,
        deviceName: device.name,
        familyId: family.id,
        accessHash,
        accessExpiresAt: family.accessExpiresAt,
        ...(device.sessions && device.sessions.length > 0
          ? { sessions: [...device.sessions] }
          : {}),
      },
    };
  }

  /**
   * Dated re-consent: a device paired more than `reconsentDays` ago must pair again. The
   * transition is recorded once (audited as pair.reconsent) and its families are revoked.
   */
  private effectiveStatus(device: PairDevice): PairDeviceStatus {
    if (device.status === "approved" || device.status === "pending") {
      const age = this.now().getTime() - Date.parse(device.pairedAt);
      if (age > this.reconsentMs) {
        device.status = "reconsent";
        device.reconsentAt = this.iso();
        this.revokeFamiliesOf(device.fingerprint, "reconsent");
        this.persist();
        this.audit({
          action: "pair.reconsent",
          outcome: "denied",
          source: "gateway.pair",
          device: device.fingerprint,
          scope: device.scope,
          detail: { pairedAt: device.pairedAt, ageDays: Math.floor(age / 86_400_000) },
        });
      }
    }
    return device.status;
  }

  // ── devices ─────────────────────────────────────────────────────────────────────────────

  listDevices(): Array<
    Omit<PairDevice, "publicKey"> & {
      families: { active: number; total: number };
    }
  > {
    return [...this.devices.values()]
      .map((device) => {
        this.effectiveStatus(device);
        const fams = [...this.families.values()].filter(
          (f) => f.fingerprint === device.fingerprint,
        );
        const { publicKey: _pk, ...rest } = device;
        return {
          ...rest,
          families: {
            active: fams.filter((f) => !f.revokedAt && !this.expired(f.expiresAt)).length,
            total: fams.length,
          },
        };
      })
      .toSorted((a, b) => (a.pairedAt < b.pairedAt ? 1 : -1));
  }

  getDevice(fingerprint: string): PairDevice | undefined {
    return this.devices.get(fingerprint);
  }

  approveDevice(fingerprint: string, by: string): boolean {
    const device = this.devices.get(fingerprint);
    if (!device || this.effectiveStatus(device) !== "pending") {
      return false;
    }
    device.status = "approved";
    device.approvedAt = this.iso();
    device.approvedBy = by;
    this.persist();
    this.log(
      "pair.approve",
      "allowed",
      { deviceName: device.name, scope: device.scope },
      { identity: by, device: fingerprint, scope: device.scope },
    );
    return true;
  }

  revokeDevice(fingerprint: string, by: string, reason = "revoked"): boolean {
    const device = this.devices.get(fingerprint);
    if (!device || device.status === "revoked") {
      return false;
    }
    device.status = "revoked";
    device.revokedAt = this.iso();
    const count = this.revokeFamiliesOf(fingerprint, reason);
    this.persist();
    this.log(
      "pair.revoke",
      "allowed",
      { kind: "device", deviceName: device.name, families: count, reason },
      { identity: by, device: fingerprint, scope: device.scope },
    );
    return true;
  }

  private revokeFamily(family: PairFamily, reason: string): void {
    if (family.revokedAt) {
      return;
    }
    family.revokedAt = this.iso();
    family.revokedReason = reason;
    // Hashes stay indexed so a presented token answers with the real reason (family_revoked,
    // device_revoked, reconsent_required, reuse_detected) instead of a bare invalid_token.
  }

  private revokeFamiliesOf(fingerprint: string, reason: string): number {
    let count = 0;
    for (const family of this.families.values()) {
      if (family.fingerprint === fingerprint && !family.revokedAt) {
        this.revokeFamily(family, reason);
        count += 1;
      }
    }
    return count;
  }

  listFamilies(fingerprint?: string): PairFamily[] {
    return [...this.families.values()].filter((f) => !fingerprint || f.fingerprint === fingerprint);
  }
}

// ── process-wide store ────────────────────────────────────────────────────────────────────

let shared: CredentialStore | null = null;

export type PairingConfigLike = {
  accessTtlMinutes?: number;
  refreshTtlDays?: number;
  inviteTtlMinutes?: number;
  reconsentDays?: number;
};

export function storeOptionsFromConfig(cfg?: PairingConfigLike | null): CredentialStoreOptions {
  const out: CredentialStoreOptions = {};
  if (cfg?.accessTtlMinutes && cfg.accessTtlMinutes > 0) {
    out.accessTtlMs = cfg.accessTtlMinutes * 60_000;
  }
  if (cfg?.refreshTtlDays && cfg.refreshTtlDays > 0) {
    out.refreshTtlMs = cfg.refreshTtlDays * 86_400_000;
  }
  if (cfg?.inviteTtlMinutes && cfg.inviteTtlMinutes > 0) {
    out.inviteTtlMs = cfg.inviteTtlMinutes * 60_000;
  }
  if (cfg?.reconsentDays && cfg.reconsentDays > 0) {
    out.reconsentDays = cfg.reconsentDays;
  }
  return out;
}

/** The gateway's store (created on first use from `gateway.pairing` config). */
export function getCredentialStore(opts?: CredentialStoreOptions): CredentialStore {
  if (!shared) {
    shared = new CredentialStore(opts);
  }
  return shared;
}

export function setCredentialStoreForTest(store: CredentialStore | null): void {
  shared = store;
}
