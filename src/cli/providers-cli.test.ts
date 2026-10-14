import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { registerProvidersCli } from "./providers-cli.js";

vi.mock("../commands/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../commands/providers/index.js")>(
    "../commands/providers/index.js",
  );
  return {
    ...actual,
    providersListCommand: vi.fn(async () => {}),
    providersAddCommand: vi.fn(async () => {}),
    providersTestCommand: vi.fn(async () => {
      throw new actual.ProvidersCommandError('provider "x": HTTP 401', actual.PROVIDERS_EXIT.auth);
    }),
    providersRemoveCommand: vi.fn(async () => {}),
    providersDefaultCommand: vi.fn(async () => {}),
  };
});

function makeRuntime() {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const runtime: RuntimeEnv = {
    log: (...args: unknown[]) => void logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => void errors.push(args.map(String).join(" ")),
    exit: ((code: number) => {
      exits.push(code);
      throw new Error(`exit:${code}`);
    }) as RuntimeEnv["exit"],
  };
  return { runtime, logs, errors, exits };
}

describe("kolo providers cli", () => {
  it("wires the five verbs and their aliases", async () => {
    const mod = await import("../commands/providers/index.js");
    const { runtime } = makeRuntime();
    const program = new Command();
    program.exitOverride();
    registerProvidersCli(program, { runtime });
    const providers = program.commands.find((c) => c.name() === "providers");
    expect(providers?.commands.map((c) => c.name()).toSorted()).toEqual([
      "add",
      "default",
      "list",
      "remove",
      "test",
    ]);
    await program.parseAsync(["providers", "ls", "--json"], { from: "user" });
    expect(mod.providersListCommand).toHaveBeenCalledWith(
      { json: true, all: false },
      runtime,
      expect.any(Object),
    );
    await program.parseAsync(
      ["providers", "add", "sakura", "--api-key-stdin", "--model", "gpt-oss-120b"],
      { from: "user" },
    );
    expect(mod.providersAddCommand).toHaveBeenCalledWith(
      "sakura",
      expect.objectContaining({ apiKeyStdin: true, model: "gpt-oss-120b" }),
      runtime,
      expect.any(Object),
    );
    await program.parseAsync(["providers", "rm", "sakura", "--yes"], { from: "user" });
    expect(mod.providersRemoveCommand).toHaveBeenCalledWith(
      "sakura",
      expect.objectContaining({ yes: true }),
      runtime,
      expect.any(Object),
    );
    await program.parseAsync(["providers", "default", "sakura"], { from: "user" });
    expect(mod.providersDefaultCommand).toHaveBeenCalled();
  });

  it("maps a command error to its exit code and a one-line message", async () => {
    const { runtime, errors, exits } = makeRuntime();
    const program = new Command();
    program.exitOverride();
    registerProvidersCli(program, { runtime });
    await expect(program.parseAsync(["providers", "test", "x"], { from: "user" })).rejects.toThrow(
      "exit:4",
    );
    expect(exits).toEqual([4]);
    expect(errors[0]).toContain('kolo providers: provider "x": HTTP 401');
  });

  it("rejects a non-numeric timeout with exit 2", async () => {
    const { runtime, exits } = makeRuntime();
    const program = new Command();
    program.exitOverride();
    registerProvidersCli(program, { runtime });
    await expect(
      program.parseAsync(["providers", "test", "x", "--timeout", "soon"], { from: "user" }),
    ).rejects.toThrow("exit:2");
    expect(exits).toEqual([2]);
  });
});
