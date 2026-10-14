import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KoLoConfig } from "../config/config.js";
import {
  fileUri,
  LspClient,
  type LspDiagnostic,
  type LspHover,
  type LspLocation,
  type LspPosition,
} from "./client.js";
import {
  detectOnPath,
  LSP_DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
  LSP_DEFAULT_MAX_DIAGNOSTICS_CHARS,
  type ResolvedLspServer,
  resolveLspServers,
  serverForFile,
} from "./defaults.js";

/**
 * One language server per (language, project root), started on first use and stopped after an
 * idle period (KoLo 2.0, M9b). Servers whose command is not on PATH are reported as unavailable;
 * nothing here runs at import time.
 */

export type LspAvailability =
  | { ok: true; server: ResolvedLspServer; rootDir: string }
  | { ok: false; reason: "disabled" | "no-server" | "not-installed"; server?: ResolvedLspServer };

export type LspManagerOptions = {
  config?: Pick<KoLoConfig, "lsp">;
  env?: NodeJS.ProcessEnv;
  /** Idle time before a server is stopped (default 5 minutes). */
  idleMs?: number;
  requestTimeoutMs?: number;
};

type Entry = {
  key: string;
  client: LspClient;
  starting: Promise<void>;
  idleTimer: NodeJS.Timeout | null;
};

const SEVERITY_LABEL: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

export function findProjectRoot(filePath: string, rootMarkers: string[]): string {
  let dir = path.dirname(path.resolve(filePath));
  if (rootMarkers.length === 0) {
    return dir;
  }
  for (;;) {
    for (const marker of rootMarkers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.dirname(path.resolve(filePath));
    }
    dir = parent;
  }
}

export function formatDiagnostics(
  diagnostics: LspDiagnostic[],
  opts: { filePath: string; maxChars?: number },
): string {
  const maxChars = opts.maxChars ?? LSP_DEFAULT_MAX_DIAGNOSTICS_CHARS;
  const sorted = diagnostics.toSorted((a, b) => {
    const sa = a.severity ?? 9;
    const sb = b.severity ?? 9;
    if (sa !== sb) {
      return sa - sb;
    }
    return a.range.start.line - b.range.start.line;
  });
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const diag of sorted) {
    const severity = SEVERITY_LABEL[diag.severity ?? 0] ?? "info";
    const message = diag.message.replace(/\s+/g, " ").trim();
    const line = `${opts.filePath}:${diag.range.start.line + 1}:${diag.range.start.character + 1} ${severity} ${message}`;
    if (used + line.length + 1 > maxChars) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  const remaining = sorted.length - shown;
  if (remaining > 0) {
    lines.push(`… ${remaining} more`);
  }
  return lines.join("\n");
}

export function uriToPath(uri: string): string {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
  } catch {
    return uri;
  }
}

export class LspManager {
  private readonly entries = new Map<string, Entry>();
  private readonly servers: ResolvedLspServer[];
  private readonly enabled: boolean;
  private readonly idleMs: number;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs?: number;
  readonly diagnosticsTimeoutMs: number;
  readonly maxDiagnosticsChars: number;

  constructor(opts: LspManagerOptions = {}) {
    this.enabled = opts.config?.lsp?.enabled !== false;
    this.servers = resolveLspServers(opts.config);
    this.idleMs = opts.idleMs ?? 5 * 60_000;
    this.env = opts.env;
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.diagnosticsTimeoutMs =
      opts.config?.lsp?.diagnosticsTimeoutMs ?? LSP_DEFAULT_DIAGNOSTICS_TIMEOUT_MS;
    this.maxDiagnosticsChars =
      opts.config?.lsp?.maxDiagnosticsChars ?? LSP_DEFAULT_MAX_DIAGNOSTICS_CHARS;
  }

