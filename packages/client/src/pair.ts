// SPDX-License-Identifier: MIT
// Client side of pairing (KoLo 2.0, M3a): redeem an invitation for a device-bound credential,
// rotate it, and keep it in <home>/secrets/devices/<fingerprint>.json (0600). Node only
// (node:crypto for the Ed25519 key and node:fs for the file); imported lazily so the main
// entry stays browser-safe.
import { discover, type DiscoverOptions, resolveHomeFromEnv } from "./discover.js";

export type DeviceCredentialFile = {
  version: 1;
  fingerprint: string;
  /** Raw Ed25519 public key, base64url. */
  publicKey: string;
  privateKeyPem: string;
  deviceName: string;
  /** Gateway base URL this credential was issued by. */
  gateway: string;
  scope: "observe" | "attach" | "admin";
  status: "approved" | "pending" | "revoked" | "reconsent";
  familyId: string;
  generation: number;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  pairedAt: string;
  updatedAt: string;
};

/** What the WebSocket handshake needs to prove possession of the device key. */
export type DeviceKey = {
  fingerprint: string;
  publicKey: string;
  privateKeyPem: string;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class KoloPairError extends Error {
  readonly name = "KoloPairError";
  constructor(
    readonly reason: string,
    readonly status?: number,
  ) {
    super(`pair: ${reason}${status ? ` (HTTP ${status})` : ""}`);
  }
}

async function nodeCrypto() {
  return await import("node:crypto");
}

async function nodeFs() {
  const [fs, path] = await Promise.all([import("node:fs"), import("node:path")]);
  return { fs, path };
}

const ED25519_SPKI_PREFIX = "302a300506032b6570032100";

function toBase64Url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** Generate an Ed25519 device key. fingerprint = sha256(raw public key) hex. */
export async function generateDeviceKey(): Promise<DeviceKey> {
  const crypto = await nodeCrypto();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const prefix = Buffer.from(ED25519_SPKI_PREFIX, "hex");
  const raw = spki.subarray(prefix.length);
  return {
    fingerprint: crypto.createHash("sha256").update(raw).digest("hex"),
    publicKey: toBase64Url(raw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Sign an arbitrary payload with the device key (base64url). */
export async function signWithDeviceKey(privateKeyPem: string, payload: string): Promise<string> {
  const crypto = await nodeCrypto();
  const key = crypto.createPrivateKey(privateKeyPem);
  return toBase64Url(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

/** The proof the gateway expects on redeem/refresh: `kolo-pair-v1|<purpose>|<nonce>|<sha256(secret)>`. */
export async function pairProofPayload(
  purpose: "redeem" | "refresh",
  nonce: string,
  secret: string,
): Promise<string> {
  const crypto = await nodeCrypto();
  const digest = crypto.createHash("sha256").update(secret, "utf8").digest("hex");
  return `kolo-pair-v1|${purpose}|${nonce}|${digest}`;
}

/**
 * The string a device signs in the `connect` handshake (v2 with a nonce). Mirrors the
 * gateway's buildDeviceAuthPayload.
 */
export function deviceConnectPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce?: string | null;
}): string {
  const version = params.nonce ? "v2" : "v1";
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
  ];
  if (version === "v2") {
    base.push(params.nonce ?? "");
  }
  return base.join("|");
}

export function devicesDir(home: string, path: typeof import("node:path")): string {
  return path.join(home, "secrets", "devices");
}

async function resolveHome(options: { home?: string; env?: DiscoverOptions["env"] }) {
  const { fs, path } = await nodeFs();
  const os = await import("node:os");
  const env = options.env ?? process.env;
  const home = options.home
    ? path.resolve(options.home.replace(/^~(?=$|[\\/])/, os.homedir()))
    : resolveHomeFromEnv(env, { fs, path, os });
  return { home, fs, path };
}

async function fetchJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new KoloPairError(`unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { error: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  const err = body.error;
  if (typeof err === "string") {
    return err;
  }
  if (
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}

async function fetchNonce(fetchImpl: Fetch, baseUrl: string): Promise<string> {
  const { status, body } = await fetchJson(fetchImpl, `${baseUrl}/api/pair/nonce`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (status !== 200 || typeof body.nonce !== "string") {
    throw new KoloPairError(`nonce: ${errorText(body, "unexpected response")}`, status);
  }
  return body.nonce;
}

/** Write the credential file atomically with mode 0600 (directory 0700). */
export async function writeDeviceCredential(
  file: string,
  value: DeviceCredentialFile,
): Promise<void> {
  const { fs, path } = await nodeFs();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // created with 0600 already
    }
  }
  fs.renameSync(tmp, file);
}

export async function readDeviceCredential(
  file: string,
): Promise<DeviceCredentialFile | undefined> {
  const { fs } = await nodeFs();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DeviceCredentialFile;
    return parsed && parsed.version === 1 && typeof parsed.fingerprint === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export type PairOptions = {
  /** Invitation code from `kolo pair invite`. */
  code: string;
  /** Gateway base URL; default: discover(). */
  baseUrl?: string;
  deviceName?: string;
  /** State root for the credential file; default: discover()'s home. */
  home?: string;
  env?: DiscoverOptions["env"];
  fetch?: Fetch;
  /** Reuse an existing key instead of generating one (re-pair after re-consent). */
  key?: DeviceKey;
};

export type PairResult = { file: string; credential: DeviceCredentialFile };

/** Redeem an invitation: generate a device key, prove it, store the credential (0600). */
export async function pair(options: PairOptions): Promise<PairResult> {
  const fetchImpl = options.fetch ?? (globalThis.fetch as Fetch);
  const { home, path } = await resolveHome(options);
  const baseUrl = (options.baseUrl ?? (await discover({ home, env: options.env })).baseUrl).replace(
    /\/+$/,
    "",
  );
  const key = options.key ?? (await generateDeviceKey());
  const nonce = await fetchNonce(fetchImpl, baseUrl);
  const signature = await signWithDeviceKey(
    key.privateKeyPem,
    await pairProofPayload("redeem", nonce, options.code),
  );
  const deviceName = options.deviceName?.trim() || (await defaultDeviceName());
  const { status, body } = await fetchJson(fetchImpl, `${baseUrl}/api/pair/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      code: options.code,
      deviceKeyPub: key.publicKey,
      deviceName,
      nonce,
      signature,
    }),
  });
  if (status !== 200 || body.ok !== true) {
    throw new KoloPairError(errorText(body, "redeem failed"), status);
  }
  const now = new Date().toISOString();
  const device = body.device as Record<string, unknown> | undefined;
  const credential: DeviceCredentialFile = {
    version: 1,
    fingerprint: key.fingerprint,
    publicKey: key.publicKey,
    privateKeyPem: key.privateKeyPem,
    deviceName: typeof device?.name === "string" ? device.name : deviceName,
    gateway: baseUrl,
    scope: device?.scope as DeviceCredentialFile["scope"],
    status: device?.status as DeviceCredentialFile["status"],
    familyId: String(body.familyId),
    generation: Number(body.generation ?? 0),
    accessToken: String(body.accessToken),
    accessExpiresAt: String(body.accessExpiresAt),
    refreshToken: String(body.refreshToken),
    refreshExpiresAt: String(body.refreshExpiresAt),
    pairedAt: now,
    updatedAt: now,
  };
  const file = path.join(devicesDir(home, path), `${key.fingerprint}.json`);
  await writeDeviceCredential(file, credential);
  return { file, credential };
}

