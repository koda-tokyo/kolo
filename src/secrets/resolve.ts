// `{"$secret": "<name>"}` references in kolo.json: resolved at load time, restored on write so
// plaintext never lands back in the config file.
import { assertValidSecretName, isSecretRef, SECRET_REF_KEY, secretRef } from "./names.js";
import { MissingSecretError, type SecretStore } from "./types.js";

type PathSeg = string | number;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function formatPath(path: PathSeg[]): string {
  return path
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : seg))
    .join(".")
    .replace(/\.\[/g, "[");
}

// Secret values are resolved before `${VAR}` substitution; escape `${NAME}` sequences so a
// secret that happens to contain one is passed through verbatim (substitution un-escapes `$${`).
function escapeEnvRefs(value: string): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, "$$$${$1}");
}

export function containsSecretRefs(value: unknown): boolean {
  if (isSecretRef(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretRefs);
  }
  if (isPlainObject(value)) {
    return Object.values(value).some(containsSecretRefs);
  }
  return false;
}

export type ResolveSecretRefsOptions = {
  /** Lazily opened so configs without refs never touch the store. */
  store: () => SecretStore;
  /** Escape `${VAR}` in resolved values (set when env substitution runs afterwards). */
  escapeEnv?: boolean;
};

export function resolveConfigSecretRefs(obj: unknown, opts: ResolveSecretRefsOptions): unknown {
  if (!containsSecretRefs(obj)) {
    return obj;
  }
  let store: SecretStore | null = null;
  const walk = (value: unknown, path: PathSeg[]): unknown => {
    if (isSecretRef(value)) {
      const name = assertValidSecretName(value[SECRET_REF_KEY]);
      store ??= opts.store();
      const resolved = store.get(name);
      if (resolved === undefined) {
        throw new MissingSecretError(name, formatPath(path));
      }
      return opts.escapeEnv ? escapeEnvRefs(resolved) : resolved;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, [...path, index]));
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = walk(child, [...path, key]);
      }
      return out;
    }
    return value;
  };
  return walk(obj, []);
}

export type SecretRefLocation = { path: PathSeg[]; name: string };

export function collectSecretRefs(obj: unknown): SecretRefLocation[] {
  const found: SecretRefLocation[] = [];
  const walk = (value: unknown, path: PathSeg[]) => {
    if (isSecretRef(value)) {
      found.push({ path, name: value[SECRET_REF_KEY] });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index]));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, [...path, key]);
      }
    }
  };
  walk(obj, []);
  return found;
}

function getAt(obj: unknown, path: PathSeg[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function setAt(obj: unknown, path: PathSeg[], value: unknown) {
  let cur = obj as Record<string | number, unknown>;
  for (const seg of path.slice(0, -1)) {
    cur = cur[seg] as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Before writing a config back to disk: every path that was a `$secret` ref in the on-disk file
 * becomes a ref again. A changed value is written to the store first (so edits through
 * `kolo config set` keep working), never to kolo.json.
 */
export function restoreSecretRefs<T>(
  cfg: T,
  onDisk: unknown,
  store: () => SecretStore,
): { config: T; restored: number } {
  const refs = collectSecretRefs(onDisk);
  if (refs.length === 0) {
    return { config: cfg, restored: 0 };
  }
  const out = structuredClone(cfg);
  let opened: SecretStore | null = null;
  let restored = 0;
  for (const ref of refs) {
    const current = getAt(out, ref.path);
    if (current === undefined) {
      continue; // key removed from config; the secret itself stays in the store
    }
    if (typeof current === "string") {
      opened ??= store();
      if (opened.get(ref.name) !== current) {
        opened.set(ref.name, current);
      }
    } else if (!isSecretRef(current)) {
      continue;
    }
    setAt(out, ref.path, secretRef(ref.name));
    restored += 1;
  }
  return { config: out, restored };
}

/** Replace refs with placeholder strings so schema validation of a ref-bearing config passes. */
export function placeholderSecretRefs<T>(cfg: T): T {
  if (!containsSecretRefs(cfg)) {
    return cfg;
  }
  const walk = (value: unknown): unknown => {
    if (isSecretRef(value)) {
      return `secret:${value[SECRET_REF_KEY]}`;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(cfg) as T;
}
