export type StatusLineInput = {
  agentId: string;
  /** Display name for the assistant (config `ui.assistant.name`); omitted when unset. */
  assistantName?: string;
  sessionLabel: string;
  /** Job state: idle, running, streaming, waiting, aborted, error... */
  jobState: string;
  /** Tool steps taken in the current run. */
  steps?: number | null;
  /** Step cap for the run (agents.*.limits.maxSteps). */
  stepLimit?: number | null;
  /** The configured provider id (configuration, not copy). */
  providerProfile?: string;
  model?: string;
  /** Extra short items appended at the end (think level, token counts). */
  extras?: Array<string | null | undefined>;
  /** Terminal width; the line is cut to fit. */
  width?: number;
};

/** Compose the one-line status bar. Pure; the caller styles it. */
export function composeStatusLine(input: StatusLineInput): string {
  const identity = input.assistantName
    ? `${input.agentId} (${input.assistantName})`
    : input.agentId;
  const stepsPart =
    typeof input.steps === "number"
      ? typeof input.stepLimit === "number" && input.stepLimit > 0
        ? `steps ${input.steps}/${input.stepLimit}`
        : `steps ${input.steps}`
      : null;
  const profilePart = input.providerProfile ? `profile ${input.providerProfile}` : null;
  const modelPart = input.model ?? null;
  const parts = [
    identity,
    `session ${input.sessionLabel}`,
    input.jobState || "idle",
    stepsPart,
    profilePart,
    modelPart,
    ...(input.extras ?? []),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const line = parts.join(" | ");
  const width = input.width ?? 0;
  if (width > 3 && line.length > width) {
    return `${line.slice(0, width - 1)}…`;
  }
  return line;
}
