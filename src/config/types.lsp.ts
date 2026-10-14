export type LspServerConfig = {
  /** Executable name or path; skipped when not found on PATH. */
  command: string;
  args?: string[];
  /** File names that mark a project root (e.g. `package.json`, `go.mod`). */
  rootMarkers?: string[];
  /** File extensions (without dot) this server handles; defaults come from the language key. */
  extensions?: string[];
  /** Set to true to disable a built-in default without removing it. */
  disabled?: boolean;
};

export type LspConfig = {
  /** Master switch (default true; servers are still skipped when absent on PATH). */
  enabled?: boolean;
  /** Per-language server definitions keyed by language id (`typescript`, `python`, ...). */
  servers?: Record<string, LspServerConfig>;
  /** Upper bound on diagnostics text appended to a file-edit tool result (default 4000 chars). */
  maxDiagnosticsChars?: number;
  /** Milliseconds to wait for diagnostics after an edit (default 3000). */
  diagnosticsTimeoutMs?: number;
};
