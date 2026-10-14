#!/usr/bin/env node
// Policy conformance gate (KoLo 2.0, M13): a throwaway gateway with the deterministic provider
// and one resident under a signed policy. Proves, end to end, what the engine enforces:
//
//   1. a signed policy loads at boot (status: loaded, attestation signed)
//   2. a chat completion runs under it
//   3. kill --agent refuses the agent's next job; release restores it
//   4. kill --all is refused at the HTTP gate with rule kill.fleet; release restores it
//   5. a provider not in the agent's allow list is refused with its rule id (after hot reload)
//   6. an unsigned edit is refused at boot in enforce mode; re-signing boots again
//   7. the audit log carries policy.kill / policy.release and the decisions with rule ids
//
//   pnpm policy:check          honours KOLO_SMOKE_HOME (must end in ".kolo-test") and KOLO_SMOKE_PORT
//
// No network, no model, no API key. Exits 0 on PASS, 1 otherwise. Needs `pnpm build` first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => path.join(ROOT, "dist", p);

const { ThrowawayGateway } = await import(dist("continuity-suite/throwaway.js"));
const { startFakeProvider, FAKE_PROVIDER_ID } = await import(
  dist("continuity-suite/fake-provider.js")
);
const { addOwner, loadOrCreateOwnerKey, signPolicyFile } = await import(
  dist("policy/attestation.js")
);
const { resolvePolicyLocations } = await import(dist("policy/paths.js"));

const keep = process.argv.includes("--keep");
const home = path.resolve(
  process.env.KOLO_SMOKE_HOME ?? path.join(os.homedir(), ".kolo-policy.kolo-test"),
);
if (!path.basename(home).endsWith(".kolo-test")) {
  console.error(`refusing to use ${home}: KOLO_SMOKE_HOME must end in ".kolo-test"`);
  process.exit(1);
}
const port = process.env.KOLO_SMOKE_PORT
  ? Number.parseInt(process.env.KOLO_SMOKE_PORT, 10)
  : undefined;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) {
    failed = true;
  }
}
let failed = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const basePolicy = (extra = "") => `version: 1
name: policy-check
agents:
  alice:
    providers: ["${FAKE_PROVIDER_ID}"]
    tools:
      deny: [exec]
kill:
  mayFlip: [owner, admin]
requests:
  deny:
    - operations: [runCodeMode]
      scopes: [attach]
${extra}`;

