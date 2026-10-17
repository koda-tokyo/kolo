import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliBackendConfig } from "../config/types.js";
import { runCliAgent } from "./cli-runner.js";
import { cleanupSuspendedCliProcesses, enqueueCliRun } from "./cli-runner/helpers.js";

const runCommandWithTimeoutMock = vi.fn();
const runExecMock = vi.fn();

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
  runExec: (...args: unknown[]) => runExecMock(...args),
}));

describe("runCliAgent resume cleanup", () => {
  beforeEach(() => {
    runCommandWithTimeoutMock.mockReset();
    runExecMock.mockReset();
  });

  it("kills stale resume processes for codex sessions", async () => {
    const stalePid = 424242;
    runExecMock
      .mockResolvedValueOnce({
        stdout: "  1 S /bin/launchd\n",
        stderr: "",
      }) // cleanupSuspendedCliProcesses (ps)
      .mockResolvedValueOnce({
        stdout: `  1 /bin/launchd\n ${stalePid} codex exec resume thread-123 --color never --sandbox workspace-write --skip-git-repo-check\n 777 codex exec resume other-thread --color never --sandbox workspace-write --skip-git-repo-check\n`,
        stderr: "",
      }); // cleanupResumeProcesses (ps listing, matched in-process)
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    try {
      await runCliAgent({
        sessionId: "s1",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-1",
        cliSessionId: "thread-123",
      });

      if (process.platform === "win32") {
        expect(runExecMock).not.toHaveBeenCalled();
        return;
      }

      expect(runExecMock).toHaveBeenCalledTimes(2);
      const listCall = runExecMock.mock.calls[1] ?? [];
      // Never pkill -f: its own argv contains the pattern and can self-match.
      expect(listCall[0]).toBe("ps");
      expect(runExecMock.mock.calls.some((call) => call[0] === "pkill")).toBe(false);
      const killedPids = killSpy.mock.calls.map((call) => call[0]);
      expect(killedPids).toEqual([stalePid]);
    } finally {
      killSpy.mockRestore();
    }
  });
});

describe("cleanupSuspendedCliProcesses", () => {
  beforeEach(() => {
    runExecMock.mockReset();
  });

  it("skips when no session tokens are configured", async () => {
    await cleanupSuspendedCliProcesses(
      {
        command: "tool",
      } as CliBackendConfig,
      0,
    );

    if (process.platform === "win32") {
      expect(runExecMock).not.toHaveBeenCalled();
      return;
    }

    expect(runExecMock).not.toHaveBeenCalled();
  });

  it("matches sessionArg-based commands", async () => {
    runExecMock
      .mockResolvedValueOnce({
        stdout: [
          "  40 T+ claude --session-id thread-1 -p",
          "  41 S  claude --session-id thread-2 -p",
        ].join("\n"),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await cleanupSuspendedCliProcesses(
      {
        command: "claude",
        sessionArg: "--session-id",
      } as CliBackendConfig,
      0,
    );

    if (process.platform === "win32") {
      expect(runExecMock).not.toHaveBeenCalled();
      return;
    }

    expect(runExecMock).toHaveBeenCalledTimes(2);
    const killCall = runExecMock.mock.calls[1] ?? [];
    expect(killCall[0]).toBe("kill");
    expect(killCall[1]).toEqual(["-9", "40"]);
  });

  it("matches resumeArgs with positional session id", async () => {
    runExecMock
      .mockResolvedValueOnce({
        stdout: [
          "  50 T  codex exec resume thread-99 --color never --sandbox workspace-write",
          "  51 T  codex exec resume other --color never --sandbox workspace-write",
        ].join("\n"),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await cleanupSuspendedCliProcesses(
      {
        command: "codex",
        resumeArgs: [
          "exec",
          "resume",
          "{sessionId}",
          "--color",
          "never",
          "--sandbox",
          "workspace-write",
        ],
      } as CliBackendConfig,
      1,
    );

    if (process.platform === "win32") {
      expect(runExecMock).not.toHaveBeenCalled();
      return;
    }

    expect(runExecMock).toHaveBeenCalledTimes(2);
    const killCall = runExecMock.mock.calls[1] ?? [];
    expect(killCall[0]).toBe("kill");
    expect(killCall[1]).toEqual(["-9", "50", "51"]);
  });
});

describe("enqueueCliRun", () => {
  it("does not leak an unhandled rejection when a queued CLI run fails", async () => {
    const onUnhandled = vi.fn();
    process.once("unhandledRejection", onUnhandled);

    try {
      await expect(
        enqueueCliRun("codex-cli", async () => {
          throw new Error("usage limit");
        }),
      ).rejects.toThrow("usage limit");

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandled).not.toHaveBeenCalled();
      await expect(enqueueCliRun("codex-cli", async () => "ok")).resolves.toBe("ok");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("runCliAgent permission flags", () => {
  beforeEach(() => {
    runCommandWithTimeoutMock.mockReset();
    runExecMock.mockReset();
    runExecMock.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("runs claude-cli in dontAsk mode without any bypass flag by default", async () => {
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ result: "ok", session_id: "s-1" }),
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });
    await runCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "claude-cli",
      model: "opus",
      timeoutMs: 1_000,
      runId: "run-perm-1",
    });
    const argv = (runCommandWithTimeoutMock.mock.calls[0]?.[0] ?? []) as string[];
    expect(argv).toContain("--permission-mode");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(argv).not.toContain("--dangerously-skip-permissions");
  });
});
