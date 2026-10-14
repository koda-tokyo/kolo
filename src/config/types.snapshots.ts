export type SnapshotsConfig = {
  /** Master switch (default true). */
  enabled?: boolean;
  /** Snapshots kept per session; the oldest are dropped first (default 50). */
  maxPerSession?: number;
  /** Upper bound on stored file content per session in bytes (default 64 MiB). */
  maxBytesPerSession?: number;
  /** Files larger than this are not captured and cannot be undone (default 2 MiB). */
  maxFileBytes?: number;
};
