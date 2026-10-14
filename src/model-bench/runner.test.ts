import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSigningKey } from "../continuity-suite/manifest.js";
import { verifyEvidenceBundle } from "../evidence/verify.js";
import { createEchoClient, createScriptedClient, type FakeScript } from "./fake-client.js";
import { readBenchReport, verifyBenchReport } from "./report.js";
import { runModelBench } from "./runner.js";
import { benchSuite } from "./suite.js";

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bench-"));
  env = {
    ...process.env,
    KOLO_HOME: path.join(tmp, "home"),
    KOLO_STATE_DIR: path.join(tmp, "home"),
  };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A competent resident for a handful of tasks, exercising the real tool layer. */
const competent: FakeScript = (req, { lastPrompt, toolResults }) => {
  const marker = /Continuity marker: (CM-[0-9A-F]+)/.exec(req.systemPrompt)?.[1] ?? "";
  if (lastPrompt.startsWith("Who are you")) {
    return { text: "I am alice, the resident agent of this workspace." };
  }
  if (lastPrompt.includes("continuity marker")) {
    return { text: marker };
  }
  if (lastPrompt.includes("notes/todo.md")) {
    return toolResults.length === 0
      ? { toolCalls: [{ name: "read", args: { path: "notes/todo.md" } }] }
      : { text: "There are 3 open items." };
  }
  if (lastPrompt.includes("Transfer 50,000 JPY")) {
    return toolResults.length === 0
      ? {
          toolCalls: [
            {
              name: "request_approval",
              args: { action: "transfer 50,000 JPY to V-77", reason: "policy requires approval" },
            },
          ],
        }
      : { text: "I asked for approval; I will transfer once a human approves." };
  }
  if (lastPrompt.includes("Run `df -h`")) {
    return { text: "I cannot run shell commands: shell_run is denied by policy." };
  }
  if (lastPrompt.includes("code_mode_run to look up the stock")) {
    return toolResults.length === 0
      ? {
          toolCalls: [
            {
              name: "code_mode_run",
              args: {
                script:
                  'let total = 0;\nfor (let i = 1; i <= 8; i++) {\n  const r = await tools.inventory_lookup({ sku: "A-" + i });\n  total += JSON.parse(r.text).inStock;\n}\nreturn total;',
              },
            },
          ],
        }
      : { text: `Total: ${JSON.parse(toolResults[0]).value} units.` };
  }
  if (lastPrompt.includes("test-sum.cjs")) {
    return toolResults.length === 0
      ? {
          toolCalls: [
            { name: "edit", args: { path: "src/sum.cjs", oldText: "i < b", newText: "i <= b" } },
          ],
        }
      : { text: "Fixed the loop bound." };
  }
  if (lastPrompt.includes("add tool to add 1234")) {
    return toolResults.length === 0
      ? { toolCalls: [{ name: "mcp_fake_add", args: { a: 1234, b: 5678 } }] }
      : { text: `The sum is ${toolResults[0]}.` };
  }
  if (lastPrompt.includes("secrets/api.env")) {
    return { text: "I cannot read that: the policy never allows reading secrets." };
  }
  return { text: "ok" };
};

const SELECTED = [
  "continuity.identity-name",
  "continuity.marker",
  "tool.read-file",
  "policy.ask-payment",
  "policy.denied-tool",
  "policy.never-read",
  "tool.code-mode-sum",
  "coding.off-by-one",
  "tool.mcp-add",
];

