// Owner binding (KoLo 2.0, M16 "five minutes to your phone").
//
// `kurahi connect <channel>` issues a one-time code (10 minutes, single use, stored as a hash). The
// first message on that channel that carries the code binds its sender as the channel's owner:
// `channels.<id>.identities[<sender>] = "owner"` (M14 identities), the sender is added to the
// channel's pairing allowlist so the DM gate admits them, and the binding is audited
// (`channel.owner_bound`). WhatsApp binds the linked account's own number at login instead (the
// QR scan is the proof of possession). `kurahi connect --unbind <channel>` removes exactly what a
// binding added and audits `channel.owner_unbound`.
//
// State: `<KOLO_HOME>/channels/owner-codes.json` and `<KOLO_HOME>/channels/owners.json`, 0600.
// Nothing here runs at import time.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelLocale } from "../../config/types.channels-resident.js";
import { auditSafe } from "../../audit/audit-log.js";
import { resolveStateDir } from "../../config/paths.js";
import { channelText } from "./templates.js";

export const OWNER_CODE_TTL_MS = 10 * 60_000;
export const OWNER_CODE_PREFIX = "KOLO-";
// No 0/O, 1/I/L: the code is typed on a phone keyboard as often as it is scanned.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_RE = /(?:^|[^A-Za-z0-9])(kolo-[a-hj-np-z2-9]{8})(?![A-Za-z0-9])/i;

export type OwnerBindVia = "code" | "linked-device";

type CodeRecord = {
  id: string;
  channel: string;
  accountId: string | null;
  hash: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  usedBy?: string;
};

export type OwnerBinding = {
  channel: string;
  accountId: string | null;
  senderId: string;
  via: OwnerBindVia;
  boundAt: number;
  /** The identities key written to the config (removed again on unbind). */
  identityKey: string;
  /** Whether the binding added the sender to the pairing allowlist store. */
  addedAllowFrom: boolean;
  /** A one-line welcome is still owed on the owner's first message. */
  welcomePending: boolean;
};

type CodesFile = { version: 1; codes: CodeRecord[] };
type OwnersFile = { version: 1; owners: OwnerBinding[] };

/** Seams for tests and for the CLI (which writes config in its own process). */
export type OwnerBindingDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  readConfig?: () => Promise<KoLoConfig>;
  writeConfig?: (cfg: KoLoConfig) => Promise<void>;
  addAllowFrom?: (channel: string, entry: string) => Promise<boolean>;
  removeAllowFrom?: (channel: string, entry: string) => Promise<void>;
};

function stateFile(name: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env ?? process.env), "channels", name);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}

function normalizeAccount(accountId?: string | null): string | null {
  const v = accountId?.trim();
  return v && v !== "default" ? v : null;
}

function readCodes(env?: NodeJS.ProcessEnv): CodesFile {
  const v = readJson<CodesFile>(stateFile("owner-codes.json", env), { version: 1, codes: [] });
  return { version: 1, codes: Array.isArray(v.codes) ? v.codes : [] };
}

function readOwners(env?: NodeJS.ProcessEnv): OwnersFile {
  const v = readJson<OwnersFile>(stateFile("owners.json", env), { version: 1, owners: [] });
  return { version: 1, owners: Array.isArray(v.owners) ? v.owners : [] };
}

