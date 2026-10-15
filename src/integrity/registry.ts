// Boot integrity registry (KoLo 2.0, M2b).
//
// <KOLO_HOME>/integrity/registry.json lists the constitution files (soul, covenants, redlines,
// locked policies) with their SHA-256. It is created by `kurahi integrity init` and changed only by
// `kurahi integrity update <path>` — both operator actions, both audited. The registry is signed
// with HMAC-SHA256 under a key in <KOLO_HOME>/secrets/integrity.key (0600; override with
// KOLO_INTEGRITY_KEY_FILE to keep it off the state root). A registry edited without the key
// fails verification; a deleted registry while the key still exists also fails (fail closed).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { expandIntegrityPatterns } from "./glob.js";

export const REGISTRY_VERSION = 1;

export type IntegrityEntry = {
  /** Absolute path. */
  path: string;
  sha256: string;
  size: number;
  addedAt: string;
  updatedAt?: string;
};

export type IntegrityRegistry = {
  version: number;
  createdAt: string;
  updatedAt: string;
  /** The `integrity.paths` patterns the registry was initialised from (informational). */
  patterns: string[];
  entries: IntegrityEntry[];
  signature: { alg: "hmac-sha256"; keyId: string; value: string };
};

export type IntegrityLocations = {
  home: string;
  dir: string;
  registryPath: string;
  keyPath: string;
};

export type IntegrityProblem = {
  path: string;
  kind: "missing" | "mismatch" | "unreadable" | "registry";
  expected?: string;
  actual?: string;
  message: string;
};

export type IntegrityVerifyResult = {
  /** `unconfigured` = no registry and no key: nothing registered yet. */
  state: "ok" | "failed" | "unconfigured";
  checked: number;
  problems: IntegrityProblem[];
  registryPath: string;
  verifiedAt: string;
};

export function resolveIntegrityLocations(
  env: NodeJS.ProcessEnv = process.env,
): IntegrityLocations {
  const home = resolveStateDir(env);
  const dir = path.join(home, "integrity");
  const keyOverride = env.KOLO_INTEGRITY_KEY_FILE?.trim();
  return {
    home,
    dir,
    registryPath: path.join(dir, "registry.json"),
    keyPath: keyOverride ? path.resolve(keyOverride) : path.join(home, "secrets", "integrity.key"),
  };
}

