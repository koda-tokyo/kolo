// src/covenant/service.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Covenant,
  RelationshipMode,
  UserValue,
  SafetyBoundary,
  BehaviourPreference,
} from "./types.js";
import { koloPath } from "../config/kolo-home.js";
import { safeFileStem } from "../infra/file-stem.js";

/**
 * `<KOLO_HOME>/workspace/covenant` — resolved per call, never at import time, so a KOLO_HOME
 * set by the CLI or a test is honoured.
 */
function covenantDir(): string {
  return koloPath("workspace", "covenant");
}

/** Pre-2.0 location: `<cwd>/workspace/covenant`. Read as a fallback, never written. */
function legacyCovenantDir(): string {
  return path.resolve(process.cwd(), "workspace", "covenant");
}

async function ensureCovenantDirExists(): Promise<void> {
  await fs.mkdir(covenantDir(), { recursive: true });
}

/** `<KOLO_HOME>/workspace/covenant/<id>.json`. */
export function getCovenantPath(userId: string): string {
  return path.join(covenantDir(), `${safeFileStem(userId)}.json`);
}

/**
 * Older locations, read in order: the sanitised and raw names under the current root (ids with
 * ':' were valid file names on POSIX), then the same two under the pre-2.0 cwd-relative root.
 */
function legacyCovenantPaths(userId: string): string[] {
  const stem = safeFileStem(userId);
  const candidates = [
    path.join(covenantDir(), `${userId}.json`),
    path.join(legacyCovenantDir(), `${stem}.json`),
    path.join(legacyCovenantDir(), `${userId}.json`),
  ];
  const current = getCovenantPath(userId);
  return candidates.filter((p, i, all) => p !== current && all.indexOf(p) === i);
}

/**
 * Create a very simple default covenant for a new user.
 * This is intentionally conservative and can be customised later.
 */
export function createDefaultCovenant(
  userId: string,
  options?: {
    userName?: string;
    relationshipMode?: RelationshipMode;
  },
): Covenant {
  const now = new Date().toISOString();

  const defaultValues: UserValue[] = [
    {
      id: "honesty",
      label: "Honesty",
      description: "The assistant should give clear, truthful answers.",
      priority: "high",
    },
    {
      id: "respect",
      label: "Respect",
      description: "The assistant should be respectful and non-judgemental.",
      priority: "high",
    },
  ];

  const defaultBoundaries: SafetyBoundary[] = [
    {
      id: "no_illegal",
      description:
        "Do not provide guidance that directly enables illegal activities or serious harm.",
    },
  ];

  const defaultPreferences: BehaviourPreference[] = [];

  return {
    id: `cov-${userId}`,
    userId,
    createdAt: now,
    updatedAt: now,
    userName: options?.userName,
    relationshipMode: options?.relationshipMode ?? "assistant",
    values: defaultValues,
    boundaries: defaultBoundaries,
    preferences: defaultPreferences,
    continuityPointers: undefined,
    narrativeText: undefined,
  };
}

/**
 * Load the covenant from `<KOLO_HOME>/workspace/covenant/<id>.json`, falling back to the older
 * locations; null when none exists.
 */
export async function loadCovenant(userId: string): Promise<Covenant | null> {
  await ensureCovenantDirExists();
  const filePath = getCovenantPath(userId);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Covenant;
    return parsed;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      for (const legacyPath of legacyCovenantPaths(userId)) {
        try {
          return JSON.parse(await fs.readFile(legacyPath, "utf8")) as Covenant;
        } catch {
          // try the next location
        }
      }
      return null;
    }
    console.error("[covenant] Failed to load covenant:", err);
    throw err;
  }
}

/**
 * Save the covenant to `<KOLO_HOME>/workspace/covenant/<id>.json`.
 */
export async function saveCovenant(userId: string, covenant: Covenant): Promise<void> {
  await ensureCovenantDirExists();
  const filePath = getCovenantPath(userId);

  const updated: Covenant = {
    ...covenant,
    userId,
    updatedAt: new Date().toISOString(),
  };

  const raw = JSON.stringify(updated, null, 2);
  await fs.writeFile(filePath, raw, "utf8");
}

/**
 * Ensure there is a covenant for this user.
 * If none exists, create a default one, save it, and return it.
 */
export async function ensureCovenant(
  userId: string,
  options?: { userName?: string; relationshipMode?: RelationshipMode },
): Promise<Covenant> {
  const existing = await loadCovenant(userId);
  if (existing) {
    return existing;
  }

  const covenant = createDefaultCovenant(userId, options);
  await saveCovenant(userId, covenant);
  return covenant;
}
