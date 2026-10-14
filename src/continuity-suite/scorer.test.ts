import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { chainEntries, type SigningKey, signManifest } from "./manifest.js";
import { INVARIANTS, scoreRun, summarize } from "./scorer.js";
import {
  CONTINUITY_MANIFEST_VERSION,
  type ContinuityManifest,
  type DisruptionOutcome,
  type ManifestEntry,
  type ProbeSnapshot,
} from "./types.js";

const KEY: SigningKey = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
})();

type Raw = Omit<ManifestEntry, "hash">;

function baseEntries(over: Partial<Record<string, Raw>> = {}): Raw[] {
  const defaults: Record<string, Raw> = {
    identity: { kind: "identity", name: "IDENTITY.md", sha256: "id-1" },
    soul: { kind: "identity", name: "SOUL.md", sha256: "soul-1" },
    memory: { kind: "memory", name: "memory/facts.md", sha256: "mem-1" },
    role: { kind: "role", name: "agent", value: { tools: { deny: ["exec"] } } },
    model: { kind: "model", name: "primary", value: { provider: "fake", model: "alpha" } },
    session: { kind: "session", name: "agent:alice:main", value: { sessionId: "main-1" } },
    probe: { kind: "session", name: "agent:alice:continuity-probe", value: { sessionId: "p-1" } },
    transcript: { kind: "transcript", name: "main-1.jsonl", sha256: "t-1" },
    probeTranscript: { kind: "transcript", name: "p-1.jsonl", sha256: "pt-1" },
    audit: { kind: "audit", name: "chain", value: { ok: true, entries: 3, lastSeq: 3 } },
  };
  return Object.values({ ...defaults, ...over }).filter((e): e is Raw => Boolean(e));
}

function manifest(entries: Raw[], key: SigningKey = KEY): ContinuityManifest {
  const chained = chainEntries(entries);
  return signManifest(
    {
      version: CONTINUITY_MANIFEST_VERSION,
      resident: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
      counts: {
        identity: 0,
        memory: 0,
        role: 0,
        model: 0,
        job: 0,
        session: 0,
        transcript: 0,
        audit: 0,
      },
      entries: chained.entries,
      root: chained.root,
    },
    key,
  );
}

function probes(over: Partial<ProbeSnapshot> = {}): ProbeSnapshot {
  return {
    takenAt: "2026-01-01T00:00:00.000Z",
    health: { pid: 100 },
    sessions: [],
    jobs: [],
    devices: [{ fingerprint: "dev-1", scope: "attach", status: "active" }],
    recall: [
      { query: "a", expect: "A", hit: true },
      { query: "b", expect: "B", hit: true },
      { query: "c", expect: "C", hit: true },
      { query: "d", expect: "D", hit: true },
      { query: "e", expect: "E", hit: true },
    ],
    chat: { ok: true, model: "alpha", marker: "CM-1", text: "model=alpha; marker=CM-1; echo=hi" },
    audit: { ok: true, entries: 3, lastSeq: 3, headHash: "h3" },
    authEnforced: true,
    role: {},
    ...over,
  };
}

function outcome(over: Partial<DisruptionOutcome> = {}): DisruptionOutcome {
  return {
    disruption: "restart",
    applied: true,
    detail: "restarted",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    expectedMarker: "CM-1",
    ...over,
  };
}

const cleanLeak = { scanned: 10, leaked: false, where: [] as string[] };

function happyAfter() {
  return probes({
    health: { pid: 200 },
    jobs: [
      {
        id: "job-1",
        status: "failed",
        kind: "agent",
        sessionKey: "agent:alice:continuity-job",
        error: "interrupted: gateway restarted",
      },
    ],
    audit: { ok: true, entries: 5, lastSeq: 5, headHash: "h5" },
    auditAnchor: { seq: 3, hash: "h3" },
  });
}

function statuses(results: ReturnType<typeof scoreRun>): Record<string, string> {
  return Object.fromEntries(results.map((r) => [r.id, r.status]));
}

