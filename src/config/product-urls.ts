// The one place that knows the product's public addresses. Every `--help` footer, wizard hint,
// error message, installer reference and update check reads from here; nothing else hardcodes
// a host. Change a URL here and the whole product follows.

import { createRequire } from "node:module";

export const PRODUCT_NAME = "Kurahi";

/** Documentation root (no trailing slash). */
export const DOCS_URL = "https://kurahi.kodasoken.com/docs";

/**
 * Stable host for installers and published JSON schemas. Schema ids keep their original
 * `/kolo/` base so documents validated against them stay valid across the rename.
 */
export const DOWNLOAD_BASE_URL = "https://kodasoken.com/kurahi";
const SCHEMA_BASE_URL = "https://kodasoken.com/kolo";

/** Installer scripts, kept in this repository under scripts/. */
export const INSTALL_SH_URL = `${DOWNLOAD_BASE_URL}/install.sh`;
export const INSTALL_PS1_URL = `${DOWNLOAD_BASE_URL}/install.ps1`;

/** Source repository and its release, issue and discussion pages. */
export const REPO_URL = "https://github.com/koda-tokyo/kurahi";
export const REPO_GIT_URL = `${REPO_URL}.git`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const RELEASES_LATEST_URL = `${RELEASES_URL}/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;

/** Where people get help and where vulnerabilities go. */
export const SUPPORT_URL = ISSUES_URL;
export const SUPPORT_EMAIL = "support@kodasoken.com";
export const SECURITY_EMAIL = "security@kodasoken.com";

/** JSON schema ids published next to the docs. */
export const PROTOCOL_SCHEMA_URL = `${SCHEMA_BASE_URL}/protocol.schema.json`;
export const CONFIG_SCHEMA_URL = `${SCHEMA_BASE_URL}/kolo.schema.json`;

/** Identifier sent as HTTP Referer to providers that ask for one. */
export const PRODUCT_REFERER = DOCS_URL;

/**
 * Name of the published npm package, read from package.json so the update checker and the
 * package can never disagree.
 */
export const NPM_PACKAGE_NAME: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { name?: string };
    return pkg.name?.trim() || "kolo";
  } catch {
    return "kolo";
  }
})();

/** Absolute docs URL for a root-relative docs path (`/cli/doctor` → `${DOCS_URL}/cli/doctor`). */
export function docsUrl(path = ""): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return DOCS_URL;
  }
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `${DOCS_URL}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

/** The docs URL without scheme, for terminals that do not render links. */
export function docsLabel(path = ""): string {
  return docsUrl(path).replace(/^https?:\/\//, "");
}
