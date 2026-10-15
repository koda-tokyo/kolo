import JSON5 from "json5";
// `kurahi secrets migrate`: move plaintext credentials out of kolo.json into the store and replace
// them with `$secret` refs. The original file is backed up (0600) before it is rewritten.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SecretStore } from "./types.js";
import { isSecretRef, secretRef } from "./names.js";

type PathSeg = string | number;

// Config keys that hold credentials (camelCase config keys).
const SECRET_KEYS = new Set([
  "apiKey",
  "token",
  "botToken",
  "appToken",
  "userToken",
  "signingSecret",
  "channelAccessToken",
  "channelSecret",
  "password",
  "secret",
  "clientSecret",
  "accessToken",
  "refreshToken",
  "webhookSecret",
  "privateKey",
  "appPassword",
]);
// Env-style keys (env.vars, cliBackends.*.env): FOO_API_KEY, BAR_TOKEN, ...
const ENV_SECRET_KEY = /^[A-Z][A-Z0-9_]*(API_KEY|_TOKEN|_SECRET|PASSWORD)$/;

export type PlaintextSecret = { path: PathSeg[]; configPath: string; name: string };

function sanitizeSegment(seg: PathSeg): string {
  return String(seg).replace(/[^A-Za-z0-9_-]/g, "_") || "_";
}

/** Canonical store name for a config path. */
export function secretNameForPath(p: PathSeg[]): string {
  const s = p.map(sanitizeSegment);
  const joined = (parts: string[]) => parts.join(".");
  if (s[0] === "gateway" && s[1] === "auth" && s.length === 3) {
    return `gateway.${s[2]}`; // gateway.token, gateway.password
  }
  if (s[0] === "models" && s[1] === "providers" && s.length >= 4) {
    return joined(["provider", ...s.slice(2)]); // provider.<id>.apiKey
  }
  if (s[0] === "channels" && s.length >= 3) {
    return joined(["channel", ...s.slice(1)]); // channel.line.channelAccessToken
  }
  if (s[0] === "skills" && s[1] === "entries" && s.length >= 4) {
    return joined(["skill", ...s.slice(2)]);
  }
  if (s[0] === "env") {
    return joined(["env", s[s.length - 1]]);
  }
  return joined(s);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(p: PathSeg[]): string {
  return p
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : seg))
    .join(".")
    .replace(/\.\[/g, "[");
}

export function findPlaintextSecrets(raw: unknown): PlaintextSecret[] {
  const found: PlaintextSecret[] = [];
  const walk = (value: unknown, p: PathSeg[]) => {
    if (isSecretRef(value)) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...p, index]));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        const childPath = [...p, key];
        if (typeof child === "string") {
          const trimmed = child.trim();
          const looksSecret = SECRET_KEYS.has(key) || ENV_SECRET_KEY.test(key);
          // Skip empties and values that are already env refs (${VAR}).
          if (looksSecret && trimmed && !trimmed.includes("${")) {
            found.push({
              path: childPath,
              configPath: formatPath(childPath),
              name: secretNameForPath(childPath),
            });
          }
          continue;
        }
        walk(child, childPath);
      }
    }
  };
  walk(raw, []);
  return found;
}

export type MigrateResult = {
  configPath: string;
  backupPath: string | null;
  moved: Array<{ configPath: string; name: string }>;
  dryRun: boolean;
};

function setAt(obj: unknown, p: PathSeg[], value: unknown) {
  let cur = obj as Record<string | number, unknown>;
  for (const seg of p.slice(0, -1)) {
    cur = cur[seg] as Record<string | number, unknown>;
  }
  cur[p[p.length - 1]] = value;
}

function getAt(obj: unknown, p: PathSeg[]): unknown {
  let cur: unknown = obj;
  for (const seg of p) {
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

export function migrateConfigSecrets(opts: {
  configPath: string;
  store: SecretStore;
  dryRun?: boolean;
  now?: () => Date;
}): MigrateResult {
  const { configPath, store } = opts;
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed: unknown = JSON5.parse(raw);
  const candidates = findPlaintextSecrets(parsed);
  // Two config paths mapping to one name with different values would silently merge: disambiguate.
  const byName = new Map<string, string>();
  const moved: MigrateResult["moved"] = [];
  for (const candidate of candidates) {
    const value = getAt(parsed, candidate.path) as string;
    let name = candidate.name;
    const prior = byName.get(name);
    if (prior !== undefined && prior !== value) {
      name = candidate.path.map(sanitizeSegment).join(".");
    }
    byName.set(name, value);
    moved.push({ configPath: candidate.configPath, name });
  }
  if (opts.dryRun || moved.length === 0) {
    return { configPath, backupPath: null, moved, dryRun: Boolean(opts.dryRun) };
  }

  const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.pre-secrets-${stamp}.bak`;
  fs.copyFileSync(configPath, backupPath);
  if (process.platform !== "win32") {
    fs.chmodSync(backupPath, 0o600);
  }

  // Store first; only rewrite the config once every value is safely in the store.
  moved.forEach((entry, index) => {
    const value = getAt(parsed, candidates[index].path) as string;
    store.set(entry.name, value);
    if (store.get(entry.name) !== value) {
      throw new Error(`secrets store did not round-trip ${entry.name}; kolo.json left unchanged`);
    }
  });
  moved.forEach((entry, index) => setAt(parsed, candidates[index].path, secretRef(entry.name)));

  const dir = path.dirname(configPath);
  const tmp = path.join(
    dir,
    `${path.basename(configPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, configPath);
  return { configPath, backupPath, moved, dryRun: false };
}
