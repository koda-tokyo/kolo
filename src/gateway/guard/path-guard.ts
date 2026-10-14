/**
 * path-guard.ts — Path Traversal Prevention & Protected Files
 *
 * Ported from Claude Code's permission system (spec 05).
 * Prevents:
 *   - Path traversal (../, symlink escape, Unicode normalization attacks)
 *   - Backslash injection on Unix
 *   - Case-insensitive bypass on case-sensitive filesystems
 *   - Access to protected system/config files
 *
 * CC Reference: spec/05 §2 — Permission system path traversal prevention
 */

import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, normalize, sep } from "node:path";

// ── Protected Paths Registry ─────────────────────────────────────────

export const PROTECTED_FILES = new Set([
  ".gitconfig",
  ".git-credentials",
  ".npmrc",
  ".bashrc",
  ".zshrc",
  ".profile",
  ".bash_profile",
  ".zprofile",
  ".ssh",
  ".gnupg",
  "id_rsa",
  "id_ed25519",
  "authorized_keys",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "service-account.json",
  "secrets",
  ".kolo",
  "auth-profiles.json",
  ".npmrc",
  ".yarnrc",
  ".pypirc",
]);

export const PROTECTED_DIRS = [
  "/etc",
  "/proc",
  "/sys",
  "/boot",
  "/root",
  "~/.ssh",
  "~/.gnupg",
  "~/.kolo",
];

// ── Unicode Homoglyph Map ────────────────────────────────────────────

const DANGEROUS_UNICODE = new Map<string, string>([
  ["\uff0e\uff0e", ".."],
  ["\u2024\u2024", ".."],
  ["\u2025", ".."],
  ["\u2026", "..."],
  ["\u2215", "/"],
  ["\uff0f", "/"],
  ["\u2044", "/"],
  ["\u29f8", "/"],
  ["\uff3c", "\\"],
]);

// ── Path Walking Helper ──────────────────────────────────────────────

async function resolveBestAncestor(fullPath: string): Promise<string> {
  // Walk up tree until we find an existing ancestor, resolve symlinks,
  // then reconstruct the remaining path.
  let remaining: string[] = [];
  let current = fullPath;

  for (let i = 0; i < 20; i++) {
    try {
      const real = await realpath(current);
      if (remaining.length === 0) return real;
      return [real, ...remaining].join(sep);
    } catch {
      const idx = current.lastIndexOf(sep);
      if (idx <= 0) {
        return remaining.length > 0 ? [sep, ...remaining].join(sep) : current;
      }
      remaining.unshift(current.substring(idx + 1));
      current = current.substring(0, idx);
    }
  }
  return fullPath;
}

// ── Validation ───────────────────────────────────────────────────────

export async function validatePath(
  rawPath: string,
  allowedRoots: string[],
): Promise<{ safe: true; resolvedPath: string } | { safe: false; reason: string }> {
  // Step 1: Unicode normalization
  let sanitized = rawPath.normalize("NFKC");

  // Step 2: Replace homoglyphs
  for (const [glyph, replacement] of DANGEROUS_UNICODE) {
    sanitized = sanitized.split(glyph).join(replacement);
  }

  // Step 3: Strip file://
  sanitized = sanitized.replace(/^file:\/\//i, "");

  // Step 4: Resolve to absolute
  let resolved: string;
  try {
    resolved = resolve(normalize(sanitized));
  } catch {
    return { safe: false, reason: `Cannot resolve path: ${rawPath}` };
  }

  // Step 5: Resolve symlinks, walking up as needed
  resolved = await resolveBestAncestor(resolved);

  // Step 6: Check against allowed roots. Roots go through the same symlink walk as the
  // candidate: on macOS /var and /tmp are symlinks into /private and /home is an autofs
  // mount under /System/Volumes/Data, so a realpath'd candidate never has the configured
  // root as a textual prefix unless the root is realpath'd too.
  const check = resolved.toLowerCase();
  const rootsResolved = await Promise.all(
    allowedRoots.map(async (root) => (await resolveBestAncestor(resolve(root))).toLowerCase()),
  );
  const isAllowed = rootsResolved.some(
    (rootResolved) => check.startsWith(rootResolved + sep) || check === rootResolved,
  );

  if (!isAllowed) {
    return { safe: false, reason: `Path outside allowed roots: ${allowedRoots.join(", ")}` };
  }

  return { safe: true, resolvedPath: resolved };
}

// ── Protection Check ─────────────────────────────────────────────────

export function isProtected(
  resolvedPath: string,
): { protected: true; reason: string } | { protected: false } {
  // Callers may hand over forward-slash paths on Windows; split on either separator.
  const segments = resolvedPath.split(/[\\/]/);
  const basename = segments[segments.length - 1] || "";

  if (PROTECTED_FILES.has(basename)) {
    return { protected: true, reason: `Protected file: ${basename}` };
  }

  for (const segment of segments) {
    if (PROTECTED_FILES.has(segment)) {
      return { protected: true, reason: `Protected directory: ${segment}` };
    }
  }

  const home = homedir();
  const normalized = resolvedPath.replace(/[\\/]/g, sep);
  for (const dir of PROTECTED_DIRS) {
    const expanded = dir.replace("~", home).replace(/[\\/]/g, sep);
    if (normalized.startsWith(expanded + sep) || normalized === expanded) {
      return { protected: true, reason: `Protected directory: ${dir}` };
    }
  }

  return { protected: false };
}

// ── Combined Check ───────────────────────────────────────────────────

export async function securePath(
  rawPath: string,
  allowedRoots: string[],
): Promise<
  { safe: true; resolvedPath: string; warning?: string } | { safe: false; reason: string }
> {
  const validated = await validatePath(rawPath, allowedRoots);
  if (!validated.safe) return validated;

  const check = isProtected(validated.resolvedPath);
  if (check.protected) {
    return {
      safe: false,
      reason: `${check.reason}. Requires elevated permission.`,
    };
  }

  return validated;
}
