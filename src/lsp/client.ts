import { type ChildProcess, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { encodeFrame, FrameDecoder } from "./framing.js";

/**
 * Minimal Language Server Protocol client over stdio (KoLo 2.0, M9b). Supports the handful of
 * requests the agent tools need: diagnostics (via publishDiagnostics), definition, references and
 * hover. Every request has a timeout; the server process is spawned on `start()`, never on import.
 */

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspLocation = { uri: string; range: LspRange };
export type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
};
export type LspHover = {
  contents: unknown;
  range?: LspRange;
};

export type LspClientOptions = {
  command: string;
  args?: string[];
  rootDir: string;
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout in milliseconds (default 5000). */
  requestTimeoutMs?: number;
  /** Diagnostics callback for every publishDiagnostics notification. */
  onDiagnostics?: (uri: string, diagnostics: LspDiagnostic[]) => void;
  onExit?: (code: number | null) => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type JsonRpcResponse = {
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: unknown;
};

export const DEFAULT_LSP_REQUEST_TIMEOUT_MS = 5000;

export function fileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

export class LspClient {
  private child: ChildProcess | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly versions = new Map<string, number>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Set<(d: LspDiagnostic[]) => void>>();
  private exited = false;
  private initialized = false;

  constructor(private readonly opts: LspClientOptions) {}

  get alive(): boolean {
    return this.child !== null && !this.exited;
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.rootDir,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr?.on("data", () => {
      // Language servers log to stderr; nothing to surface here.
    });
    child.on("exit", (code) => {
      this.exited = true;
      const err = new Error(`language server exited (${code ?? "signal"})`);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this.pending.clear();
      this.opts.onExit?.(code);
    });
    child.on("error", (err) => {
      this.exited = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this.pending.clear();
      this.opts.onExit?.(null);
    });
    await this.request("initialize", {
      processId: process.pid,
      rootUri: fileUri(this.opts.rootDir),
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
        },
      },
      workspaceFolders: [{ uri: fileUri(this.opts.rootDir), name: "workspace" }],
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || this.exited) {
      return;
    }
    try {
      if (this.initialized) {
        await this.request("shutdown", null, 1500).catch(() => undefined);
      }
      this.notify("exit", null);
    } catch {
      // fall through to kill
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.exited) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 1000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Open (first call) or fully replace (later calls) the document text. */
  syncDocument(filePath: string, text: string, languageId: string): string {
    const uri = fileUri(filePath);
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    if (version === 1) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version, text },
      });
    } else {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    return uri;
  }

  currentDiagnostics(uri: string): LspDiagnostic[] | undefined {
    return this.diagnostics.get(uri);
  }

  /** Resolves with the next publishDiagnostics for `uri`, or rejects after `timeoutMs`. */
  waitForDiagnostics(uri: string, timeoutMs: number): Promise<LspDiagnostic[]> {
    return new Promise((resolve, reject) => {
      let waiters = this.diagnosticWaiters.get(uri);
      if (!waiters) {
        waiters = new Set();
        this.diagnosticWaiters.set(uri, waiters);
      }
      const set = waiters;
      const timer = setTimeout(() => {
        set.delete(handler);
        reject(new Error("timed out waiting for diagnostics"));
      }, timeoutMs);
      const handler = (d: LspDiagnostic[]) => {
        clearTimeout(timer);
        set.delete(handler);
        resolve(d);
      };
      set.add(handler);
    });
  }

  async definition(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    const res = await this.request("textDocument/definition", {
      textDocument: { uri: fileUri(filePath) },
      position,
    });
    return normalizeLocations(res);
  }

  async references(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    const res = await this.request("textDocument/references", {
      textDocument: { uri: fileUri(filePath) },
      position,
      context: { includeDeclaration: true },
    });
    return normalizeLocations(res);
  }

  async hover(filePath: string, position: LspPosition): Promise<LspHover | null> {
    const res = await this.request("textDocument/hover", {
      textDocument: { uri: fileUri(filePath) },
      position,
    });
    if (!res || typeof res !== "object") {
      return null;
    }
    return res as LspHover;
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.child;
    if (!child || this.exited || !child.stdin) {
      return Promise.reject(new Error("language server not running"));
    }
    const id = this.nextId++;
    const limit = timeoutMs ?? this.opts.requestTimeoutMs ?? DEFAULT_LSP_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${limit} ms`));
      }, limit);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin?.write(encodeFrame({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child || this.exited || !child.stdin) {
      return;
    }
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", method, params }));
  }

  private onData(chunk: Buffer) {
    for (const message of this.decoder.push(chunk)) {
      this.onMessage(message as JsonRpcResponse);
    }
  }

  private onMessage(message: JsonRpcResponse) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.id !== undefined && typeof message.method !== "string") {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "language server error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = (message.params ?? {}) as { uri?: string; diagnostics?: LspDiagnostic[] };
      const uri = params.uri ?? "";
      const list = Array.isArray(params.diagnostics) ? params.diagnostics : [];
      this.diagnostics.set(uri, list);
      this.opts.onDiagnostics?.(uri, list);
      const waiters = this.diagnosticWaiters.get(uri);
      if (waiters) {
        for (const handler of Array.from(waiters)) {
          handler(list);
        }
      }
      return;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      // Server-to-client request (e.g. client/registerCapability, workspace/configuration):
      // answer with an empty result so the server does not block.
      const result = message.method === "workspace/configuration" ? [] : null;
      this.child?.stdin?.write(encodeFrame({ jsonrpc: "2.0", id: message.id, result }));
    }
  }
}

function normalizeLocations(res: unknown): LspLocation[] {
  if (!res) {
    return [];
  }
  const list = Array.isArray(res) ? res : [res];
  const out: LspLocation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.uri === "string" && record.range) {
      out.push({ uri: record.uri, range: record.range as LspRange });
    } else if (typeof record.targetUri === "string" && record.targetRange) {
      // LocationLink
      out.push({
        uri: record.targetUri,
        range: (record.targetSelectionRange ?? record.targetRange) as LspRange,
      });
    }
  }
  return out;
}
