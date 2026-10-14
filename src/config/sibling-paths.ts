// Config-aware sibling locations (KoLo 2.0, M1a). See kolo-home.ts.

import path from "node:path";
import type { KoLoConfig } from "./types.js";
import { loadConfig } from "./config.js";
import { resolveSiblingWorkspaceDir } from "./kolo-home.js";

function siblingsFrom(cfg: KoLoConfig | undefined): KoLoConfig["siblings"] {
  if (cfg) {
    return cfg.siblings;
  }
  try {
    return loadConfig().siblings;
  } catch {
    return undefined;
  }
}

/** `siblings[].workspaceDir` → `siblings[].stateDir/workspace-<id>` → shared root (legacy). */
export function resolveSiblingWorkspace(siblingId: string, cfg?: KoLoConfig): string {
  return resolveSiblingWorkspaceDir(siblingId, siblingsFrom(cfg));
}

/** `<sibling workspace>/inbox`. */
export function resolveSiblingInboxDir(siblingId: string, cfg?: KoLoConfig): string {
  return path.join(resolveSiblingWorkspace(siblingId, cfg), "inbox");
}