export function sha256File(file: string): { sha256: string; size: number } {
  const buf = fs.readFileSync(file);
  return { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

function readKey(keyPath: string): Buffer | null {
  try {
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    const key = Buffer.from(raw, "hex");
    return key.length >= 32 ? key : null;
  } catch {
    return null;
  }
}

function ensureKey(keyPath: string): Buffer {
  const existing = readKey(keyPath);
  if (existing) {
    return existing;
  }
  if (fs.existsSync(keyPath)) {
    throw new Error(`integrity key ${keyPath} exists but is not a valid 32-byte hex key`);
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  fs.writeFileSync(keyPath, `${key.toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  return key;
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function signingPayload(reg: Omit<IntegrityRegistry, "signature">): string {
  return JSON.stringify({
    version: reg.version,
    createdAt: reg.createdAt,
    updatedAt: reg.updatedAt,
    patterns: reg.patterns,
    entries: reg.entries.map((e) => ({
      path: e.path,
      sha256: e.sha256,
      size: e.size,
      addedAt: e.addedAt,
      updatedAt: e.updatedAt ?? null,
    })),
  });
}

function sign(reg: Omit<IntegrityRegistry, "signature">, key: Buffer): IntegrityRegistry {
  const value = createHmac("sha256", key).update(signingPayload(reg)).digest("hex");
  return { ...reg, signature: { alg: "hmac-sha256", keyId: keyId(key), value } };
}

function signatureValid(reg: IntegrityRegistry, key: Buffer): boolean {
  if (reg.signature?.alg !== "hmac-sha256" || typeof reg.signature.value !== "string") {
    return false;
  }
  const expected = createHmac("sha256", key).update(signingPayload(reg)).digest();
  const actual = Buffer.from(reg.signature.value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function writeRegistry(loc: IntegrityLocations, reg: IntegrityRegistry): void {
  fs.mkdirSync(loc.dir, { recursive: true, mode: 0o700 });
  const tmp = `${loc.registryPath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(reg, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, loc.registryPath);
}

export function readRegistryFile(loc: IntegrityLocations): IntegrityRegistry | null {
  try {
    return JSON.parse(fs.readFileSync(loc.registryPath, "utf8")) as IntegrityRegistry;
  } catch {
    return null;
  }
}

export type InitResult = { registry: IntegrityRegistry; createdKey: boolean };

/** Operator action. Hash every file the patterns match and write a signed registry. */
export function initRegistry(params: {
  patterns: string[];
  loc?: IntegrityLocations;
  force?: boolean;
  now?: Date;
}): InitResult {
  const loc = params.loc ?? resolveIntegrityLocations();
  if (fs.existsSync(loc.registryPath) && !params.force) {
    throw new Error(
      `integrity registry already exists at ${loc.registryPath}; use \`kurahi integrity update <path>\` (or init --force to rebuild)`,
    );
  }
  const hadKey = readKey(loc.keyPath) !== null;
  const key = ensureKey(loc.keyPath);
  const ts = (params.now ?? new Date()).toISOString();
  const files = expandIntegrityPatterns(params.patterns, { baseDir: loc.home });
  const entries: IntegrityEntry[] = files.map((file) => ({
    path: file,
    ...sha256File(file),
    addedAt: ts,
  }));
  const registry = sign(
    {
      version: REGISTRY_VERSION,
      createdAt: ts,
      updatedAt: ts,
      patterns: [...params.patterns],
      entries,
    },
    key,
  );
  writeRegistry(loc, registry);
  return { registry, createdKey: !hadKey };
}

export type UpdateChange = {
  path: string;
  change: "added" | "updated" | "unchanged" | "removed";
  from?: string;
  to?: string;
};

/** Operator action. Re-hash (or add / remove) the given paths and re-sign the registry. */
export function updateRegistry(params: {
  paths: string[];
  remove?: boolean;
  loc?: IntegrityLocations;
  now?: Date;
}): { registry: IntegrityRegistry; changes: UpdateChange[] } {
  const loc = params.loc ?? resolveIntegrityLocations();
  const current = readRegistryFile(loc);
  if (!current) {
    throw new Error(
      `no integrity registry at ${loc.registryPath}; run \`kurahi integrity init\` first`,
    );
  }
  const key = readKey(loc.keyPath);
  if (!key) {
    throw new Error(`integrity key missing or invalid at ${loc.keyPath}`);
  }
  if (!signatureValid(current, key)) {
    throw new Error(
      `integrity registry signature is invalid (${loc.registryPath}); refusing to update a tampered registry — rebuild with \`kurahi integrity init --force\``,
    );
  }
  const ts = (params.now ?? new Date()).toISOString();
  const byPath = new Map(current.entries.map((e) => [e.path, e]));
  const changes: UpdateChange[] = [];
  for (const raw of params.paths) {
    const abs = path.resolve(raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw);
    const prev = byPath.get(abs);
    if (params.remove) {
      if (prev) {
        byPath.delete(abs);
        changes.push({ path: abs, change: "removed", from: prev.sha256 });
      } else {
        throw new Error(`${abs} is not in the integrity registry`);
      }
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`${abs} is not a file (use --remove to drop a registered path)`);
    }
    const { sha256, size } = sha256File(abs);
    if (prev && prev.sha256 === sha256 && prev.size === size) {
      changes.push({ path: abs, change: "unchanged", from: sha256, to: sha256 });
      continue;
    }
    byPath.set(abs, {
      path: abs,
      sha256,
      size,
      addedAt: prev?.addedAt ?? ts,
      updatedAt: prev ? ts : undefined,
    });
    changes.push({ path: abs, change: prev ? "updated" : "added", from: prev?.sha256, to: sha256 });
  }
  const { signature: _sig, ...rest } = current;
  const registry = sign(
    {
      ...rest,
      updatedAt: ts,
      entries: [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
    },
    key,
  );
  writeRegistry(loc, registry);
  return { registry, changes };
}

/** Verify every registered entry. Pure apart from reads; never writes. */
export function verifyRegistry(
  loc: IntegrityLocations = resolveIntegrityLocations(),
): IntegrityVerifyResult {
  const verifiedAt = new Date().toISOString();
  const base = { registryPath: loc.registryPath, verifiedAt };
  const registryExists = fs.existsSync(loc.registryPath);
  const keyExists = fs.existsSync(loc.keyPath);
  if (!registryExists) {
    if (!keyExists) {
      return { ...base, state: "unconfigured", checked: 0, problems: [] };
    }
    return {
      ...base,
      state: "failed",
      checked: 0,
      problems: [
        {
          path: loc.registryPath,
          kind: "registry",
          message: `integrity registry missing but its key exists (${loc.keyPath}); the registry was deleted`,
        },
      ],
    };
  }
  const reg = readRegistryFile(loc);
  if (!reg || !Array.isArray(reg.entries)) {
    return {
      ...base,
      state: "failed",
      checked: 0,
      problems: [
        {
          path: loc.registryPath,
          kind: "registry",
          message: "integrity registry is not valid JSON",
        },
      ],
    };
  }
  const key = readKey(loc.keyPath);
  if (!key) {
    return {
      ...base,
      state: "failed",
      checked: 0,
      problems: [
        {
          path: loc.keyPath,
          kind: "registry",
          message: `integrity key missing or invalid (${loc.keyPath})`,
        },
      ],
    };
  }
  if (!signatureValid(reg, key)) {
    return {
      ...base,
      state: "failed",
      checked: 0,
      problems: [
        {
          path: loc.registryPath,
          kind: "registry",
          message:
            "integrity registry signature is invalid (registry edited outside `kurahi integrity`)",
        },
      ],
    };
  }
  const problems: IntegrityProblem[] = [];
  for (const entry of reg.entries) {
    let actual: { sha256: string; size: number };
    try {
      actual = sha256File(entry.path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      problems.push({
        path: entry.path,
        kind: code === "ENOENT" ? "missing" : "unreadable",
        expected: entry.sha256,
        message:
          code === "ENOENT"
            ? `missing: ${entry.path}`
            : `unreadable (${code ?? String(err)}): ${entry.path}`,
      });
      continue;
    }
    if (actual.sha256 !== entry.sha256) {
      problems.push({
        path: entry.path,
        kind: "mismatch",
        expected: entry.sha256,
        actual: actual.sha256,
        message: `sha256 mismatch: ${entry.path} (expected ${entry.sha256.slice(0, 12)}…, got ${actual.sha256.slice(0, 12)}…)`,
      });
    }
  }
  return {
    ...base,
    state: problems.length > 0 ? "failed" : "ok",
    checked: reg.entries.length,
    problems,
  };
}

/** Registered paths (unverified read; used by the write-refusal policy). */
export function registeredPaths(loc: IntegrityLocations = resolveIntegrityLocations()): string[] {
  return readRegistryFile(loc)?.entries?.map((e) => e.path) ?? [];
}
