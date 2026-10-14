import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "KoLo", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "KoLo", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "KoLo", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "KoLo", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "KoLo", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "KoLo", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "KoLo", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "KoLo"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "KoLo", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "KoLo", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "KoLo", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "KoLo", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "KoLo", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "KoLo", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "KoLo", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "KoLo", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "KoLo", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "KoLo", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "KoLo", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "KoLo", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "KoLo", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "KoLo", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node", "KoLo", "status"],
    });
    expect(nodeArgv).toEqual(["node", "KoLo", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node-22", "KoLo", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "KoLo", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node-22.2.0.exe", "KoLo", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "KoLo", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node-22.2", "KoLo", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "KoLo", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node-22.2.exe", "KoLo", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "KoLo", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["/usr/bin/node-22.2.0", "KoLo", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "KoLo", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["nodejs", "KoLo", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "KoLo", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["node-dev", "KoLo", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "KoLo", "node-dev", "KoLo", "status"]);

    const directArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["KoLo", "status"],
    });
    expect(directArgv).toEqual(["node", "KoLo", "status"]);

    const bunArgv = buildParseArgv({
      programName: "KoLo",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "KoLo",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "KoLo", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "KoLo", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "KoLo", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "KoLo", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "KoLo", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "KoLo", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "KoLo", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "KoLo", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
