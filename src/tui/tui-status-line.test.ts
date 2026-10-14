import { describe, expect, it } from "vitest";
import { composeStatusLine } from "./tui-status-line.js";

describe("composeStatusLine", () => {
  it("lists identity, session, job state, steps, profile and model", () => {
    const line = composeStatusLine({
      agentId: "ops-bot",
      assistantName: "Ops",
      sessionLabel: "main",
      jobState: "running",
      steps: 3,
      stepLimit: 200,
      providerProfile: "default",
      model: "large-01",
      extras: ["think low", null, "12k/200k"],
    });
    expect(line).toBe(
      "ops-bot (Ops) | session main | running | steps 3/200 | profile default | large-01 | think low | 12k/200k",
    );
  });

  it("omits what is unknown and defaults the state to idle", () => {
    expect(composeStatusLine({ agentId: "alice", sessionLabel: "s1", jobState: "" })).toBe(
      "alice | session s1 | idle",
    );
    expect(
      composeStatusLine({ agentId: "alice", sessionLabel: "s1", jobState: "idle", steps: 4 }),
    ).toContain("steps 4");
  });

  it("truncates to the terminal width", () => {
    const line = composeStatusLine({
      agentId: "alice",
      sessionLabel: "a-very-long-session-name",
      jobState: "streaming",
      width: 20,
    });
    expect(line.length).toBe(20);
    expect(line.endsWith("…")).toBe(true);
  });
});
