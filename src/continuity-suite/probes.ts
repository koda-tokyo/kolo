// Scripted probes (KoLo 2.0, M11b). Everything here goes through the public gateway API with
// the owner credential: health, sessions, jobs, paired devices, memory recall, one chat turn and
// the audit chain. The same probes run before and after a disruption; the scorer compares them.
import type { ProbeClient } from "./client.js";
import type { ContinuityManifest, FactProbe, FactResult, ProbeSnapshot } from "./types.js";
import { waitFor } from "./client.js";
import { MARKER_RE } from "./fake-provider.js";

export const PROBE_SESSION_SUFFIX = "continuity-probe";
export const JOB_SESSION_SUFFIX = "continuity-job";

export function probeSessionKey(agentId: string): string {
  return `agent:${agentId}:${PROBE_SESSION_SUFFIX}`;
}

export function jobSessionKey(agentId: string): string {
  return `agent:${agentId}:${JOB_SESSION_SUFFIX}`;
}

const ANSWER_MODEL_RE = /model=([^;]+);/;
const ANSWER_MARKER_RE = /marker=([^;]+);/;

export async function fetchManifest(
  client: ProbeClient,
  agentId: string,
): Promise<ContinuityManifest> {
  const res = await client.get<{ ok: boolean; manifest?: ContinuityManifest; error?: string }>(
    `/api/continuity/manifest?agent=${encodeURIComponent(agentId)}`,
  );
  if (res.status !== 200 || !res.body.manifest) {
    throw new Error(`getContinuityManifest: HTTP ${res.status} ${res.body.error ?? ""}`.trim());
  }
  return res.body.manifest;
}

export async function recallFacts(
  client: ProbeClient,
  agentId: string,
  facts: FactProbe[],
): Promise<FactResult[]> {
  const out: FactResult[] = [];
  for (const fact of facts) {
    const res = await client.get<{ backend?: string; hits?: Array<{ snippet: string }> }>(
      `/api/memory/recall?agent=${encodeURIComponent(agentId)}&q=${encodeURIComponent(fact.query)}&limit=5`,
    );
    const needle = fact.expect.toLowerCase();
    const hit =
      res.status === 200 &&
      (res.body.hits ?? []).some((h) => h.snippet.toLowerCase().includes(needle));
    out.push({ ...fact, hit, backend: res.body.backend });
  }
  return out;
}

