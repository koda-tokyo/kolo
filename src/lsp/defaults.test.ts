import { describe, expect, test } from "vitest";
import { detectOnPath, LSP_DEFAULT_SERVERS, resolveLspServers, serverForFile } from "./defaults.js";

describe("lsp defaults", () => {
  test("ships commands for the five default languages", () => {
    expect(Object.keys(LSP_DEFAULT_SERVERS).toSorted()).toEqual([
      "go",
      "java",
      "python",
      "rust",
      "typescript",
    ]);
    const servers = resolveLspServers({});
    expect(servers.find((s) => s.language === "typescript")?.command).toBe(
      "typescript-language-server",
    );
    expect(servers.find((s) => s.language === "go")?.extensions).toEqual(["go"]);
  });

  test("user entries override defaults and disabled removes them", () => {
    const servers = resolveLspServers({
      lsp: {
        servers: {
          python: { command: "my-pyls", args: ["--x"] },
          rust: { command: "rust-analyzer", disabled: true },
          fake: { command: "node", extensions: [".Fake", "fk"] },
        },
      },
    });
    const python = servers.find((s) => s.language === "python");
    expect(python?.command).toBe("my-pyls");
    expect(python?.args).toEqual(["--x"]);
    expect(python?.extensions).toEqual(["py"]);
    expect(servers.find((s) => s.language === "rust")).toBeUndefined();
    expect(servers.find((s) => s.language === "fake")?.extensions).toEqual(["fake", "fk"]);
  });

  test("enabled:false yields no servers", () => {
    expect(resolveLspServers({ lsp: { enabled: false } })).toEqual([]);
  });

  test("serverForFile matches by extension", () => {
    const servers = resolveLspServers({});
    expect(serverForFile(servers, "/w/a.tsx")?.language).toBe("typescript");
    expect(serverForFile(servers, "/w/main.rs")?.language).toBe("rust");
    expect(serverForFile(servers, "/w/README")).toBeUndefined();
  });

  test("detectOnPath: absent command is undefined, node is found", () => {
    expect(detectOnPath("kolo-no-such-language-server-xyz")).toBeUndefined();
    expect(detectOnPath("")).toBeUndefined();
    expect(detectOnPath(process.execPath)).toBe(process.execPath);
  });
});