  /** Cheap synchronous check: no process is started. */
  availability(filePath: string): LspAvailability {
    if (!this.enabled) {
      return { ok: false, reason: "disabled" };
    }
    const server = serverForFile(this.servers, filePath);
    if (!server) {
      return { ok: false, reason: "no-server" };
    }
    if (!detectOnPath(server.command, this.env)) {
      return { ok: false, reason: "not-installed", server };
    }
    return { ok: true, server, rootDir: findProjectRoot(filePath, server.rootMarkers) };
  }

  async diagnosticsFor(
    filePath: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<LspDiagnostic[]> {
    const avail = this.availability(filePath);
    if (!avail.ok) {
      return [];
    }
    const client = await this.clientFor(avail.server, avail.rootDir);
    const text = await fs.promises.readFile(filePath, "utf8");
    const waiter = client.waitForDiagnostics(
      fileUri(filePath),
      opts.timeoutMs ?? this.diagnosticsTimeoutMs,
    );
    client.syncDocument(path.resolve(filePath), text, avail.server.language);
    try {
      return await waiter;
    } catch {
      return client.currentDiagnostics(fileUri(filePath)) ?? [];
    }
  }

  async definition(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    const client = await this.openFor(filePath);
    return client ? await client.definition(path.resolve(filePath), position) : [];
  }

  async references(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    const client = await this.openFor(filePath);
    return client ? await client.references(path.resolve(filePath), position) : [];
  }

  async hover(filePath: string, position: LspPosition): Promise<LspHover | null> {
    const client = await this.openFor(filePath);
    return client ? await client.hover(path.resolve(filePath), position) : null;
  }

  async stopAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
        }
        await entry.client.stop();
      }),
    );
  }

  private async openFor(filePath: string): Promise<LspClient | null> {
    const avail = this.availability(filePath);
    if (!avail.ok) {
      return null;
    }
    const client = await this.clientFor(avail.server, avail.rootDir);
    const text = await fs.promises.readFile(filePath, "utf8");
    client.syncDocument(path.resolve(filePath), text, avail.server.language);
    return client;
  }

  private async clientFor(server: ResolvedLspServer, rootDir: string): Promise<LspClient> {
    const key = `${server.language}\0${rootDir}`;
    let entry = this.entries.get(key);
    if (entry && !entry.client.alive) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const client = new LspClient({
        command: server.command,
        args: server.args,
        rootDir,
        env: this.env,
        requestTimeoutMs: this.requestTimeoutMs,
        onExit: () => {
          const current = this.entries.get(key);
          if (current?.client === client) {
            if (current.idleTimer) {
              clearTimeout(current.idleTimer);
            }
            this.entries.delete(key);
          }
        },
      });
      const created: Entry = { key, client, starting: client.start(), idleTimer: null };
      this.entries.set(key, created);
      entry = created;
    }
    this.touch(entry);
    try {
      await entry.starting;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
    return entry.client;
  }

  private touch(entry: Entry) {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }
    const timer = setTimeout(() => {
      if (this.entries.get(entry.key) === entry) {
        this.entries.delete(entry.key);
        void entry.client.stop();
      }
    }, this.idleMs);
    timer.unref();
    entry.idleTimer = timer;
  }
}

let shared: { manager: LspManager; signature: string } | null = null;

function signatureFor(config?: Pick<KoLoConfig, "lsp">): string {
  try {
    return JSON.stringify(config?.lsp ?? null);
  } catch {
    return "";
  }
}

/** Process-wide manager, created on first call and replaced when `lsp` config changes. */
export function getLspManager(config?: Pick<KoLoConfig, "lsp">): LspManager {
  const signature = signatureFor(config);
  if (shared && shared.signature === signature) {
    return shared.manager;
  }
  const previous = shared?.manager;
  if (previous) {
    void previous.stopAll();
  }
  shared = { manager: new LspManager({ config }), signature };
  return shared.manager;
}

export function resetLspManagerForTests(): void {
  const previous = shared?.manager;
  shared = null;
  if (previous) {
    void previous.stopAll();
  }
}
