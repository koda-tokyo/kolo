// Operator overlay loader. Some behaviour belongs to one installation and never to the
// product tree (see private/README.md). Such code lives in the git-ignored `private/overlay/`
// directory as CommonJS modules and is picked up here by name; a clean checkout has no
// overlay and every hook returns null. Resolution order: KOLO_OVERLAY_DIR, then
// <repository root>/private/overlay. Loaded synchronously (createRequire) because the hooks
// are called from synchronous code paths; failures are logged once and treated as absent.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cache = new Map<string, unknown>();
const warned = new Set<string>();

function overlayDirs(): string[] {
  const dirs: string[] = [];
  const fromEnv = process.env.KOLO_OVERLAY_DIR?.trim();
  if (fromEnv) {
    dirs.push(path.resolve(fromEnv));
  }
  // dist/infra/private-overlay.js and src/infra/private-overlay.ts are both two levels below
  // the repository root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  dirs.push(path.resolve(here, "..", "..", "private", "overlay"));
  return dirs;
}

/**
 * Load `<overlay dir>/<name>.cjs` and return its exports, or null when no overlay provides it.
 * Never throws: an overlay that fails to load is reported once on stderr and ignored.
 */
export function loadPrivateOverlay<T>(name: string): T | null {
  if (cache.has(name)) {
    return (cache.get(name) as T | null) ?? null;
  }
  let loaded: T | null = null;
  for (const dir of overlayDirs()) {
    const file = path.join(dir, `${name}.cjs`);
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const require = createRequire(import.meta.url);
      loaded = require(file) as T;
      break;
    } catch (err) {
      if (!warned.has(file)) {
        warned.add(file);
        process.stderr.write(
          `kolo: overlay ${file} failed to load and is ignored: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
  cache.set(name, loaded);
  return loaded;
}

/** Test hook. */
export function resetPrivateOverlayCache(): void {
  cache.clear();
  warned.clear();
}
