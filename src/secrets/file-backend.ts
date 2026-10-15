// Encrypted-file backend: <KOLO_HOME>/secrets/store.enc, AES-256-GCM.
// Key = scrypt(key material, per-write salt). Key material comes from KOLO_SECRETS_KEY (headless
// servers) or from <KOLO_HOME>/secrets/.key (32 random bytes, 0600, created on first write).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertValidSecretName } from "./names.js";
import { type SecretStore, SecretStoreDecryptError, SecretStoreError } from "./types.js";

const STORE_VERSION = 1;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const KEY_FILE_BYTES = 32;

type Envelope = {
  v: number;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
};

type Payload = { secrets: Record<string, string> };

export type FileSecretStoreOptions = {
  dir: string;
  env?: NodeJS.ProcessEnv;
  /** Test hook: cheaper scrypt cost. */
  scryptN?: number;
};

// Derived keys are cached per (material, salt, cost): scrypt costs ~100 ms and the config
// loader may resolve refs many times per second.
const derivedKeyCache = new Map<string, Buffer>();

function deriveKey(material: Buffer, salt: Buffer, n: number, r: number, p: number): Buffer {
  const cacheKey = crypto
    .createHash("sha256")
    .update(material)
    .update(salt)
    .update(`${n}:${r}:${p}`)
    .digest("hex");
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const key = crypto.scryptSync(material, salt, 32, { N: n, r, p, maxmem: SCRYPT_MAXMEM });
  if (derivedKeyCache.size > 32) {
    derivedKeyCache.clear();
  }
  derivedKeyCache.set(cacheKey, key);
  return key;
}

function writeFileAtomic(target: string, data: string | Buffer) {
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EPERM" || code === "EEXIST") {
      fs.copyFileSync(tmp, target);
      fs.rmSync(tmp, { force: true });
    } else {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
  if (process.platform !== "win32") {
    fs.chmodSync(target, 0o600);
  }
}

export class FileSecretStore implements SecretStore {
  readonly backend = "file" as const;
  readonly location: string;
  readonly keyPath: string;
  private readonly dir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly scryptN: number;
  private cache: { stamp: string; secrets: Record<string, string> } | null = null;

  constructor(opts: FileSecretStoreOptions) {
    this.dir = opts.dir;
    this.env = opts.env ?? process.env;
    this.scryptN = opts.scryptN ?? SCRYPT_N;
    this.location = path.join(opts.dir, "store.enc");
    this.keyPath = path.join(opts.dir, ".key");
  }

  /** Where the key material comes from (for `kurahi secrets list`). */
  keySource(): "env" | "file" {
    return this.env.KOLO_SECRETS_KEY?.trim() ? "env" : "file";
  }

  private ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(this.dir, 0o700);
    }
  }

  private readKeyMaterial(create: boolean): Buffer | null {
    const fromEnv = this.env.KOLO_SECRETS_KEY?.trim();
    if (fromEnv) {
      return Buffer.from(fromEnv, "utf8");
    }
    try {
      const buf = fs.readFileSync(this.keyPath);
      if (buf.length < 16) {
        throw new SecretStoreError(`secrets key file ${this.keyPath} is truncated`);
      }
      return buf;
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") {
        throw err;
      }
    }
    if (!create) {
      return null;
    }
    this.ensureDir();
    const material = crypto.randomBytes(KEY_FILE_BYTES);
    // wx: never clobber a key created concurrently by another process.
    try {
      fs.writeFileSync(this.keyPath, material, { mode: 0o600, flag: "wx" });
    } catch (err) {
      if ((err as { code?: string }).code === "EEXIST") {
        return fs.readFileSync(this.keyPath);
      }
      throw err;
    }
    if (process.platform !== "win32") {
      fs.chmodSync(this.keyPath, 0o600);
    }
    return material;
  }

  private stamp(): string | null {
    try {
      const st = fs.statSync(this.location);
      return `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch {
      return null;
    }
  }

  private load(): Record<string, string> {
    const stamp = this.stamp();
    if (!stamp) {
      this.cache = null;
      return {};
    }
    if (this.cache && this.cache.stamp === stamp) {
      return this.cache.secrets;
    }
    let envelope: Envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(this.location, "utf8")) as Envelope;
    } catch {
      throw new SecretStoreError(`secrets store at ${this.location} is not valid JSON`);
    }
    if (envelope.v !== STORE_VERSION || envelope.kdf !== "scrypt") {
      throw new SecretStoreError(`unsupported secrets store format at ${this.location}`);
    }
    const material = this.readKeyMaterial(false);
    if (!material) {
      throw new SecretStoreError(
        `secrets store ${this.location} exists but no key was found (${this.keyPath} or KOLO_SECRETS_KEY)`,
      );
    }
    const key = deriveKey(
      material,
      Buffer.from(envelope.salt, "base64"),
      envelope.n,
      envelope.r,
      envelope.p,
    );
    let plaintext: string;
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAAD(Buffer.from(`kolo-secrets:v${STORE_VERSION}`));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ct, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretStoreDecryptError(this.location);
    }
    const payload = JSON.parse(plaintext) as Payload;
    const secrets = payload?.secrets && typeof payload.secrets === "object" ? payload.secrets : {};
    this.cache = { stamp, secrets };
    return secrets;
  }

  private save(secrets: Record<string, string>) {
    this.ensureDir();
    const material = this.readKeyMaterial(true);
    if (!material) {
      throw new SecretStoreError("no secrets key available");
    }
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveKey(material, salt, this.scryptN, SCRYPT_R, SCRYPT_P);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`kolo-secrets:v${STORE_VERSION}`));
    const payload: Payload = { secrets };
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const envelope: Envelope = {
      v: STORE_VERSION,
      kdf: "scrypt",
      n: this.scryptN,
      r: SCRYPT_R,
      p: SCRYPT_P,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
    writeFileAtomic(this.location, `${JSON.stringify(envelope)}\n`);
    const stamp = this.stamp();
    this.cache = stamp ? { stamp, secrets } : null;
  }

  get(name: string): string | undefined {
    const secrets = this.load();
    return Object.prototype.hasOwnProperty.call(secrets, name) ? secrets[name] : undefined;
  }

  set(name: string, value: string): void {
    const valid = assertValidSecretName(name);
    if (typeof value !== "string" || value.length === 0) {
      throw new SecretStoreError("secret value must be a non-empty string");
    }
    const next = { ...this.load(), [valid]: value };
    this.save(next);
  }

  delete(name: string): boolean {
    const current = this.load();
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      return false;
    }
    const next = { ...current };
    delete next[name];
    this.save(next);
    return true;
  }

  list(): string[] {
    return Object.keys(this.load()).toSorted();
  }
}