describe("continuity scorer", () => {
  test("a clean restart passes every invariant", () => {
    const before = manifest(baseEntries());
    const after = manifest(
      baseEntries({ probeTranscript: { kind: "transcript", name: "p-1.jsonl", sha256: "pt-2" } }),
    );
    const results = scoreRun({
      disruption: "restart",
      before: { manifest: before, probes: probes() },
      after: { manifest: after, probes: happyAfter() },
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    });
    expect(results.map((r) => r.id)).toEqual(INVARIANTS.map((i) => i.id));
    expect(results.every((r) => r.status === "pass")).toBe(true);
    expect(summarize(results)).toEqual({ pass: 10, fail: 0, skip: 0 });
  });

  test("C1 fails when an identity file changes; C2 when memory is lost or recall drops", () => {
    const before = manifest(baseEntries());
    const identityChanged = manifest(
      baseEntries({ soul: { kind: "identity", name: "SOUL.md", sha256: "soul-2" } }),
    );
    const r1 = statuses(
      scoreRun({
        disruption: "restart",
        before: { manifest: before, probes: probes() },
        after: { manifest: identityChanged, probes: happyAfter() },
        outcome: outcome({ unfinishedJobId: "job-1" }),
        leakScan: cleanLeak,
      }),
    );
    expect(r1.C1).toBe("fail");
    expect(r1.C2).toBe("pass");

    const memoryGone = manifest(baseEntries({ memory: undefined }));
    const r2 = statuses(
      scoreRun({
        disruption: "restart",
        before: { manifest: before, probes: probes() },
        after: { manifest: memoryGone, probes: happyAfter() },
        outcome: outcome({ unfinishedJobId: "job-1" }),
        leakScan: cleanLeak,
      }),
    );
    expect(r2.C2).toBe("fail");

    const recallDropped = happyAfter();
    recallDropped.recall = recallDropped.recall.map((r, i) => ({ ...r, hit: i < 2 }));
    const r3 = scoreRun({
      disruption: "restart",
      before: { manifest: before, probes: probes() },
      after: { manifest: manifest(baseEntries()), probes: recallDropped },
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    });
    expect(r3.find((r) => r.id === "C2")).toMatchObject({ status: "fail" });
    expect(r3.find((r) => r.id === "C2")?.detail).toContain("40%");
  });

  test("C3 fails on a role change, a device change or an unenforced credential", () => {
    const before = manifest(baseEntries());
    const roleChanged = manifest(
      baseEntries({ role: { kind: "role", name: "agent", value: { tools: {} } } }),
    );
    const base = {
      disruption: "restart" as const,
      before: { manifest: before, probes: probes() },
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    };
    expect(
      statuses(scoreRun({ ...base, after: { manifest: roleChanged, probes: happyAfter() } })).C3,
    ).toBe("fail");
    const devices = happyAfter();
    devices.devices = [];
    expect(
      statuses(scoreRun({ ...base, after: { manifest: manifest(baseEntries()), probes: devices } }))
        .C3,
    ).toBe("fail");
    const open = happyAfter();
    open.authEnforced = false;
    expect(
      statuses(scoreRun({ ...base, after: { manifest: manifest(baseEntries()), probes: open } }))
        .C3,
    ).toBe("fail");
  });

  test("C4: a job still running after a restart fails; one that claims success fails; none started skips", () => {
    const before = { manifest: manifest(baseEntries()), probes: probes() };
    const stuck = happyAfter();
    stuck.jobs = [{ id: "job-1", status: "running", kind: "agent", sessionKey: "s" }];
    const base = { disruption: "restart" as const, before, leakScan: cleanLeak };
    expect(
      statuses(
        scoreRun({
          ...base,
          after: { manifest: manifest(baseEntries()), probes: stuck },
          outcome: outcome({ unfinishedJobId: "job-1" }),
        }),
      ).C4,
    ).toBe("fail");
    const lying = happyAfter();
    lying.jobs = [{ id: "job-1", status: "succeeded", kind: "agent", sessionKey: "s" }];
    expect(
      statuses(
        scoreRun({
          ...base,
          after: { manifest: manifest(baseEntries()), probes: lying },
          outcome: outcome({ unfinishedJobId: "job-1" }),
        }),
      ).C4,
    ).toBe("fail");
    expect(
      statuses(
        scoreRun({
          ...base,
          after: { manifest: manifest(baseEntries()), probes: happyAfter() },
          outcome: outcome(),
        }),
      ).C4,
    ).toBe("skip");
    // Across a model swap the job may simply finish.
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "model-swap",
          after: {
            manifest: manifest(
              baseEntries({
                model: {
                  kind: "model",
                  name: "primary",
                  value: { provider: "fake", model: "beta" },
                },
              }),
            ),
            probes: { ...lying, chat: { ok: true, model: "beta", marker: "CM-1" } },
          },
          outcome: outcome({
            disruption: "model-swap",
            unfinishedJobId: "job-1",
            modelBefore: "fake/alpha",
            modelAfter: "fake/beta",
          }),
        }),
      ).C4,
    ).toBe("pass");
  });

  test("C5 fails when the chain shrinks, breaks, or the old head is not an ancestor", () => {
    const before = { manifest: manifest(baseEntries()), probes: probes() };
    const base = {
      disruption: "restart" as const,
      before,
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    };
    const broken = happyAfter();
    broken.audit = { ok: false, entries: 5, lastSeq: 5 };
    expect(
      statuses(scoreRun({ ...base, after: { manifest: manifest(baseEntries()), probes: broken } }))
        .C5,
    ).toBe("fail");
    const shrunk = happyAfter();
    shrunk.audit = { ok: true, entries: 1, lastSeq: 1, headHash: "h1" };
    expect(
      statuses(scoreRun({ ...base, after: { manifest: manifest(baseEntries()), probes: shrunk } }))
        .C5,
    ).toBe("fail");
    const forked = happyAfter();
    forked.auditAnchor = { seq: 3, hash: "different" };
    expect(
      statuses(scoreRun({ ...base, after: { manifest: manifest(baseEntries()), probes: forked } }))
        .C5,
    ).toBe("fail");
  });

  test("C6 fails on a leak; C7 fails on a different signer", () => {
    const before = { manifest: manifest(baseEntries()), probes: probes() };
    const base = {
      disruption: "restart" as const,
      before,
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    };
    expect(
      statuses(
        scoreRun({
          ...base,
          after: { manifest: manifest(baseEntries()), probes: happyAfter() },
          leakScan: { scanned: 3, leaked: true, where: ["GET /x: owner credential"] },
        }),
      ).C6,
    ).toBe("fail");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const other: SigningKey = {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    expect(
      statuses(
        scoreRun({
          ...base,
          after: { manifest: manifest(baseEntries(), other), probes: happyAfter() },
        }),
      ).C7,
    ).toBe("fail");
  });

  test("C8: a lost transcript fails; a closed session must change; untouched sessions must not", () => {
    const before = { manifest: manifest(baseEntries()), probes: probes() };
    const base = {
      disruption: "restart" as const,
      before,
      outcome: outcome({ unfinishedJobId: "job-1" }),
      leakScan: cleanLeak,
    };
    const lost = manifest(baseEntries({ transcript: undefined }));
    expect(
      statuses(scoreRun({ ...base, after: { manifest: lost, probes: happyAfter() } })).C8,
    ).toBe("fail");
    const mainMoved = manifest(
      baseEntries({
        session: { kind: "session", name: "agent:alice:main", value: { sessionId: "main-2" } },
      }),
    );
    expect(
      statuses(scoreRun({ ...base, after: { manifest: mainMoved, probes: happyAfter() } })).C8,
    ).toBe("fail");
    const closeOutcome = outcome({
      disruption: "close",
      closedSessionKey: "agent:alice:continuity-probe",
    });
    const notClosed = manifest(baseEntries());
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "close",
          outcome: closeOutcome,
          after: { manifest: notClosed, probes: happyAfter() },
        }),
      ).C8,
    ).toBe("fail");
    const closed = manifest(
      baseEntries({
        probe: {
          kind: "session",
          name: "agent:alice:continuity-probe",
          value: { sessionId: "p-2" },
        },
      }),
    );
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "close",
          outcome: closeOutcome,
          after: { manifest: closed, probes: happyAfter() },
        }),
      ).C8,
    ).toBe("pass");
  });

  test("C9: wrong marker, unchanged model after a swap, or no answer fails; no chat probe skips", () => {
    const before = { manifest: manifest(baseEntries()), probes: probes() };
    const base = { before, outcome: outcome({ unfinishedJobId: "job-1" }), leakScan: cleanLeak };
    const stranger = happyAfter();
    stranger.chat = { ok: true, model: "alpha", marker: "CM-9", text: "" };
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "restart",
          after: { manifest: manifest(baseEntries()), probes: stranger },
        }),
      ).C9,
    ).toBe("fail");
    const silent = happyAfter();
    silent.chat = { ok: false, error: "HTTP 500" };
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "restart",
          after: { manifest: manifest(baseEntries()), probes: silent },
        }),
      ).C9,
    ).toBe("fail");
    const sameModel = happyAfter();
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "model-swap",
          outcome: outcome({
            disruption: "model-swap",
            unfinishedJobId: "job-1",
            modelAfter: "fake/beta",
          }),
          after: { manifest: manifest(baseEntries()), probes: sameModel },
        }),
      ).C9,
    ).toBe("fail");
    const noChat = happyAfter();
    noChat.chat = undefined;
    const quiet = probes({ chat: undefined });
    expect(
      statuses(
        scoreRun({
          ...base,
          disruption: "restart",
          before: { manifest: before.manifest, probes: quiet },
          after: { manifest: manifest(baseEntries()), probes: noChat },
        }),
      ).C9,
    ).toBe("skip");
  });

  test("C0 fails when the disruption did not apply", () => {
    const r = scoreRun({
      disruption: "move",
      before: { manifest: manifest(baseEntries()), probes: probes() },
      after: { manifest: manifest(baseEntries()), probes: happyAfter() },
      outcome: outcome({ disruption: "move", applied: false, detail: "failed: no permission" }),
      leakScan: cleanLeak,
    });
    expect(r[0]).toMatchObject({ id: "C0", status: "fail" });
  });
});
