// `kolo mcp` argument handling (M6): server config building, secret-ref headers, and the test
// verb against the fake stdio server.
import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { McpServerStatus } from "../mcp/client/connection.js";
import { buildServerConfig, headerValue, parseKeyValue, registerMcpCli } from "./mcp-cli.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/mcp/fake-mcp-server.mjs",
);

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({
      mcp: {
        servers: {
          fake: { transport: "stdio", command: process.execPath, args: [FIXTURE] },
        },
      },
    }),
  };
});

describe("buildServerConfig", () => {
  it("builds stdio and http servers", () => {
    expect(
      buildServerConfig({
        stdio: "npx",
        args: ["-y", "srv"],
        env: ["A=1"],
        allow: ["read_*,search"],
      }),
    ).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
      env: { A: "1" },
      allowTools: ["read_*", "search"],
    });
    expect(
      buildServerConfig({
        url: "https://x.test/mcp",
        header: ["Authorization=Bearer $secret:mcp.x"],
        timeout: "5000",
        disabled: true,
      }),
    ).toEqual({
      transport: "http",
      url: "https://x.test/mcp",
      headers: { Authorization: "Bearer $secret:mcp.x" },
      timeoutMs: 5000,
      enabled: false,
    });
  });

  it("stores a whole-value $secret:<name> header as a reference, never the value", () => {
    expect(headerValue("$secret:mcp.docs.token")).toEqual({ $secret: "mcp.docs.token" });
    expect(headerValue("plain")).toBe("plain");
    const cfg = buildServerConfig({ url: "http://h/mcp", header: ["X-Token=$secret:mcp.h"] });
    expect(cfg.headers).toEqual({ "X-Token": { $secret: "mcp.h" } });
  });

  it("rejects bad combinations", () => {
    expect(() => buildServerConfig({})).toThrow(/exactly one/);
    expect(() => buildServerConfig({ stdio: "x", url: "http://h" })).toThrow(/exactly one/);
    expect(() => buildServerConfig({ url: "ftp://h" })).toThrow(/http/);
    expect(() => buildServerConfig({ stdio: "x", header: ["A=b"] })).toThrow(/http servers only/);
    expect(() => parseKeyValue(["novalue"], "--env")).toThrow(/KEY=VALUE/);
  });
});

describe("kolo mcp test", () => {
  it("connects to the fake server and prints its inventory as JSON", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let exitCode: number | undefined;
    const program = new Command();
    program.exitOverride();
    registerMcpCli(program, {
      runtime: {
        log: (m: string) => out.push(m),
        error: (m: string) => err.push(m),
        exit: (code?: number) => {
          exitCode = code;
          throw new Error(`exit ${code}`);
        },
      } as never,
    });
    await program.parseAsync(["node", "kolo", "mcp", "test", "fake", "--json"]);
    expect(exitCode).toBeUndefined();
    const status = JSON.parse(out.join("\n")) as McpServerStatus & { ok: boolean };
    expect(status.ok).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.tools.map((t) => t.name)).toContain("echo");
    expect(status.tools.find((t) => t.name === "run_command")?.exposed).toBe(false);
    expect(status.resources).toHaveLength(1);
    expect(status.prompts).toHaveLength(1);
  }, 20_000);

  it("exits 2 for an unknown server id", async () => {
    const out: string[] = [];
    let exitCode: number | undefined;
    const program = new Command();
    program.exitOverride();
    registerMcpCli(program, {
      runtime: {
        log: (m: string) => out.push(m),
        error: () => {},
        exit: (code?: number) => {
          exitCode = code;
          throw new Error(`exit ${code}`);
        },
      } as never,
    });
    await expect(
      program.parseAsync(["node", "kolo", "mcp", "test", "nope", "--json"]),
    ).rejects.toThrow();
    expect(exitCode).toBe(2);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ ok: false });
  });
});
