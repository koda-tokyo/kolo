// Glob helpers for the policy engine (KoLo 2.0, M13a). Names (agent ids, tools, providers,
// channels, hosts, operations) match with command-mode globs (`*` crosses everything); paths
// match with path-mode globs from the M5 permission matcher so both systems agree.
import path from "node:path";
import { globToRegExp } from "../agents/permissions.js";

/** `path.posix` or `path.win32`; the default is the running platform. */
type PlatformPath = typeof path.posix;

const cache = new Map<string, RegExp>();

function compiled(pattern: string, mode: "path" | "command"): RegExp {
  const key = `${mode}\u0000${pattern}`;
  let re = cache.get(key);
  if (!re) {
    re = pattern === "*" || pattern === "**" ? /^.*$/ : globToRegExp(pattern, mode);
    if (cache.size > 4096) {
      cache.clear();
    }
    cache.set(key, re);
  }
  return re;
}

/** Case-insensitive name glob (`trading-*`, `mcp_*`, `*.example.com`). */
export function nameMatches(pattern: string, value: string): boolean {
  return compiled(pattern.trim().toLowerCase(), "command").test(value.trim().toLowerCase());
}

export function anyNameMatches(patterns: readonly string[] | undefined, value: string): boolean {
  return (patterns ?? []).some((p) => nameMatches(p, value));
}

/**
 * Forward-slash form for the given platform. On Windows `path.resolve` produces backslashes,
 * which never match a compiled path glob (`/` is the only segment separator there).
 */
function toPosix(input: string, p: PlatformPath): string {
  return p.sep === "\\" ? input.replace(/\\/g, "/") : input;
}

/**
 * Normalise a policy path pattern (`~/.ssh/**`, `/etc/**`, `**\/.env`) for glob matching.
 * `~/` is the state owner's home. Absolute patterns go through `path.resolve` so that on Windows
 * a drive-less `/etc/**` gains the same drive letter a resolved target carries (`C:/etc/passwd`),
 * exactly as the M5 permission matcher does; relative globs such as `**\/.env` are left alone.
 * The result is always `/`-separated. `p` selects the platform rules (tests pass `path.win32`).
 */
export function normalizePathPattern(
  pattern: string,
  homeDir: string,
  p: PlatformPath = path,
): string {
  let pat = pattern.trim();
  if (pat === "~") {
    pat = homeDir;
  } else if (pat.startsWith("~/")) {
    pat = `${toPosix(homeDir, p).replace(/\/+$/, "")}/${pat.slice(2)}`;
  }
  if (p.isAbsolute(pat)) {
    pat = p.resolve(pat);
  }
  return toPosix(pat, p);
}

/** Normalise a candidate path the same way (`/`-separated, resolved for the platform). */
export function normalizeCandidatePath(absolutePath: string, p: PlatformPath = path): string {
  const abs = absolutePath.trim();
  if (abs.length === 0) {
    return "";
  }
  return toPosix(p.isAbsolute(abs) ? p.resolve(abs) : abs, p);
}

/** Path glob against a normalised absolute path (`/`-separated). `~/` is the state owner's home. */
export function pathMatches(
  pattern: string,
  absolutePath: string,
  homeDir: string,
  p: PlatformPath = path,
): boolean {
  return compiled(normalizePathPattern(pattern, homeDir, p), "path").test(
    normalizeCandidatePath(absolutePath, p),
  );
}

export function anyPathMatches(
  patterns: readonly string[] | undefined,
  absolutePath: string,
  homeDir: string,
): string | undefined {
  return (patterns ?? []).find((p) => pathMatches(p, absolutePath, homeDir));
}

/** Index of the first matching pattern, or -1 — the index becomes part of the rule id. */
export function firstMatchIndex(patterns: readonly string[] | undefined, value: string): number {
  return (patterns ?? []).findIndex((p) => nameMatches(p, value));
}

/** Hosts a tool call reaches, from the usual argument names (`url`, `href`, `baseUrl`, `urls`). */
export function extractHosts(args: Record<string, unknown> | undefined): string[] {
  if (!args) {
    return [];
  }
  const out = new Set<string>();
  const consider = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      return;
    }
    try {
      const host = new URL(trimmed).hostname.toLowerCase();
      if (host) {
        out.add(host);
      }
    } catch {
      // not a URL
    }
  };
  for (const key of ["url", "href", "baseUrl", "base_url", "endpoint", "uri"]) {
    consider(args[key]);
  }
  const urls = args.urls;
  if (Array.isArray(urls)) {
    for (const value of urls) {
      consider(value);
    }
  }
  return [...out];
}

/** Bounded JSON of the arguments for secret-pattern scanning. */
export function argsText(args: Record<string, unknown> | undefined, maxChars = 64 * 1024): string {
  if (!args) {
    return "";
  }
  try {
    return JSON.stringify(args).slice(0, maxChars);
  } catch {
    return "";
  }
}
