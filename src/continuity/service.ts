// src/continuity/service.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContinuityState } from "./types.js";
import { koloPath } from "../config/kolo-home.js";
import { safeFileStem } from "../infra/file-stem.js";
import { createEmptyContinuityState } from "./snapshot.js";

/**
 * `<KOLO_HOME>/workspace/continuity` — resolved per call, never at import time, so a KOLO_HOME
 * set by the CLI or a test is honoured.
 */
function continuityDir(): string {
  return koloPath("workspace", "continuity");
}

/** Pre-2.0 location: `<cwd>/workspace/continuity`. Read as a fallback, never written. */
function legacyContinuityStateDir(): string {
  return path.resolve(process.cwd(), "workspace", "continuity");
}

async function ensureContinuityDirExists(): Promise<void> {
  await fs.mkdir(continuityDir(), { recursive: true });
}

/** `<KOLO_HOME>/workspace/continuity/<id>.json`. */
export function getContinuityPath(userId: string): string {
  return path.join(continuityDir(), `${safeFileStem(userId)}.json`);
}

/**
 * Older locations, read in order: the sanitised and raw names under the current root (ids with
 * ':' were valid file names on POSIX), then the same two under the pre-2.0 cwd-relative root.
 */
function legacyContinuityPaths(userId: string): string[] {
  const stem = safeFileStem(userId);
  const candidates = [
    path.join(continuityDir(), `${userId}.json`),
    path.join(legacyContinuityStateDir(), `${stem}.json`),
    path.join(legacyContinuityStateDir(), `${userId}.json`),
  ];
  const current = getContinuityPath(userId);
  return candidates.filter((p, i, all) => p !== current && all.indexOf(p) === i);
}

/**
 * Load continuity state from `<KOLO_HOME>/workspace/continuity/<id>.json`, falling back to the
 * older locations; null when none exists.
 */
export async function loadContinuityState(userId: string): Promise<ContinuityState | null> {
  await ensureContinuityDirExists();
  const filePath = getContinuityPath(userId);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ContinuityState;
    return parsed;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      for (const legacyPath of legacyContinuityPaths(userId)) {
        try {
          return JSON.parse(await fs.readFile(legacyPath, "utf8")) as ContinuityState;
        } catch {
          // try the next location
        }
      }
      return null;
    }
    console.error("[continuity] Failed to load continuity state:", err);
    throw err;
  }
}

/**
 * Save continuity state for a user.
 */
export async function saveContinuityState(userId: string, state: ContinuityState): Promise<void> {
  await ensureContinuityDirExists();
  const filePath = getContinuityPath(userId);
  const raw = JSON.stringify(state, null, 2);
  await fs.writeFile(filePath, raw, "utf8");
}

/**
 * Ensure continuity exists for this user: load if present, otherwise
 * create an empty state, save, and return it.
 */
export async function ensureContinuityState(userId: string): Promise<ContinuityState> {
  const existing = await loadContinuityState(userId);
  if (existing) {
    return existing;
  }

  const fresh = createEmptyContinuityState(userId);
  await saveContinuityState(userId, fresh);
  return fresh;
}
