// End-to-end (KoLo 2.0, M12d): a throwaway gateway (built dist/entry.js) with the deterministic
// provider runs one chat turn; the job's evidence is read through the API, exported as a bundle,
// verified offline, tampered with and refused, and checked once more through the CLI.
// `pnpm evidence:check` runs this file; it needs no network and no model credentials.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EvidenceEvent, EvidenceManifest, EvidenceSummary } from "./types.js";
import { ProbeClient, waitFor } from "../continuity-suite/client.js";
import { startFakeProvider } from "../continuity-suite/fake-provider.js";
import { chatTurn } from "../continuity-suite/probes.js";
import { resolveGatewayEntry, ThrowawayGateway } from "../continuity-suite/throwaway.js";
import { EVENTS_FILE, MANIFEST_FILE } from "./store.js";
import { verifyEvidenceBundle } from "./verify.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasDist = (() => {
  try {
    resolveGatewayEntry();
    return true;
  } catch {
    return false;
  }
})();

type JobRow = { id: string; status: string; agent: string; sessionKey: string };

describe.skipIf(!hasDist)("evidence end to end", () => {
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let gw: ThrowawayGateway;
  let client: ProbeClient;
  let jobId = "";
  let summary: EvidenceSummary;
  let manifest: EvidenceManifest;

  beforeAll(async () => {
    provider = await startFakeProvider();
    const home =
      process.env.KOLO_SMOKE_HOME?.trim() ||
      fs.mkdtempSync(path.join(os.tmpdir(), "kolo-evid-e2e-"));
    const port = process.env.KOLO_SMOKE_PORT
      ? Number.parseInt(process.env.KOLO_SMOKE_PORT, 10)
      : undefined;
    gw = await ThrowawayGateway.create({ home, port, providerBaseUrl: provider.baseUrl });
    await gw.start();
    client = new ProbeClient(gw.baseUrl, gw.token);
  }, 120_000);

  afterAll(async () => {
    await gw?.destroy();
    await provider?.close();
  });

  test(
    "a chat turn records a signed evidence log readable through the API",
    { timeout: 120_000 },
    async () => {
      const chat = await chatTurn(client, gw.agentId, "Evidence probe: say hello");
      expect(chat.ok, chat.error).toBe(true);
      const job = await waitFor(
        async () => {
          const res = await client.get<{ jobs?: JobRow[] }>("/api/jobs?limit=20");
          const found = (res.body.jobs ?? []).find(
            (j) => j.agent === gw.agentId && !["queued", "running"].includes(j.status),
          );
          return found ?? false;
        },
        { timeoutMs: 60_000, intervalMs: 500, what: "the chat job to finish" },
      );
      jobId = job.id;
      expect(job.status).toBe("succeeded");

      const ev = await client.get<{
        ok: boolean;
        summary: EvidenceSummary;
        manifest: EvidenceManifest | null;
      }>(`/api/jobs/${encodeURIComponent(jobId)}/evidence`);
      expect(ev.status).toBe(200);
      expect(ev.body.ok).toBe(true);
      summary = ev.body.summary;
      expect(summary).toMatchObject({
        jobId,
        agent: gw.agentId,
        status: "succeeded",
        signed: true,
      });
      expect(summary.modelTurns).toBeGreaterThanOrEqual(1);
      expect(summary.promptDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(ev.body.manifest).not.toBeNull();
      manifest = ev.body.manifest!;
      expect(manifest.signer.alg).toBe("ed25519");
      expect(manifest.events.count).toBe(summary.events);

      const page = await client.get<{
        events: EvidenceEvent[];
        next: number | null;
        total: number;
      }>(`/api/jobs/${encodeURIComponent(jobId)}/evidence/events?from=1&limit=2`);
      expect(page.body.events.map((e) => e.seq)).toEqual([1, 2]);
      expect(page.body.events[0].type).toBe("job.start");
      expect(page.body.events[0].data.prompt).toBeUndefined();
      expect(page.body.next).toBe(3);
      const rest = await client.get<{ events: EvidenceEvent[]; next: number | null }>(
        `/api/jobs/${encodeURIComponent(jobId)}/evidence/events?from=${page.body.next}&limit=500`,
      );
      expect(rest.body.next).toBeNull();
      const all = [...page.body.events, ...rest.body.events];
      expect(all.at(-1)?.type).toBe("job.end");
      expect(all.at(-1)?.data.status).toBe("succeeded");
      expect(all.at(-1)?.hash).toBe(manifest.events.root);
      expect(JSON.stringify(all)).not.toContain(gw.token);

      // The evidence key is the continuity key: one identity signs both proofs.
      const cont = await client.get<{ manifest?: { signer: { keyId: string } } }>(
        `/api/continuity/manifest?agent=${gw.agentId}`,
      );
      expect(cont.body.manifest?.signer.keyId).toBe(manifest.signer.keyId);
    },
  );

  test(
    "the HTML view needs a credential and renders the timeline",
    { timeout: 30_000 },
    async () => {
      const anon = await fetch(`${gw.baseUrl}/evidence/${encodeURIComponent(jobId)}`);
      expect(anon.status).toBe(401);
      const page = await fetch(`${gw.baseUrl}/evidence/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${gw.token}` },
      });
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await page.text();
      expect(html).toContain(`Evidence for job <code>${jobId}</code>`);
      expect(html).toContain("job.end");
      expect(html).not.toContain(gw.token);
    },
  );

  test(
    "export through the API verifies offline; a tampered copy does not",
    { timeout: 60_000 },
    async () => {
      const res = await client.post<{
        ok: boolean;
        path: string;
        format: string;
        manifest: EvidenceManifest;
      }>(`/api/jobs/${encodeURIComponent(jobId)}/evidence/export`, { format: "zip" });
      expect(res.status).toBe(200);
      expect(res.body.path.startsWith(path.join(gw.home, "evidence-exports"))).toBe(true);
      expect(res.body.manifest.recorded?.signature).toBe(manifest.signature);
      const verified = await verifyEvidenceBundle(res.body.path);
      expect(verified.problems).toEqual([]);
      expect(verified.ok).toBe(true);
      expect(verified.recordedOk).toBe(true);

      const dir = await client.post<{ path: string }>(
        `/api/jobs/${encodeURIComponent(jobId)}/evidence/export`,
        { format: "dir" },
      );
      const events = path.join(dir.body.path, EVENTS_FILE);
      const lines = fs.readFileSync(events, "utf8").trimEnd().split("\n");
      const end = JSON.parse(lines[lines.length - 1]) as EvidenceEvent;
      end.data.status = "failed";
      lines[lines.length - 1] = JSON.stringify(end);
      fs.writeFileSync(events, `${lines.join("\n")}\n`);
      const tampered = await verifyEvidenceBundle(dir.body.path);
      expect(tampered.ok).toBe(false);
      expect(tampered.chainOk).toBe(false);
      expect(tampered.filesOk).toBe(false);
      expect(fs.existsSync(path.join(dir.body.path, MANIFEST_FILE))).toBe(true);
    },
  );

  test(
    "the CLI lists, exports, verifies and replays without the gateway",
    { timeout: 60_000 },
    async () => {
      const env = { ...gw.env(), NO_COLOR: "1" };
      const kolo = (...args: string[]) =>
        spawnSync(process.execPath, [path.join(ROOT, "kolo.mjs"), ...args], {
          env,
          encoding: "utf8",
        });
      const list = kolo("evidence", "list", "--json");
      expect(list.status, list.stderr).toBe(0);
      expect(
        (JSON.parse(list.stdout) as { jobs: Array<{ jobId: string }> }).jobs.map((j) => j.jobId),
      ).toContain(jobId);
      const out = path.join(gw.home, "cli-bundle.zip");
      const exp = kolo("evidence", "export", jobId, "--out", out);
      expect(exp.status, exp.stderr).toBe(0);
      expect(exp.stdout).toContain("verify with");
      const ver = kolo("evidence", "verify", out);
      expect(ver.status, ver.stderr + ver.stdout).toBe(0);
      expect(ver.stdout).toContain("verdict      PASS");
      const replay = kolo("evidence", "replay", out, "--step", "1", "--json");
      expect(replay.status, replay.stderr).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({ step: 1, total: summary.events });
      const show = kolo("evidence", "show", jobId);
      expect(show.status).toBe(0);
      expect(show.stdout).toContain("signed       yes");
    },
  );
});
