import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import { __resetJobsForTest, completeJob, startJob } from "../agents/jobs.js";
import { appendAudit, flushAudit } from "../audit/audit-log.js";
import {
  buildContinuityManifest,
  canonicalJson,
  chainEntries,
  CHAIN_GENESIS,
  diffKind,
  entryHash,
  loadSigningKey,
  redactValue,
  resolveSigningKeyPath,
  type SigningKey,
  signManifest,
  verifyManifest,
} from "./manifest.js";
import { CONTINUITY_MANIFEST_VERSION, type ContinuityManifest } from "./types.js";

function testKey(): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function unsignedManifest(
  entries: Array<{ kind: "identity" | "memory"; name: string; sha256: string }>,
) {
  const chained = chainEntries(entries);
  return {
    version: CONTINUITY_MANIFEST_VERSION,
    resident: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    counts: {
      identity: entries.filter((e) => e.kind === "identity").length,
      memory: entries.filter((e) => e.kind === "memory").length,
      role: 0,
      model: 0,
      job: 0,
      session: 0,
      transcript: 0,
      audit: 0,
    },
    entries: chained.entries,
    root: chained.root,
  };
}

describe("continuity manifest: canonical JSON and chain", () => {
  test("canonicalJson sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}]},"b":1}',
    );
  });

  test("chain starts at genesis and every hash depends on the previous one", () => {
    const { entries, root } = chainEntries([
      { kind: "identity", name: "IDENTITY.md", sha256: "aa" },
      { kind: "memory", name: "MEMORY.md", sha256: "bb" },
    ]);
    expect(entries[0].hash).toBe(
      entryHash(CHAIN_GENESIS, { kind: "identity", name: "IDENTITY.md", sha256: "aa" }),
    );
    expect(entries[1].hash).toBe(
      entryHash(entries[0].hash, { kind: "memory", name: "MEMORY.md", sha256: "bb" }),
    );
    expect(root).toBe(entries[1].hash);
    expect(chainEntries([]).root).toBe(CHAIN_GENESIS);
  });

  test("redactValue blanks secret-looking keys only", () => {
    expect(
      redactValue({ apiKey: "x", token: "y", name: "alice", nested: { password: "p", ok: 1 } }),
    ).toEqual({
      apiKey: "[redacted]",
      token: "[redacted]",
      name: "alice",
      nested: { password: "[redacted]", ok: 1 },
    });
  });
});