/** One non-streaming chat turn through the chat-completions route, in a dedicated session. */
export async function chatTurn(
  client: ProbeClient,
  agentId: string,
  message: string,
  opts: { sessionKey?: string; timeoutMs?: number } = {},
): Promise<NonNullable<ProbeSnapshot["chat"]>> {
  try {
    const res = await client.post<{
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    }>(
      "/v1/chat/completions",
      { model: `agent:${agentId}`, messages: [{ role: "user", content: message }], stream: false },
      {
        headers: {
          "x-kolo-agent-id": agentId,
          "x-kolo-session-key": opts.sessionKey ?? probeSessionKey(agentId),
        },
        timeoutMs: opts.timeoutMs ?? 60_000,
      },
    );
    if (res.status !== 200) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.body.error?.message ?? res.text.slice(0, 200)}`,
      };
    }
    const text = res.body.choices?.[0]?.message?.content ?? "";
    return {
      ok: true,
      text,
      model: ANSWER_MODEL_RE.exec(text)?.[1]?.trim(),
      marker: ANSWER_MARKER_RE.exec(text)?.[1]?.trim() ?? MARKER_RE.exec(text)?.[1],
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type SnapshotOptions = {
  facts: FactProbe[];
  /** Audit seq of the previous snapshot's head, to anchor the chain continuity check. */
  anchorSeq?: number;
  /** Skip the chat turn (attached mode without a deterministic provider). */
  chat?: boolean;
  chatMessage?: string;
};

export async function takeSnapshot(
  client: ProbeClient,
  agentId: string,
  opts: SnapshotOptions,
): Promise<ProbeSnapshot> {
  const health = await client.get<{
    pid?: number;
    version?: string;
    status?: string;
    readiness?: string;
  }>("/health");
  const sessions = await client.get<{
    sessions?: Array<{ key: string; id: string; agent: string; label?: string; state?: string }>;
  }>(`/api/sessions?agent=${encodeURIComponent(agentId)}&limit=500`);
  const jobs = await client.get<{
    jobs?: Array<{ id: string; status: string; kind: string; sessionKey: string; error?: string }>;
  }>(`/api/jobs?agent=${encodeURIComponent(agentId)}&limit=500`);
  const devices = await client.get<{
    devices?: Array<{ fingerprint: string; scope: string; status: string }>;
  }>("/api/pair/devices");
  const recall = await recallFacts(client, agentId, opts.facts);
  const chat =
    opts.chat === false
      ? undefined
      : await chatTurn(client, agentId, opts.chatMessage ?? "Who are you?");
  // The wrong-token probe is audited (401), so it runs before the chain is read: the chain
  // then always has a head to anchor the next snapshot on.
  const denied = await client.get("/api/jobs", { token: `${client.token.slice(0, 8)}-wrong` });
  await new Promise((r) => setTimeout(r, 300));
  const auditPath = opts.anchorSeq ? `/api/audit/chain?seq=${opts.anchorSeq}` : "/api/audit/chain";
  const audit = await client.get<{
    verified?: boolean;
    entries?: number;
    lastSeq?: number;
    head?: { seq: number; hash: string } | null;
    anchor?: { seq: number; hash: string } | null;
  }>(auditPath);
  const deviceRows = (devices.body.devices ?? [])
    .map((d) => ({ fingerprint: d.fingerprint, scope: d.scope, status: d.status }))
    .toSorted((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return {
    takenAt: new Date().toISOString(),
    health: {
      pid: health.body.pid,
      version: health.body.version,
      status: health.body.status,
      readiness: health.body.readiness,
    },
    sessions: (sessions.body.sessions ?? [])
      .map((s) => ({ key: s.key, id: s.id, agent: s.agent, label: s.label, state: s.state }))
      .toSorted((a, b) => a.key.localeCompare(b.key)),
    jobs: (jobs.body.jobs ?? []).map((j) => ({
      id: j.id,
      status: j.status,
      kind: j.kind,
      sessionKey: j.sessionKey,
      error: j.error,
    })),
    devices: deviceRows,
    recall,
    chat,
    audit: {
      ok: audit.status === 200 && audit.body.verified === true,
      entries: audit.body.entries ?? 0,
      lastSeq: audit.body.lastSeq ?? 0,
      headHash: audit.body.head?.hash,
    },
    auditAnchor: opts.anchorSeq ? (audit.body.anchor ?? null) : undefined,
    authEnforced: denied.status === 401,
    role: { devices: deviceRows },
  };
}

/**
 * Starts a slow chat turn in its own session and returns once the gateway lists its job as
 * running. The HTTP request is left in flight on purpose; `abort()` releases it afterwards.
 */
export async function startUnfinishedJob(
  client: ProbeClient,
  agentId: string,
  opts: { slowMs?: number; timeoutMs?: number } = {},
): Promise<{ jobId: string; sessionKey: string; abort: () => void; done: Promise<void> }> {
  const sessionKey = jobSessionKey(agentId);
  const controller = new AbortController();
  const slowMs = opts.slowMs ?? 20_000;
  const done = fetch(`${client.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.token}`,
      "content-type": "application/json",
      "x-kolo-agent-id": agentId,
      "x-kolo-session-key": sessionKey,
    },
    body: JSON.stringify({
      model: `agent:${agentId}`,
      messages: [{ role: "user", content: `[slow:${slowMs}] keep working` }],
      stream: true,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      await res.text().catch(() => "");
    })
    .catch(() => {});
  const jobId = await waitFor(
    async () => {
      const res = await client.get<{
        jobs?: Array<{ id: string; status: string; sessionKey: string }>;
      }>(`/api/jobs?agent=${encodeURIComponent(agentId)}&limit=50`);
      const job = (res.body.jobs ?? []).find(
        (j) => j.sessionKey === sessionKey && j.status === "running",
      );
      return job?.id;
    },
    { timeoutMs: opts.timeoutMs ?? 30_000, intervalMs: 500, what: "unfinished job to start" },
  );
  return { jobId, sessionKey, abort: () => controller.abort(), done };
}
