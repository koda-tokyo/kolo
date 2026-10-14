import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecSync } from "./exec.js";
import { createConfigIO } from "../config/io.js";
import { FileSecretStore } from "./file-backend.js";
import { KeychainStore, SecretServiceStore } from "./keyring-backends.js";
import { findPlaintextSecrets, migrateConfigSecrets, secretNameForPath } from "./migrate.js";
import { isSecretRef, isValidSecretName } from "./names.js";
import { resolveConfigSecretRefs } from "./resolve.js";
import { clearSecretStoreCache, resolveSecretStore } from "./store.js";
import { MissingSecretError, SecretStoreDecryptError } from "./types.js";

const FAST_N = 1 << 10;
const FAKE_TOKEN = "fake-line-token-0123456789";
const FAKE_SECRET = "fake-line-secret-abcdef";
const FAKE_KEY = "sk-fake-provider-key-000";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-secrets-"));
  clearSecretStoreCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fileStore(env: NodeJS.ProcessEnv = {}) {
  return new FileSecretStore({ dir: path.join(tmp, "secrets"), env, scryptN: FAST_N });
}

const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe("FileSecretStore", () => {
  it("round-trips values and lists names only", () => {
    const store = fileStore();
    store.set("channel.line.channelAccessToken", FAKE_TOKEN);
    store.set("provider.openai.apiKey", FAKE_KEY);
    const reopened = fileStore();
    expect(reopened.get("channel.line.channelAccessToken")).toBe(FAKE_TOKEN);
    expect(reopened.get("provider.openai.apiKey")).toBe(FAKE_KEY);
    expect(reopened.get("missing.name")).toBeUndefined();
    expect(reopened.list()).toEqual(["channel.line.channelAccessToken", "provider.openai.apiKey"]);
    expect(reopened.delete("provider.openai.apiKey")).toBe(true);
    expect(fileStore().list()).toEqual(["channel.line.channelAccessToken"]);
  });

  it("never writes plaintext to disk", () => {
    const store = fileStore();
    store.set("gateway.token", FAKE_TOKEN);
    const raw = fs.readFileSync(store.location, "utf8");
    expect(raw).not.toContain(FAKE_TOKEN);
    expect(raw).not.toContain("gateway.token");
    expect(JSON.parse(raw)).toMatchObject({ v: 1, kdf: "scrypt" });
  });

  it.runIf(process.platform !== "win32")("creates the key file 0600 and the dir 0700", () => {
    const store = fileStore();
    store.set("gateway.token", FAKE_TOKEN);
    expect(fs.readFileSync(store.keyPath).length).toBe(32);
    expect(mode(store.keyPath)).toBe(0o600);
    expect(mode(store.location)).toBe(0o600);
    expect(mode(path.dirname(store.keyPath))).toBe(0o700);
  });

  it("fails with a decrypt error on the wrong key", () => {
    fileStore({ KOLO_SECRETS_KEY: "right-key-material" }).set("gateway.token", FAKE_TOKEN);
    const wrong = fileStore({ KOLO_SECRETS_KEY: "wrong-key-material" });
    expect(() => wrong.get("gateway.token")).toThrow(SecretStoreDecryptError);
    try {
      wrong.get("gateway.token");
    } catch (err) {
      expect(String(err)).not.toContain(FAKE_TOKEN);
    }
    // KOLO_SECRETS_KEY means no key file is created.
    expect(fs.existsSync(path.join(tmp, "secrets", ".key"))).toBe(false);
  });

  it("detects a tampered store", () => {
    const store = fileStore();
    store.set("gateway.token", FAKE_TOKEN);
    const env = JSON.parse(fs.readFileSync(store.location, "utf8"));
    const ct = Buffer.from(env.ct, "base64");
    ct[0] ^= 0xff;
    env.ct = ct.toString("base64");
    fs.writeFileSync(store.location, JSON.stringify(env));
    expect(() => fileStore().get("gateway.token")).toThrow(SecretStoreDecryptError);
  });

  it("rejects invalid names", () => {
    expect(isValidSecretName("provider.openai.apiKey")).toBe(true);
    expect(isValidSecretName("bad name")).toBe(false);
    expect(isValidSecretName("../escape")).toBe(false);
    expect(() => fileStore().set("bad name", "x")).toThrow(/invalid secret name/);
  });
});

