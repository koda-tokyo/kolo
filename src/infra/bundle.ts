/**
 * Prebuilt-bundle detection.
 *
 * A bundle (scripts/bundle.mjs) sets KOLO_BUNDLE_ROOT in its launcher. Without the launcher
 * (someone ran node/bin/node lib/kolo.mjs directly) the root is found from the package root:
 * `<root>/lib/package.json` + `<root>/bundle-manifest.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_MANIFEST_FILE } from "../packaging/bundle-manifest.js";

export type BundleInfo = {
  root: string;
  libDir: string;
};

function looksLikeBundleRoot(root: string): boolean {
  try {
    return (
      fs.existsSync(path.join(root, BUNDLE_MANIFEST_FILE)) &&
      fs.existsSync(path.join(root, "lib", "package.json"))
    );
  } catch {
    return false;
  }
}

/** Resolve the bundle root from env, then from the location of this module. */
export function resolveBundleInfo(
  env: Record<string, string | undefined> = process.env,
  moduleUrl: string = import.meta.url,
): BundleInfo | null {
  const fromEnv = env.KOLO_BUNDLE_ROOT?.trim();
  if (fromEnv) {
    const root = path.resolve(fromEnv);
    if (looksLikeBundleRoot(root)) {
      return { root, libDir: path.join(root, "lib") };
    }
  }
  try {
    // <root>/lib/dist/infra/bundle.js -> <root>
    let cursor = path.dirname(fileURLToPath(moduleUrl));
    for (let i = 0; i < 5; i += 1) {
      if (path.basename(cursor) === "lib" && looksLikeBundleRoot(path.dirname(cursor))) {
        return { root: path.dirname(cursor), libDir: cursor };
      }
      cursor = path.dirname(cursor);
    }
  } catch {
    // not a file URL (tests, bundlers)
  }
  return null;
}

export function isBundledInstall(env: Record<string, string | undefined> = process.env): boolean {
  return resolveBundleInfo(env) !== null;
}
