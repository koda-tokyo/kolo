// Shared wording of reasoning headers for every terminal surface (`kolo tui`, `kolo attach`).
// No dependencies, so the attach CLI does not pull in the TUI.

/** `1s`, `12s`, `1m 5s`, `2m`: never below one second. */
export function formatReasoningDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Header of a finished reasoning block: `Thought for 12s`, or `Thought` without timing. */
export function reasoningDoneHeader(durationMs?: number | null): string {
  return typeof durationMs === "number"
    ? `Thought for ${formatReasoningDuration(durationMs)}`
    : "Thought";
}

export const REASONING_THINKING_HEADER = "Thinking";

// CSI / OSC / other ESC sequences, then remaining C0 controls (newline is kept) and DEL.
// oxlint-disable-next-line no-control-regex
const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// oxlint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Reasoning text safe to print: no escape sequences (cursor moves, colours, links), no control
 * characters, tabs as two spaces, newlines kept. Model output never drives the terminal.
 */
export function sanitizeReasoningText(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROL_RE, "")
    .trim();
}