describe("keyring backends (CLI driven)", () => {
  function fakeExec() {
    const calls: Array<{
      command: string;
      args: string[];
      input?: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    const vault = new Map<string, string>();
    const exec: ExecSync = (command, args, opts = {}) => {
      calls.push({ command, args, input: opts.input, env: opts.env });
      if (command === "secret-tool") {
        const name = args[args.indexOf("name") + 1];
        if (args[0] === "store") {
          vault.set(name, opts.input ?? "");
          return { status: 0, stdout: "", stderr: "", timedOut: false };
        }
        if (args[0] === "lookup") {
          const v = vault.get(name);
          return v === undefined
            ? { status: 1, stdout: "", stderr: "", timedOut: false }
            : { status: 0, stdout: v, stderr: "", timedOut: false };
        }
        if (args[0] === "clear") {
          vault.delete(name);
          return { status: 0, stdout: "", stderr: "", timedOut: false };
        }
      }
      if (command === "security") {
        if (args[0] === "-i") {
          const m = /-a (\S+) -X ([0-9a-f]+)/.exec(opts.input ?? "");
          vault.set(m![1], Buffer.from(m![2], "hex").toString("utf8"));
          return { status: 0, stdout: "", stderr: "", timedOut: false };
        }
        if (args[0] === "find-generic-password") {
          const v = vault.get(args[args.indexOf("-a") + 1]);
          return v === undefined
            ? { status: 44, stdout: "", stderr: "", timedOut: false }
            : { status: 0, stdout: `${v}\n`, stderr: "", timedOut: false };
        }
      }
      return { status: 2, stdout: "", stderr: "unexpected", timedOut: false };
    };
    return { exec, calls };
  }

  it("secret-service passes the value on stdin, never argv", () => {
    const { exec, calls } = fakeExec();
    const dir = path.join(tmp, "secrets");
    const store = new SecretServiceStore({ dir, home: tmp, exec });
    store.set("channel.line.channelSecret", FAKE_SECRET);
    expect(new SecretServiceStore({ dir, home: tmp, exec }).get("channel.line.channelSecret")).toBe(
      FAKE_SECRET,
    );
    expect(store.list()).toEqual(["channel.line.channelSecret"]);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(FAKE_SECRET);
    }
    expect(fs.readFileSync(path.join(dir, "index.secret-service.json"), "utf8")).not.toContain(
      FAKE_SECRET,
    );
  });

  it("keychain writes through `security -i` with a hex value", () => {
    const { exec, calls } = fakeExec();
    const store = new KeychainStore({ dir: path.join(tmp, "secrets"), home: tmp, exec });
    store.set("provider.anthropic.apiKey", FAKE_KEY);
    expect(store.get("provider.anthropic.apiKey")).toBe(FAKE_KEY);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(FAKE_KEY);
      expect(call.input ?? "").not.toContain(FAKE_KEY);
    }
  });
});

describe("resolveSecretStore", () => {
  it("records the backend on first set so CLI and gateway agree", () => {
    const env = { KOLO_HOME: tmp, KOLO_SECRETS_BACKEND: "file" } as NodeJS.ProcessEnv;
    const store = resolveSecretStore({ env, scryptN: FAST_N });
    expect(store.backend).toBe("file");
    store.set("gateway.token", FAKE_TOKEN);
    expect(fs.readFileSync(path.join(tmp, "secrets", "backend"), "utf8").trim()).toBe("file");
    const later = resolveSecretStore({ env: { KOLO_HOME: tmp }, scryptN: FAST_N });
    expect(later.backend).toBe("file");
    expect(later.get("gateway.token")).toBe(FAKE_TOKEN);
  });
});

