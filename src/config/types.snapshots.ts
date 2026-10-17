export type SnapshotsConfig = {
  /** Master switch (default true). */
  enabled?: boolean;
  /** Snapshots kept per session; the oldest are dropped first (default 50). */
  maxPerSession?: number;
  /** Upper bound on stored file content per session in bytes (default 64 MiB). */
  maxBytesPerSession?: number;
  /** Files larger than this are not captured and cannot be undone (default 2 MiB). */
  maxFileBytes?: number;
  /**
   * Require a successful recovery snapshot before an edit. `true`: every edit; a list of globs
   * (workspace-relative or absolute, e.g. "contracts/**"): only edits to matching files. When a
   * required snapshot cannot be captured (error, file too large or unreadable) the edit is
   * refused. Default: not required — a failed snapshot never blocks an edit.
   */
  required?: boolean | string[];
};