const fake = await startFakeProvider();
let gw;
try {
  gw = await ThrowawayGateway.create({
    home,
    port,
    providerBaseUrl: fake.baseUrl,
    logName: "policy-gateway.log",
  });
  const loc = resolvePolicyLocations({ KOLO_HOME: gw.home });
  fs.mkdirSync(loc.dir, { recursive: true, mode: 0o700 });
  const key = loadOrCreateOwnerKey(loc.ownerKeyPath);
  addOwner(loc.ownersPath, { publicKey: key.publicKey, label: "policy-check" });
  const sign = () =>
    signPolicyFile({ policyPath: loc.policyPath, signaturePath: loc.signaturePath, key });
  fs.writeFileSync(loc.policyPath, basePolicy());
  sign();

  const api = async (method, pathname, body, headers = {}) => {
    const res = await fetch(`${gw.baseUrl}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${gw.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body: json };
  };
  // The OpenAI-compatible endpoint routes to the agent named in x-kolo-agent (default "main").
  const chat = (text) =>
    api(
      "POST",
      "/v1/chat/completions",
      { model: `${FAKE_PROVIDER_ID}/alpha`, messages: [{ role: "user", content: text }] },
      { "x-kolo-agent": gw.agentId },
    );
  const status = async () => (await api("GET", "/api/policy/status")).body.status;
  const waitStatus = async (pred, what) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const s = await status();
      if (pred(s)) {
        return s;
      }
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  // 1. boot under a signed policy
  await gw.start();
  const s1 = await status();
  check(
    "1 signed policy loaded at boot",
    s1?.loaded === true && s1.attestation === "signed" && s1.name === "policy-check",
    `attestation=${s1?.attestation}`,
  );
  const firstSha = s1?.sha256;

  // 2. a turn runs under it
  const c1 = await chat("hello policy");
  const text1 = c1.body?.choices?.[0]?.message?.content ?? "";
  check(
    "2 chat completion under the policy",
    c1.status === 200 && text1.includes("echo=hello policy"),
    `status=${c1.status}`,
  );

  // 3. kill --agent
  const k1 = await api("POST", "/api/policy/kill", { agent: "alice", reason: "drill" });
  check(
    "3a kill --agent answers",
    k1.status === 200 && k1.body.status?.kill?.agents?.alice?.by === "owner",
    `status=${k1.status}`,
  );
  const c2 = await chat("after agent kill");
  const text2 = JSON.stringify(c2.body);
  check(
    "3b agent's next job refused",
    c2.status !== 200 || !text2.includes("echo=after agent kill"),
    `status=${c2.status}`,
  );
  check("3c refusal names the rule", /kill\.agents\[alice\]/.test(text2), text2.slice(0, 120));
  const r1 = await api("POST", "/api/policy/release", { agent: "alice" });
  const c3 = await chat("after release");
  check(
    "3d release restores the agent",
    r1.status === 200 &&
      c3.status === 200 &&
      (c3.body?.choices?.[0]?.message?.content ?? "").includes("echo=after release"),
    `status=${c3.status}`,
  );

  // 4. kill --all at the HTTP gate
  const k2 = await api("POST", "/api/policy/kill", { all: true });
  const c4 = await chat("after fleet kill");
  check(
    "4a fleet kill refused at the HTTP gate",
    k2.status === 200 && c4.status === 403 && c4.body?.error?.rule === "kill.fleet",
    `status=${c4.status} rule=${c4.body?.error?.rule}`,
  );
  const st = await api("GET", "/api/policy/status");
  check(
    "4b status still readable while stopped",
    st.status === 200 && st.body.status?.kill?.fleet?.by === "owner",
  );
  await api("POST", "/api/policy/release", { all: true });
  const c5 = await chat("after fleet release");
  check("4c fleet release restores", c5.status === 200, `status=${c5.status}`);

  // 5. hot reload: provider no longer allowed
  fs.writeFileSync(
    loc.policyPath,
    basePolicy().replace(
      `providers: ["${FAKE_PROVIDER_ID}"]`,
      'providers: ["some-other-provider"]',
    ),
  );
  sign();
  const s5 = await waitStatus((s) => s?.sha256 && s.sha256 !== firstSha, "hot reload");
  check(
    "5a hot reload picked up the re-signed policy",
    s5.attestation === "signed" && s5.sha256 !== firstSha,
  );
  const c6 = await chat("provider denied");
  const text6 = JSON.stringify(c6.body);
  check(
    "5b model request refused with its rule id",
    c6.status !== 200 || !text6.includes("echo=provider denied"),
    `status=${c6.status}`,
  );
  check(
    "5c rule id is agents[alice].providers",
    /agents\[alice\]\.providers/.test(text6),
    text6.slice(0, 120),
  );
  fs.writeFileSync(loc.policyPath, basePolicy());
  sign();
  await waitStatus((s) => s?.sha256 === firstSha, "hot reload back");

  // 6. unsigned edit refused at boot
  await gw.stop();
  fs.writeFileSync(loc.policyPath, basePolicy("# unsigned edit\n"));
  let bootError = "";
  try {
    await gw.start();
    await gw.stop();
  } catch (err) {
    bootError = String(err);
  }
  check(
    "6a unsigned policy refuses the boot (enforce)",
    bootError.includes("exited early") && /policy gate|unsigned/.test(gw.logTail(4000)),
    bootError.slice(0, 80),
  );
  sign();
  await gw.start();
  const s6 = await status();
  check("6b re-signed policy boots again", s6?.loaded === true && s6.attestation === "signed");

  // 7. audit trail
  const auditDir = path.join(gw.home, "audit");
  const lines = fs
    .readdirSync(auditDir)
    .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
    .flatMap((f) => fs.readFileSync(path.join(auditDir, f), "utf8").split("\n").filter(Boolean))
    .map((l) => JSON.parse(l));
  const actions = new Set(lines.map((l) => l.action));
  const killRule = lines.some(
    (l) => l.action === "policy.decision" && l.detail?.rule === "kill.fleet",
  );
  const providerRule = lines.some(
    (l) => l.action === "policy.decision" && l.detail?.rule === "agents[alice].providers",
  );
  check(
    "7 audit log has policy.kill, policy.release, policy.load and decisions with rule ids",
    actions.has("policy.kill") &&
      actions.has("policy.release") &&
      actions.has("policy.load") &&
      killRule &&
      providerRule,
    [...actions].filter((a) => a.startsWith("policy.")).join(","),
  );

  await gw.stop();
} catch (err) {
  failed = true;
  console.error(`policy-check: ${String(err)}`);
  if (gw) {
    console.error(`--- gateway log tail ---\n${gw.logTail(3000)}`);
    await gw.stop().catch(() => {});
  }
} finally {
  await fake.close().catch(() => {});
  if (!keep && gw && !failed) {
    fs.rmSync(gw.home, { recursive: true, force: true });
  }
}

const passed = checks.filter((c) => c.ok).length;
console.log(
  `POLICY ${failed ? "FAIL" : "PASS"} ${passed}/${checks.length} checks${gw && (keep || failed) ? ` (state kept at ${gw.home})` : ""}`,
);
process.exit(failed ? 1 : 0);
