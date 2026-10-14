export type FormatConfig = {
  /** Master switch (default true; a formatter is still skipped when its command is absent). */
  enabled?: boolean;
  /**
   * Formatter per language id, run after `write`, `edit` and `apply_patch`. A command line with
   * `{file}` for the edited path (appended when absent), or `false` to turn a default off.
   */
  onEdit?: Record<string, string | false>;
  /** Milliseconds a formatter may run before it is stopped (default 10000). */
  timeoutMs?: number;
  /** Upper bound on formatter output appended to the tool result (default 2000 chars). */
  maxOutputChars?: number;
};
