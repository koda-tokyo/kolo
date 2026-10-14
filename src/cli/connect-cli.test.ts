import { Command } from "commander";
import { describe, expect, test } from "vitest";
import type { ConnectDeps } from "../commands/connect/types.js";
import type { RuntimeEnv } from "../runtime.js";
import { registerConnectCli } from "./connect-cli.js";

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const runtime = {
    log: (...a: unknown[]) => out.push(a.join(" ")),
    error: (...a: unknown[]) => err.push(a.join(" ")),
    exit: (code: number) => {
      exits.push(code);
    },
  } as RuntimeEnv;
  const program = new Command().exitOverride();
  registerConnectCli(program, {
    runtime,
    createDeps: async () =>
      ({
        runtime,
        env: { KOLO_HOME: "/nonexistent-kolo-home" },
        now: Date.now,
      }) as unknown as ConnectDeps,
  });
  return { program, out, err, exits };
}

describe("kolo connect (CLI)", () => {
  test("unknown or missing channel is a usage error (exit 2)", async () => {
    const h = harness();
    await h.program.parseAsync(["node", "kolo", "connect", "pager"]);
    expect(h.exits).toEqual([2]);
    expect(h.err.join("\n")).toContain("unknown channel 'pager'");
    const m = harness();
    await m.program.parseAsync(["node", "kolo", "connect"]);
    expect(m.exits).toEqual([2]);
  });

  test("--unbind validates the channel; web points at kolo pair revoke", async () => {
    const h = harness();
    await h.program.parseAsync(["node", "kolo", "connect", "--unbind", "pager"]);
    expect(h.exits).toEqual([2]);
    const w = harness();
    await w.program.parseAsync(["node", "kolo", "connect", "--unbind", "web"]);
    expect(w.exits).toEqual([2]);
    expect(w.err.join("\n")).toContain("kolo pair revoke");
  });

  test("--list with no bindings says how to start", async () => {
    const h = harness();
    await h.program.parseAsync(["node", "kolo", "connect", "--list", "--json"]);
    expect(JSON.parse(h.out.join("\n"))).toEqual({ ok: true, owners: [] });
  });
});