describe("$secret refs in kolo.json", () => {
  function setup(config: unknown) {
    const env = { KOLO_HOME: tmp, KOLO_SECRETS_BACKEND: "file" } as NodeJS.ProcessEnv;
    const configPath = path.join(tmp, "kolo.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const store = resolveSecretStore({ env });
    return { env, configPath, store };
  }

  it("resolves refs at load time", () => {
    const { env, configPath, store } = setup({
      gateway: { mode: "local", auth: { mode: "token", token: { $secret: "gateway.token" } } },
    });
    store.set("gateway.token", FAKE_TOKEN);
    const io = createConfigIO({ env, configPath, homedir: () => tmp });
    expect(io.loadConfig().gateway?.auth?.token).toBe(FAKE_TOKEN);
  });

  it("reports a missing secret in the snapshot", async () => {
    const { env, configPath } = setup({
      gateway: { auth: { token: { $secret: "gateway.token" } } },
    });
    const io = createConfigIO({ env, configPath, homedir: () => tmp });
    const snap = await io.readConfigFileSnapshot();
    expect(snap.valid).toBe(false);
    expect(snap.issues[0]?.message).toMatch(/Missing secret "gateway\.token"/);
  });

  it("keeps refs on write and moves edited values into the store", async () => {
    const { env, configPath, store } = setup({
      gateway: { mode: "local", auth: { mode: "token", token: { $secret: "gateway.token" } } },
    });
    store.set("gateway.token", FAKE_TOKEN);
    const io = createConfigIO({ env, configPath, homedir: () => tmp });
    const snap = await io.readConfigFileSnapshot();
    expect(snap.valid).toBe(true);
    const next = structuredClone(snap.config);
    next.gateway!.auth!.token = "fake-rotated-token";
    next.gateway!.port = 18861;
    await io.writeConfigFile(next);
    const raw = fs.readFileSync(configPath, "utf8");
    expect(raw).not.toContain(FAKE_TOKEN);
    expect(raw).not.toContain("fake-rotated-token");
    expect(JSON.parse(raw).gateway.auth.token).toEqual({ $secret: "gateway.token" });
    expect(store.get("gateway.token")).toBe("fake-rotated-token");
  });

  it("leaves env refs alone inside secret values", () => {
    const out = resolveConfigSecretRefs(
      { a: { $secret: "x.y" } },
      { store: () => ({ get: () => "pre${HOME}post" }) as never, escapeEnv: true },
    );
    expect(out).toEqual({ a: "pre$${HOME}post" });
    expect(() =>
      resolveConfigSecretRefs(
        { a: { $secret: "x.y" } },
        { store: () => ({ get: () => undefined }) as never },
      ),
    ).toThrow(MissingSecretError);
  });
});

describe("kolo secrets migrate", () => {
  it("finds plaintext credentials with canonical names", () => {
    const found = findPlaintextSecrets({
      gateway: { auth: { token: FAKE_TOKEN, tokenFile: "/x" }, remote: { token: FAKE_TOKEN } },
      channels: { line: { channelAccessToken: FAKE_TOKEN, channelSecret: FAKE_SECRET } },
      models: { providers: { openai: { apiKey: FAKE_KEY, baseUrl: "https://example.invalid" } } },
      env: { vars: { FAKE_API_KEY: FAKE_KEY, PLAIN: "x" } },
      skills: { entries: { search: { apiKey: "${SEARCH_KEY}" } } },
      already: { token: { $secret: "already.token" } },
    }).map((f) => f.name);
    expect(found.toSorted()).toEqual(
      [
        "channel.line.channelAccessToken",
        "channel.line.channelSecret",
        "env.FAKE_API_KEY",
        "gateway.remote.token",
        "gateway.token",
        "provider.openai.apiKey",
      ].toSorted(),
    );
    expect(secretNameForPath(["gateway", "auth", "password"])).toBe("gateway.password");
  });

  it("moves values to the store, writes refs, and backs up kolo.json first", () => {
    const configPath = path.join(tmp, "kolo.json");
    const original = {
      gateway: { mode: "local", auth: { mode: "token", token: FAKE_TOKEN } },
      channels: { line: { channelAccessToken: FAKE_TOKEN, channelSecret: FAKE_SECRET } },
    };
    fs.writeFileSync(configPath, JSON.stringify(original, null, 2));
    const store = fileStore();
    const result = migrateConfigSecrets({ configPath, store, now: () => new Date(0) });
    expect(result.moved.map((m) => m.name).toSorted()).toEqual([
      "channel.line.channelAccessToken",
      "channel.line.channelSecret",
      "gateway.token",
    ]);
    expect(result.backupPath).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(result.backupPath!, "utf8"))).toEqual(original);
    if (process.platform !== "win32") {
      expect(mode(result.backupPath!)).toBe(0o600);
    }
    const rewritten = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(isSecretRef(rewritten.channels.line.channelSecret)).toBe(true);
    expect(JSON.stringify(rewritten)).not.toContain(FAKE_TOKEN);
    expect(store.get("channel.line.channelSecret")).toBe(FAKE_SECRET);
    // Idempotent: nothing left to move.
    expect(migrateConfigSecrets({ configPath, store }).moved).toEqual([]);
  });

  it("dry run changes nothing", () => {
    const configPath = path.join(tmp, "kolo.json");
    fs.writeFileSync(configPath, JSON.stringify({ talk: { apiKey: FAKE_KEY } }));
    const store = fileStore();
    const result = migrateConfigSecrets({ configPath, store, dryRun: true });
    expect(result.moved).toEqual([{ configPath: "talk.apiKey", name: "talk.apiKey" }]);
    expect(store.list()).toEqual([]);
    expect(fs.readFileSync(configPath, "utf8")).toContain(FAKE_KEY);
  });
});
