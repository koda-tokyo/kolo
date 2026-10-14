import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CognitiveAction, ConsciousnessConfig } from "./types.js";
import { executeActions } from "./action.js";

function makeConfig(workspaceDir: string): ConsciousnessConfig {
  return {
    userId: "iris",
    agentName: "Iris",
    tickIntervalMs: 60_000,
    minTickIntervalMs: 60_000,
    maxTickIntervalMs: 300_000,
    maxTokensPerThought: 256,
    maxActionsPerTick: 5,
    perceptionSources: ["internal"],
    autonomousActions: ["update_file", "noop"],
    gatedActions: ["send_message", "create_task", "notify", "start_work"],
    workspaceDir,
  };
}

describe("executeActions", () => {
  it("rejects update_file writes to STM.json", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "kolo-consciousness-"));
    const config = makeConfig(workspaceDir);
    const action: CognitiveAction = {
      kind: "update_file",
      intent: "overwrite stm",
      target: "STM.json",
      content: "plain text clobber",
    };

    const [result] = await executeActions([action], config);

    expect(result.success).toBe(false);
    expect(result.error).toContain("protected continuity file");
  });

  it("rejects other continuity state files", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "kolo-consciousness-"));
    const config = makeConfig(workspaceDir);
    const action: CognitiveAction = {
      kind: "update_file",
      intent: "overwrite daily brief",
      target: "memory/TODAY_BRIEF.md",
      content: "plain text clobber",
    };

    const [result] = await executeActions([action], config);

    expect(result.success).toBe(false);
    expect(result.error).toContain("protected continuity file");
    expect(result.error).toContain("TODAY_BRIEF.md");
  });

  it("still allows normal workspace file updates", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "kolo-consciousness-"));
    const config = makeConfig(workspaceDir);
    const action: CognitiveAction = {
      kind: "update_file",
      intent: "write note",
      target: "notes/test.txt",
      content: "hello",
    };

    const [result] = await executeActions([action], config);
    const written = await readFile(path.join(workspaceDir, "notes", "test.txt"), "utf-8");

    expect(result.success).toBe(true);
    expect(written).toBe("hello");
  });
});