export type RefreshOptions = {
  /** Credential file; default: the device file discover() would pick for this home. */
  file?: string;
  home?: string;
  env?: DiscoverOptions["env"];
  fetch?: Fetch;
};

/** Rotate the credential family: new access + refresh tokens, file rewritten. */
export async function refresh(options: RefreshOptions = {}): Promise<PairResult> {
  const fetchImpl = options.fetch ?? (globalThis.fetch as Fetch);
  let file = options.file;
  if (!file) {
    const found = await discover({ home: options.home, env: options.env });
    file = found.device?.file;
  }
  if (!file) {
    throw new KoloPairError("no device credential file; run `kolo pair redeem <code>` first");
  }
  const current = await readDeviceCredential(file);
  if (!current) {
    throw new KoloPairError(`unreadable device credential file ${file}`);
  }
  const baseUrl = current.gateway.replace(/\/+$/, "");
  const nonce = await fetchNonce(fetchImpl, baseUrl);
  const signature = await signWithDeviceKey(
    current.privateKeyPem,
    await pairProofPayload("refresh", nonce, current.refreshToken),
  );
  const { status, body } = await fetchJson(fetchImpl, `${baseUrl}/api/pair/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken, nonce, signature }),
  });
  if (status !== 200 || body.ok !== true) {
    const reason = errorText(body, "refresh failed");
    if (reason === "reuse_detected" || reason === "family_revoked" || reason === "device_revoked") {
      // The family is dead: drop the tokens so discover() stops offering them.
      await writeDeviceCredential(file, {
        ...current,
        accessToken: "",
        refreshToken: "",
        status: reason === "device_revoked" ? "revoked" : current.status,
        updatedAt: new Date().toISOString(),
      });
    }
    throw new KoloPairError(reason, status);
  }
  const device = body.device as Record<string, unknown> | undefined;
  const credential: DeviceCredentialFile = {
    ...current,
    status: (device?.status as DeviceCredentialFile["status"]) ?? current.status,
    generation: Number(body.generation ?? current.generation + 1),
    accessToken: String(body.accessToken),
    accessExpiresAt: String(body.accessExpiresAt),
    refreshToken: String(body.refreshToken),
    refreshExpiresAt: String(body.refreshExpiresAt),
    updatedAt: new Date().toISOString(),
  };
  await writeDeviceCredential(file, credential);
  return { file, credential };
}

async function defaultDeviceName(): Promise<string> {
  try {
    const os = await import("node:os");
    return `${os.userInfo().username}@${os.hostname()}`;
  } catch {
    return "device";
  }
}

/** True when an ISO timestamp is in the past (with a small safety margin). */
export function isExpired(iso: string | undefined, marginMs = 15_000): boolean {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return !Number.isFinite(t) || t - marginMs <= Date.now();
}
