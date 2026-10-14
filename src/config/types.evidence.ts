/** Evidence bundles (KoLo 2.0, M12): a hash-chained event log per job, signed at job end. */
export type EvidenceConfig = {
  /** Master switch (default true). */
  enabled?: boolean;
  /** Record the raw prompt and assistant text (default false: digests and bounded excerpts only). */
  includePrompts?: boolean;
  /**
   * Record the model's reasoning per turn as a digest plus redacted text bounded by
   * `maxEventBytes` (default false: reasoning is not recorded at all).
   */
  includeReasoning?: boolean;
  /** Events kept per job; the log is closed with a `truncated` event after this (default 5000). */
  maxEvents?: number;
  /** Bytes kept of one redacted tool argument/result or assistant excerpt (default 8192). */
  maxEventBytes?: number;
  /** Upper bound on the event log of one job in bytes (default 16 MiB). */
  maxBytesPerJob?: number;
  /** Days a job's evidence is kept before `kolo evidence prune` removes it (default 30). */
  retentionDays?: number;
};
