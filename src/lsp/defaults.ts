import path from "node:path";
import type { KoLoConfig } from "../config/config.js";
import type { LspConfig, LspServerConfig } from "../config/types.lsp.js";
import { resolveCommandResolutionFromArgv } from "../infra/exec-approvals.js";

/**
 * Language server defaults (KoLo 2.0, M9b). Commands only: nothing is bundled or downloaded.
 * A server whose command is not on PATH is skipped silently.
 */

export type ResolvedLspServer = {
  language: string;
  command: string;
  args: string[];
  rootMarkers: string[];
  extensions: string[];
};

type DefaultServer = Omit<LspServerConfig, "disabled"> & {
  extensions: string[];
  rootMarkers: string[];
};

export const LSP_DEFAULT_SERVERS: Record<string, DefaultServer> = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: ["ts", "tsx", "js", "jsx", "mts", "cts"],
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  python: {
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: ["py"],
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt"],
  },
  go: {
    command: "gopls",
    args: [],
    extensions: ["go"],
    rootMarkers: ["go.mod"],
  },
  rust: {
    command: "rust-analyzer",
    args: [],
    extensions: ["rs"],
    rootMarkers: ["Cargo.toml"],
  },
  java: {
    command: "jdtls",
    args: [],
    extensions: ["java"],
    rootMarkers: ["pom.xml", "build.gradle"],
  },
};

export const LSP_DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 3000;
export const LSP_DEFAULT_MAX_DIAGNOSTICS_CHARS = 4000;

function normalizeExtensions(list: string[] | undefined): string[] {
  return (list ?? [])
    .map((ext) => ext.trim().replace(/^\./, "").toLowerCase())
    .filter((ext) => ext.length > 0);
}

/** User `lsp.servers` merged over the built-in defaults; `disabled: true` removes an entry. */
export function resolveLspServers(config?: Pick<KoLoConfig, "lsp">): ResolvedLspServer[] {
  const lsp: LspConfig | undefined = config?.lsp;
  if (lsp?.enabled === false) {
    return [];
  }
  const merged = new Map<string, LspServerConfig & { extensions?: string[] }>();
  for (const [language, entry] of Object.entries(LSP_DEFAULT_SERVERS)) {
    merged.set(language, { ...entry });
  }
  for (const [language, entry] of Object.entries(lsp?.servers ?? {})) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const base = merged.get(language);
    merged.set(language, { ...base, ...entry });
  }
  const out: ResolvedLspServer[] = [];
  for (const [language, entry] of merged) {
    if (entry.disabled || !entry.command?.trim()) {
      continue;
    }
    out.push({
      language,
      command: entry.command.trim(),
      args: Array.isArray(entry.args) ? entry.args : [],
      rootMarkers: Array.isArray(entry.rootMarkers) ? entry.rootMarkers : [],
      extensions: normalizeExtensions(entry.extensions),
    });
  }
  return out;
}

export function serverForFile(
  servers: ResolvedLspServer[],
  filePath: string,
): ResolvedLspServer | undefined {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (!ext) {
    return undefined;
  }
  return servers.find((server) => server.extensions.includes(ext));
}

/** Absolute path of the command when it is on PATH (or an existing explicit path); else undefined. */
export function detectOnPath(command: string, env?: NodeJS.ProcessEnv): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolution = resolveCommandResolutionFromArgv([trimmed], undefined, env);
  return resolution?.resolvedPath ?? undefined;
}