export function generateOwnerCode(random: (n: number) => Buffer = crypto.randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${OWNER_CODE_PREFIX}${out}`;
}

/** The code in a message (`KOLO-ABCD2345`, `/start KOLO-ABCD2345`), upper-cased; else null. */
export function extractOwnerCode(text: string | undefined | null): string | null {
  if (!text) {
    return null;
  }
  const m = CODE_RE.exec(text.trim());
  return m ? m[1].toUpperCase() : null;
}

/**
 * Issue a one-time code for a channel. Earlier unused codes for the same channel and account are
 * withdrawn, so at most one code is live per channel account. The code is returned once and only
 * its hash is stored.
 */
export function issueOwnerCode(input: {
  channel: string;
  accountId?: string | null;
  ttlMs?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): { code: string; id: string; expiresAt: number } {
  const now = (input.now ?? Date.now)();
  const channel = input.channel.toLowerCase();
  const accountId = normalizeAccount(input.accountId);
  const ttl = Math.min(Math.max(input.ttlMs ?? OWNER_CODE_TTL_MS, 1000), OWNER_CODE_TTL_MS);
  const code = generateOwnerCode();
  const record: CodeRecord = {
    id: `oc_${crypto.randomBytes(6).toString("hex")}`,
    channel,
    accountId,
    hash: hashCode(code),
    createdAt: now,
    expiresAt: now + ttl,
  };
  const file = readCodes(input.env);
  // Drop expired and used records older than a day; withdraw live ones for this account.
  file.codes = file.codes.filter(
    (c) =>
      !(c.channel === channel && c.accountId === accountId && !c.usedAt) &&
      now - c.createdAt < 24 * 60 * 60_000,
  );
  file.codes.push(record);
  writeJson(stateFile("owner-codes.json", input.env), file);
  void auditSafe({
    action: "channel.owner_code.issued",
    outcome: "ok",
    source: "channels.owner",
    detail: {
      channel,
      accountId,
      codeId: record.id,
      expiresAt: new Date(record.expiresAt).toISOString(),
    },
  });
  return { code, id: record.id, expiresAt: record.expiresAt };
}

export type ClaimResult =
  | { ok: true; codeId: string }
  | { ok: false; reason: "no_code" | "invalid" | "expired" | "used" };

/** Consume a code found in `text` for this channel account. One use; expired codes fail. */
export function claimOwnerCode(input: {
  channel: string;
  accountId?: string | null;
  text: string | undefined | null;
  senderId: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): ClaimResult {
  const code = extractOwnerCode(input.text);
  if (!code) {
    return { ok: false, reason: "no_code" };
  }
  const now = (input.now ?? Date.now)();
  const channel = input.channel.toLowerCase();
  const accountId = normalizeAccount(input.accountId);
  const file = readCodes(input.env);
  const hash = hashCode(code);
  const record = file.codes.find(
    (c) => c.hash === hash && c.channel === channel && c.accountId === accountId,
  );
  let result: ClaimResult;
  if (!record) {
    result = { ok: false, reason: "invalid" };
  } else if (record.usedAt) {
    result = { ok: false, reason: "used" };
  } else if (now > record.expiresAt) {
    result = { ok: false, reason: "expired" };
  } else {
    record.usedAt = now;
    record.usedBy = input.senderId;
    writeJson(stateFile("owner-codes.json", input.env), file);
    result = { ok: true, codeId: record.id };
  }
  void auditSafe({
    identity: input.senderId,
    action: "channel.owner_code.claim",
    outcome: result.ok ? "ok" : "denied",
    source: "channels.owner",
    detail: {
      channel,
      accountId,
      codeId: record?.id ?? null,
      reason: result.ok ? null : result.reason,
    },
  });
  return result;
}

/** Live (unused, unexpired) codes for a channel; ids and expiry only. */
export function listLiveOwnerCodes(
  channel: string,
  opts: { env?: NodeJS.ProcessEnv; now?: () => number } = {},
): Array<{ id: string; accountId: string | null; expiresAt: number }> {
  const now = (opts.now ?? Date.now)();
  return readCodes(opts.env)
    .codes.filter((c) => c.channel === channel.toLowerCase() && !c.usedAt && c.expiresAt >= now)
    .map((c) => ({ id: c.id, accountId: c.accountId, expiresAt: c.expiresAt }));
}

export function listOwnerBindings(opts: { env?: NodeJS.ProcessEnv } = {}): OwnerBinding[] {
  return readOwners(opts.env).owners;
}

async function defaultReadConfig(): Promise<KoLoConfig> {
  const { readConfigFileSnapshot } = await import("../../config/config.js");
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    throw new Error(
      `config is invalid (${snapshot.issues[0]?.path || "<root>"}: ${snapshot.issues[0]?.message ?? "invalid"}); run kurahi doctor`,
    );
  }
  return snapshot.config;
}

async function defaultWriteConfig(cfg: KoLoConfig): Promise<void> {
  const { writeConfigFile } = await import("../../config/config.js");
  await writeConfigFile(cfg);
}

async function defaultAddAllowFrom(channel: string, entry: string): Promise<boolean> {
  const { addChannelAllowFromStoreEntry } = await import("../../pairing/pairing-store.js");
  const res = await addChannelAllowFromStoreEntry({ channel: channel as never, entry });
  return res.changed;
}

async function defaultRemoveAllowFrom(channel: string, entry: string): Promise<void> {
  const { removeChannelAllowFromStoreEntry } = await import("../../pairing/pairing-store.js");
  await removeChannelAllowFromStoreEntry({ channel: channel as never, entry });
}

type IdentitiesHolder = { identities?: Record<string, string>; accounts?: Record<string, unknown> };

function withIdentity(
  cfg: KoLoConfig,
  channel: string,
  accountId: string | null,
  key: string,
  role: "owner" | null,
): KoLoConfig {
  const channels = { ...(cfg.channels as Record<string, unknown> | undefined) };
  const entry = { ...(channels[channel] as IdentitiesHolder | undefined) };
  const apply = (holder: IdentitiesHolder): IdentitiesHolder => {
    const identities = { ...holder.identities };
    if (role) {
      identities[key] = role;
    } else {
      delete identities[key];
    }
    const { identities: _previous, ...rest } = holder;
    return Object.keys(identities).length === 0 ? rest : { ...rest, identities };
  };
  if (accountId) {
    const accounts = { ...entry.accounts };
    accounts[accountId] = apply({ ...(accounts[accountId] as IdentitiesHolder | undefined) });
    entry.accounts = accounts;
    channels[channel] = entry;
  } else {
    channels[channel] = apply(entry);
  }
  return { ...cfg, channels } as KoLoConfig;
}

/**
 * Bind `senderId` as owner of a channel (account). Idempotent: binding the same sender again
 * refreshes the record. The config write uses the normal config IO, so `$secret` refs stay refs.
 */
export async function bindChannelOwner(
  input: {
    channel: string;
    accountId?: string | null;
    senderId: string;
    via: OwnerBindVia;
    /** Owe a welcome line on the first message (bindings made outside a conversation). */
    welcomePending?: boolean;
    /** Skip the pairing allowlist (WhatsApp: the linked number is always admitted). */
    skipAllowFrom?: boolean;
  },
  deps: OwnerBindingDeps = {},
): Promise<OwnerBinding> {
  const now = (deps.now ?? Date.now)();
  const channel = input.channel.toLowerCase();
  const accountId = normalizeAccount(input.accountId);
  const senderId = input.senderId.trim();
  if (!senderId) {
    throw new Error("owner binding needs a sender id");
  }
  const identityKey = senderId.toLowerCase();
  const cfg = await (deps.readConfig ?? defaultReadConfig)();
  await (deps.writeConfig ?? defaultWriteConfig)(
    withIdentity(cfg, channel, accountId, identityKey, "owner"),
  );
  let addedAllowFrom = false;
  if (!input.skipAllowFrom) {
    try {
      addedAllowFrom = await (deps.addAllowFrom ?? defaultAddAllowFrom)(channel, senderId);
    } catch {
      addedAllowFrom = false;
    }
  }
  const owners = readOwners(deps.env);
  const previous = owners.owners.find(
    (o) => o.channel === channel && o.accountId === accountId && o.senderId === senderId,
  );
  const binding: OwnerBinding = {
    channel,
    accountId,
    senderId,
    via: input.via,
    boundAt: now,
    identityKey,
    addedAllowFrom: addedAllowFrom || Boolean(previous?.addedAllowFrom),
    welcomePending: Boolean(input.welcomePending),
  };
  owners.owners = [
    ...owners.owners.filter(
      (o) => !(o.channel === channel && o.accountId === accountId && o.senderId === senderId),
    ),
    binding,
  ];
  writeJson(stateFile("owners.json", deps.env), owners);
  await auditSafe({
    identity: senderId,
    scope: "owner",
    action: "channel.owner_bound",
    outcome: "ok",
    source: "channels.owner",
    detail: { channel, accountId, via: input.via, addedAllowFrom: binding.addedAllowFrom },
  });
  return binding;
}

/**
 * Remove every owner a binding added on this channel (or one account of it): the identities
 * keys, the allowlist entries the binding added, and any live code. Returns what was removed.
 */
export async function unbindChannelOwner(
  input: { channel: string; accountId?: string | null; actor?: string },
  deps: OwnerBindingDeps = {},
): Promise<{ removed: OwnerBinding[]; codesWithdrawn: number }> {
  const channel = input.channel.toLowerCase();
  const accountId = input.accountId === undefined ? undefined : normalizeAccount(input.accountId);
  const matches = (o: { channel: string; accountId: string | null }) =>
    o.channel === channel && (accountId === undefined || o.accountId === accountId);
  const owners = readOwners(deps.env);
  const removed = owners.owners.filter(matches);
  const codes = readCodes(deps.env);
  const live = codes.codes.filter((c) => matches(c) && !c.usedAt);
  if (live.length > 0) {
    codes.codes = codes.codes.filter((c) => !(matches(c) && !c.usedAt));
    writeJson(stateFile("owner-codes.json", deps.env), codes);
  }
  if (removed.length > 0) {
    let cfg = await (deps.readConfig ?? defaultReadConfig)();
    for (const o of removed) {
      cfg = withIdentity(cfg, channel, o.accountId, o.identityKey, null);
    }
    await (deps.writeConfig ?? defaultWriteConfig)(cfg);
    for (const o of removed) {
      if (o.addedAllowFrom) {
        try {
          await (deps.removeAllowFrom ?? defaultRemoveAllowFrom)(channel, o.senderId);
        } catch {
          // The audit entry still records the unbind; doctor reports a stale allowlist entry.
        }
      }
    }
    owners.owners = owners.owners.filter((o) => !matches(o));
    writeJson(stateFile("owners.json", deps.env), owners);
  }
  await auditSafe({
    identity: input.actor ?? "owner:cli",
    scope: "owner",
    action: "channel.owner_unbound",
    outcome: "ok",
    source: "channels.owner",
    detail: {
      channel,
      accountId: accountId ?? null,
      owners: removed.map((o) => o.senderId),
      codesWithdrawn: live.length,
    },
  });
  return { removed, codesWithdrawn: live.length };
}

/** True once per pending welcome: the first message from a freshly bound owner. */
export function takeOwnerWelcome(input: {
  channel: string;
  accountId?: string | null;
  candidates: Array<string | undefined | null>;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const channel = input.channel.toLowerCase();
  const accountId = normalizeAccount(input.accountId);
  const owners = readOwners(input.env);
  const keys = new Set(
    input.candidates
      .map((c) => c?.toString().trim().toLowerCase())
      .filter((c): c is string => Boolean(c))
      .flatMap((c) => [c, c.includes(":") ? c.slice(c.lastIndexOf(":") + 1) : c]),
  );
  const hit = owners.owners.find(
    (o) =>
      o.welcomePending &&
      o.channel === channel &&
      o.accountId === accountId &&
      keys.has(o.identityKey),
  );
  if (!hit) {
    return false;
  }
  hit.welcomePending = false;
  writeJson(stateFile("owners.json", input.env), owners);
  return true;
}

/** Cheap pre-check for channel hot paths: is any code or pending welcome stored at all? */
export function ownerBindingActive(env?: NodeJS.ProcessEnv): boolean {
  return (
    fs.existsSync(stateFile("owner-codes.json", env)) ||
    fs.existsSync(stateFile("owners.json", env))
  );
}

/**
 * The channel hook: a direct message whose text carries a code. Returns the reply to send in
 * the same conversation when the message was a claim attempt (bound, or refused with a reason),
 * or null when the message has nothing to do with owner binding and should continue normally.
 */
export async function handleOwnerClaimMessage(
  input: {
    cfg?: KoLoConfig;
    channel: string;
    accountId?: string | null;
    senderId: string | undefined | null;
    text: string | undefined | null;
    locale?: ChannelLocale;
  },
  deps: OwnerBindingDeps = {},
): Promise<{ bound: boolean; reply: string } | null> {
  const senderId = input.senderId?.toString().trim();
  if (!senderId || !extractOwnerCode(input.text)) {
    return null;
  }
  const claim = claimOwnerCode({
    channel: input.channel,
    accountId: input.accountId,
    text: input.text,
    senderId,
    env: deps.env,
    now: deps.now,
  });
  const locale = input.locale ?? "en";
  if (!claim.ok) {
    // Unknown codes fall through (the text might be ordinary conversation); a code that existed
    // but expired or was used gets an answer so the person knows to ask for a new one.
    return claim.reason === "expired" || claim.reason === "used"
      ? { bound: false, reply: channelText(locale, "owner.codeExpired") }
      : null;
  }
  await bindChannelOwner(
    { channel: input.channel, accountId: input.accountId, senderId, via: "code" },
    deps,
  );
  return { bound: true, reply: channelText(locale, "owner.bound") };
}
