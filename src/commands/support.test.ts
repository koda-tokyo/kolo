import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSupportServiceId } from "./support.js";

describe("kurahi support service identity", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-support-id-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("uses --id first", () => {
    expect(resolveSupportServiceId({ id: "ops-bot", home, cfg: null, env: {} })).toEqual({
      id: "ops-bot",
      source: "flag",
    });
  });

  it("uses KOLO_SERVICE_ID from the service environment", () => {
    expect(resolveSupportServiceId({ home, cfg: null, env: { KOLO_SERVICE_ID: "alpha" } })).toEqual(
      { id: "alpha", source: "env" },
    );
  });

  it("uses the id recorded by kurahi service install under KOLO_HOME", () => {
    fs.mkdirSync(path.join(home, "service"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "service", "service.json"),
      JSON.stringify({ id: "beta", port: 18789 }),
    );
    expect(
      resolveSupportServiceId({
        home,
        cfg: { agents: { list: [{ id: "alice", default: true }] } },
        env: {},
      }),
    ).toEqual({ id: "beta", source: "service.json" });
  });

  it("falls back to the default agent written by kurahi init", () => {
    expect(
      resolveSupportServiceId({
        home,
        cfg: {
          agents: {
            list: [
              { id: "ops", default: false },
              { id: "Alice", default: true },
            ],
          },
        },
        env: {},
      }),
    ).toEqual({ id: "alice", source: "config" });
    expect(
      resolveSupportServiceId({ home, cfg: { agents: { list: [{ id: "solo" }] } }, env: {} }),
    ).toEqual({ id: "solo", source: "config" });
  });

  it("is `default` only when nothing names the identity", () => {
    expect(resolveSupportServiceId({ home, cfg: {}, env: {} })).toEqual({
      id: "default",
      source: "default",
    });
  });
});