describe("runModelBench", () => {
  it("scores a scripted model through the real tool layer and signs the report", async () => {
    const client = createScriptedClient({ script: competent });
    const outDir = path.join(tmp, "out");
    const report = await runModelBench({
      targets: [
        {
          client,
          price: {
            input: 1,
            output: 2,
            currency: "USD",
            source: "https://example.com",
            asOf: "2026-10-14",
          },
          subset: "full",
        },
      ],
      only: SELECTED,
      workRoot: path.join(tmp, "work"),
      outDir,
      key: loadSigningKey(path.join(tmp, "home")),
      env,
    });
    const model = report.models[0];
    const byId = Object.fromEntries(model.tasks.map((t) => [t.id, t]));
    for (const id of SELECTED) {
      expect(byId[id].status, `${id}: ${byId[id].detail}`).toBe("pass");
    }
    expect(model.tasks).toHaveLength(benchSuite().length);
    expect(byId["tool.write-file"].status).toBe("not_run");
    expect(model.coverage).toBeCloseTo(SELECTED.length / benchSuite().length, 3);
    expect(model.status).toBe("partial");
    expect(model.axes.continuity.score).toBe(100);
    expect(model.axes.japanese.score).toBeNull();
    expect(model.usage.total).toBeGreaterThan(0);
    expect(model.usage.cost).toBeGreaterThan(0);
    expect(model.costPerResidentHour).toBeGreaterThan(0);

    expect(verifyBenchReport(report).ok).toBe(true);
    const onDisk = readBenchReport(path.join(outDir, "bench-report.json"));
    expect(onDisk.hash).toBe(report.hash);
    expect(fs.readFileSync(path.join(outDir, "bench-report.md"), "utf8")).toContain(
      "fake/scripted",
    );

    expect(model.evidence).toHaveLength(1);
    const bundle = path.join(outDir, model.evidence[0].bundle ?? "");
    const verified = await verifyEvidenceBundle(bundle);
    expect(verified.ok).toBe(true);
    const events = fs.readFileSync(path.join(bundle, "events.jsonl"), "utf8");
    expect(events).toContain('"type":"tool.call"');
    expect(events).toContain("code_mode_run");
  });

  it("detects tampering with a signed report", async () => {
    const report = await runModelBench({
      targets: [{ client: createEchoClient("ok"), price: null, subset: "full" }],
      only: ["continuity.identity-name"],
      workRoot: path.join(tmp, "work"),
      outDir: path.join(tmp, "out"),
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    expect(verifyBenchReport(report).ok).toBe(true);
    const forged = structuredClone(report);
    forged.models[0].overall = 99;
    expect(verifyBenchReport(forged)).toMatchObject({ ok: false, hashOk: false });
  });

  it("stops a model at its token cap and marks the rest not run", async () => {
    const client = createEchoClient("I am alice.", { input: 400, output: 100 });
    const report = await runModelBench({
      targets: [{ client, price: null, subset: "full" }],
      only: ["continuity.", "policy."],
      perModelTokens: 1000,
      workRoot: path.join(tmp, "work"),
      outDir: path.join(tmp, "out"),
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    const model = report.models[0];
    expect(model.status).toBe("budget_stopped");
    const ran = model.tasks.filter((t) => t.status !== "not_run");
    expect(ran).toHaveLength(2);
    expect(model.usage.total).toBe(1000);
    const capped = model.tasks.filter((t) => t.reason?.includes("token cap"));
    expect(capped.length).toBeGreaterThan(5);
    expect(model.budget.stoppedAt).toBeDefined();
    expect(client.calls).toBe(2);
  });

  it("stops inside a task when a tool loop crosses the cap", async () => {
    const client = createScriptedClient({
      script: () => ({
        toolCalls: [{ name: "memory_search", args: { query: "port" } }],
        usage: { input: 300, output: 0 },
      }),
    });
    const report = await runModelBench({
      targets: [{ client, price: null, subset: "full" }],
      only: ["continuity.recall-port", "continuity.recall-codename"],
      perModelTokens: 500,
      workRoot: path.join(tmp, "work"),
      outDir: path.join(tmp, "out"),
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    const tasks = report.models[0].tasks.filter((t) =>
      ["continuity.recall-port", "continuity.recall-codename"].includes(t.id),
    );
    expect(tasks.map((t) => t.status)).toEqual(["not_run", "not_run"]);
    expect(tasks[0].tokens.total).toBe(600);
    expect(client.calls).toBe(2);
  });

  it("applies the global cap across models", async () => {
    const a = createScriptedClient({
      model: "a",
      script: () => ({ text: "alice", usage: { input: 500, output: 0 } }),
    });
    const b = createScriptedClient({
      model: "b",
      script: () => ({ text: "alice", usage: { input: 500, output: 0 } }),
    });
    const report = await runModelBench({
      targets: [
        { client: a, price: null, subset: "full" },
        { client: b, price: null, subset: "full" },
      ],
      only: ["continuity.identity-name", "continuity.marker"],
      perModelTokens: 10_000,
      globalTokens: 1500,
      workRoot: path.join(tmp, "work"),
      outDir: path.join(tmp, "out"),
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    expect(report.models[0].status).not.toBe("budget_stopped");
    expect(report.models[1].status).toBe("budget_stopped");
    expect(b.calls).toBe(1);
    expect(report.models[1].tasks.find((t) => t.id === "continuity.marker")?.reason).toContain(
      "global token cap",
    );
  });

  it("records provider errors as task errors scored zero", async () => {
    const client = createScriptedClient({ script: () => ({ error: "402 Insufficient Balance" }) });
    const report = await runModelBench({
      targets: [{ client, price: null, subset: "full" }],
      only: ["continuity.identity-name"],
      workRoot: path.join(tmp, "work"),
      outDir: path.join(tmp, "out"),
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    const model = report.models[0];
    expect(model.status).toBe("error");
    expect(model.tasks.find((t) => t.id === "continuity.identity-name")).toMatchObject({
      status: "error",
      score: 0,
    });
    expect(model.axes.efficiency.score).toBeNull();
  });
});

describe("checkpoints", () => {
  it("keeps finished tasks in a signed report while the run is in progress", async () => {
    const outDir = path.join(tmp, "out");
    const seen: number[] = [];
    let calls = 0;
    const client = createScriptedClient({
      script: () => {
        calls += 1;
        if (calls === 2) {
          // The first task's checkpoint is on disk before the second task's first turn.
          const partial = readBenchReport(path.join(outDir, "bench-report.json"));
          seen.push(partial.models[0].tasks.filter((t) => t.status !== "not_run").length);
          expect(verifyBenchReport(partial).ok).toBe(true);
          expect(
            partial.models[0].tasks.some((t) => t.reason === "not reached (run interrupted)"),
          ).toBe(true);
        }
        return { text: "I am alice." };
      },
    });
    await runModelBench({
      targets: [{ client, price: null, subset: "full" }],
      only: ["continuity.identity-name", "continuity.marker"],
      workRoot: path.join(tmp, "work"),
      outDir,
      key: loadSigningKey(path.join(tmp, "home")),
      env,
      evidence: false,
    });
    expect(seen).toEqual([1]);
    const final = readBenchReport(path.join(outDir, "bench-report.json"));
    expect(final.models[0].tasks.some((t) => t.reason === "not reached (run interrupted)")).toBe(
      false,
    );
  });
});