describe("continuity manifest: signing and verification", () => {
  test("a signed manifest verifies and the signer id is the key fingerprint", () => {
    const key = testKey();
    const manifest = signManifest(
      unsignedManifest([{ kind: "identity", name: "SOUL.md", sha256: "01" }]),
      key,
    );
    const v = verifyManifest(manifest);
    expect(v).toMatchObject({
      ok: true,
      chainOk: true,
      rootOk: true,
      signatureOk: true,
      keyIdOk: true,
    });
    expect(manifest.signer.keyId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("editing an entry breaks the chain at that index", () => {
    const key = testKey();
    const manifest = signManifest(
      unsignedManifest([
        { kind: "identity", name: "SOUL.md", sha256: "01" },
        { kind: "memory", name: "MEMORY.md", sha256: "02" },
      ]),
      key,
    );
    const tampered: ContinuityManifest = JSON.parse(JSON.stringify(manifest));
    tampered.entries[1].sha256 = "ff";
    const v = verifyManifest(tampered);
    expect(v.ok).toBe(false);
    expect(v.chainOk).toBe(false);
    expect(v.firstBreak).toBe(1);
  });

  test("re-chaining after an edit still fails the signature", () => {
    const key = testKey();
    const manifest = signManifest(
      unsignedManifest([{ kind: "identity", name: "SOUL.md", sha256: "01" }]),
      key,
    );
    const rechained = chainEntries([{ kind: "identity", name: "SOUL.md", sha256: "ff" }]);
    const forged: ContinuityManifest = {
      ...manifest,
      entries: rechained.entries,
      root: rechained.root,
    };
    const v = verifyManifest(forged);
    expect(v.chainOk).toBe(true);
    expect(v.rootOk).toBe(true);
    expect(v.signatureOk).toBe(false);
    expect(v.ok).toBe(false);
  });

  test("a different key cannot claim the same keyId", () => {
    const key = testKey();
    const other = testKey();
    const manifest = signManifest(unsignedManifest([]), key);
    const swapped = signManifest(unsignedManifest([]), other);
    const forged: ContinuityManifest = {
      ...swapped,
      signer: { ...swapped.signer, keyId: manifest.signer.keyId },
    };
    expect(verifyManifest(forged).keyIdOk).toBe(false);
  });
});

describe("continuity manifest: built from a state dir", () => {
  let home = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cont-manifest-"));
    for (const k of ["KOLO_HOME", "KOLO_STATE_DIR", "KOLO_SHARED_HOME", "KOLO_CONFIG_PATH"]) {
      saved[k] = process.env[k];
    }
    process.env.KOLO_HOME = home;
    process.env.KOLO_STATE_DIR = home;
    process.env.KOLO_SHARED_HOME = home;
    process.env.KOLO_CONFIG_PATH = path.join(home, "kolo.json");
    __resetJobsForTest();
  });

  afterEach(() => {
    __resetJobsForTest();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("lists identity, memory, role, model, jobs, sessions, transcripts and audit; paths are relative", async () => {
    const ws = path.join(home, "workspace");
    fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
    fs.writeFileSync(path.join(ws, "IDENTITY.md"), "- Name: Alice\n");
    fs.writeFileSync(path.join(ws, "SOUL.md"), "Be kind.\n");
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "# memory\n");
    fs.writeFileSync(path.join(ws, "memory", "facts.md"), "The harbour codename is Blue Heron.\n");
    const sessionsDir = path.join(home, "agents", "alice", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({ "agent:alice:main": { sessionId: "s1", updatedAt: 1, label: "main" } }),
    );
    fs.writeFileSync(path.join(sessionsDir, "s1.jsonl"), '{"type":"message"}\n');
    const job = startJob({ agent: "alice", sessionKey: "agent:alice:main", kind: "agent" });
    completeJob(job.id, { status: "succeeded" });
    await appendAudit({
      identity: "test",
      action: "continuity.test",
      outcome: "ok",
      source: "test",
    });
    await flushAudit();

    const cfg = {
      agents: { list: [{ id: "alice", default: true, tools: { deny: ["exec"] } }] },
    } as unknown as KoLoConfig;
    const manifest = await buildContinuityManifest({
      cfg,
      agentId: "alice",
      stateDir: home,
      key: testKey(),
    });

    expect(verifyManifest(manifest).ok).toBe(true);
    expect(manifest.counts).toMatchObject({
      identity: 2,
      memory: 2,
      role: 1,
      model: 1,
      job: 1,
      session: 1,
      transcript: 1,
      audit: 1,
    });
    const names = manifest.entries.map((e) => `${e.kind}:${e.name}`);
    expect(names).toContain("identity:IDENTITY.md");
    expect(names).toContain("memory:memory/facts.md");
    expect(names).toContain("session:agent:alice:main");
    expect(names).toContain("transcript:s1.jsonl");
    expect(JSON.stringify(manifest)).not.toContain(home);
    const audit = manifest.entries.find((e) => e.kind === "audit");
    expect(audit?.value).toMatchObject({ ok: true, entries: 1, lastSeq: 1 });
    const role = manifest.entries.find((e) => e.kind === "role");
    expect(JSON.stringify(role?.value)).toContain('"deny":["exec"]');
    expect(JSON.stringify(role?.value)).not.toContain('"model"');
  });

  test("the same state produces the same root; a model swap changes only the model entry", async () => {
    const ws = path.join(home, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, "IDENTITY.md"), "- Name: Alice\n");
    const key = testKey();
    const now = () => new Date("2026-01-01T00:00:00Z");
    const cfgA = {
      agents: {
        list: [{ id: "alice", default: true }],
        defaults: { model: { primary: "fake/alpha" } },
      },
    } as unknown as KoLoConfig;
    const cfgB = {
      agents: {
        list: [{ id: "alice", default: true }],
        defaults: { model: { primary: "fake/beta" } },
      },
    } as unknown as KoLoConfig;
    const m1 = await buildContinuityManifest({
      cfg: cfgA,
      agentId: "alice",
      stateDir: home,
      key,
      now,
    });
    const m2 = await buildContinuityManifest({
      cfg: cfgA,
      agentId: "alice",
      stateDir: home,
      key,
      now,
    });
    const m3 = await buildContinuityManifest({
      cfg: cfgB,
      agentId: "alice",
      stateDir: home,
      key,
      now,
    });
    expect(m1.root).toBe(m2.root);
    expect(m1.root).not.toBe(m3.root);
    expect(diffKind(m1, m3, "identity")).toMatchObject({
      same: ["IDENTITY.md"],
      changed: [],
      added: [],
      removed: [],
    });
    expect(diffKind(m1, m3, "role").changed).toEqual([]);
    expect(diffKind(m1, m3, "model").changed).toEqual(["primary"]);
  });

  test("the signing key is created once under <state>/identity with mode 0600", () => {
    const k1 = loadSigningKey(home);
    const k2 = loadSigningKey(home);
    expect(k1.publicKeyPem).toBe(k2.publicKeyPem);
    const file = resolveSigningKeyPath(home);
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});
