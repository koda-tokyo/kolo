import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrivateOverlayCache } from "../infra/private-overlay.js";
import {
  setExternalCliSyncEnabled,
  syncExternalCliCredentials,
} from "./auth-profiles/external-cli-sync.js";

const OVERLAY = `
const expires = Date.now() + 60 * 60 * 1000;
module.exports = {
  listExternalCliCredentials() {
    return [
      {
        profileId: "anthropic:claude-cli",
        provider: "anthropic",
        sourceLabel: "claude cli",
        readCredentials: () => ({ type: "token", provider: "anthropic", token: "claude-token", expires }),
      },
      {
        profileId: "openai-codex:codex-cli",
        provider: "openai-codex",
        sourceLabel: "codex cli",
        readCredentials: () => ({
          type: "oauth", provider: "openai-codex", access: "codex-access", refresh: "codex-refresh",
          expires, accountId: "acct-123",
        }),
      },
    ];
  },
};
`;

describe("syncExternalCliCredentials", () => {
  let dir: string;
  let prevOverlayDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-ext-sync-"));
    prevOverlayDir = process.env.KOLO_OVERLAY_DIR;
    process.env.KOLO_OVERLAY_DIR = dir;
    resetPrivateOverlayCache();
    setExternalCliSyncEnabled(true);
  });

  afterEach(() => {
    if (prevOverlayDir === undefined) {
      delete process.env.KOLO_OVERLAY_DIR;
    } else {
      process.env.KOLO_OVERLAY_DIR = prevOverlayDir;
    }
    resetPrivateOverlayCache();
    setExternalCliSyncEnabled(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("syncs nothing on a clean checkout (no overlay sources)", () => {
    const store = { version: 1, profiles: {} };
    expect(syncExternalCliCredentials(store)).toBe(false);
    expect(store.profiles).toEqual({});
  });

  it("syncs overlay-provided token and OAuth credentials into the auth profile store", () => {
    fs.writeFileSync(path.join(dir, "oauth-sources.cjs"), OVERLAY);
    resetPrivateOverlayCache();
    const store = { version: 1, profiles: {} };

    expect(syncExternalCliCredentials(store)).toBe(true);
    expect(store.profiles["anthropic:claude-cli"]).toMatchObject({
      type: "token",
      provider: "anthropic",
      token: "claude-token",
    });
    expect(store.profiles["openai-codex:codex-cli"]).toMatchObject({
      type: "oauth",
      provider: "openai-codex",
      access: "codex-access",
      refresh: "codex-refresh",
      accountId: "acct-123",
    });
  });

  it("stays off unless enabled", () => {
    fs.writeFileSync(path.join(dir, "oauth-sources.cjs"), OVERLAY);
    resetPrivateOverlayCache();
    setExternalCliSyncEnabled(false);
    const store = { version: 1, profiles: {} };
    expect(syncExternalCliCredentials(store)).toBe(false);
  });
});
