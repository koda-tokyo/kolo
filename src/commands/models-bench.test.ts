import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalogue } from "../model-bench/catalogue.js";
import type { RuntimeEnv } from "../runtime.js";
import { createEchoClient } from "../model-bench/fake-client.js";
import { verifyBenchReport } from "../model-bench/report.js";
import {
  BENCH_EXIT,
  modelsBenchCommand,
  modelsBenchMergeCommand,
  modelsTestedCommand,
} from "./models-bench.js";

function makeRuntime() {
  const logs: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    },
    error: () => {},
    exit: ((code: number) => {
      throw new Error(`exit:${code}`);
    }) as RuntimeEnv["exit"],
  };
  return { runtime, logs };
}

let tmp: string;
let env: NodeJS.ProcessEnv;
const cfg = () => ({});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bench-cli-"));
  env = { KOLO_HOME: tmp, KOLO_STATE_DIR: tmp, PATH: process.env.PATH };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** OpenAI-compatible streaming endpoint that answers every chat with one fixed sentence. */
async function startChatServer(
  reply: string,
): Promise<{ url: string; close: () => Promise<void>; bodies: string[] }> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += String(c)));
    req.on("end", () => {
      bodies.push(body);
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (
        delta: Record<string, unknown>,
        finish: string | null,
        usage?: Record<string, number>,
      ) =>
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
      res.write(chunk({ role: "assistant", content: reply }, null));
      res.write(chunk({}, "stop", { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 }));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    bodies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("kolo models bench", () => {
  it("refuses usage errors with exit 2 and missing keys with exit 4", async () => {
    const { runtime } = makeRuntime();
    await expect(modelsBenchCommand({}, runtime, { env, loadConfig: cfg })).rejects.toMatchObject({
      exitCode: BENCH_EXIT.usage,
    });
    await expect(
      modelsBenchCommand({ model: ["nope/x"] }, runtime, { env, loadConfig: cfg }),
    ).rejects.toMatchObject({ exitCode: BENCH_EXIT.usage });
    await expect(
      modelsBenchCommand({ model: ["anthropic/x"] }, runtime, { env, loadConfig: cfg }),
    ).rejects.toMatchObject({ exitCode: BENCH_EXIT.usage });
    await expect(
      modelsBenchCommand({ model: ["sakura/gpt-oss-120b"], maxTokens: "-1" }, runtime, {
        env,
        loadConfig: cfg,
      }),
    ).rejects.toMatchObject({ exitCode: BENCH_EXIT.usage });
    await expect(
      modelsBenchCommand({ model: ["sakura/gpt-oss-120b"] }, runtime, {
        env,
        loadConfig: cfg,
        agentDir: () => path.join(tmp, "agent"),
      }),
    ).rejects.toMatchObject({ exitCode: BENCH_EXIT.auth });
  });

  it("runs through the real provider adapter against a local endpoint and updates a catalogue", async () => {
    const server = await startChatServer("I am alice, the resident agent.");
    try {
      const { runtime, logs } = makeRuntime();
      const catalogueFile = path.join(tmp, "catalogue.json");
      const empty: Catalogue = {
        version: 1,
        suite: "x",
        updatedAt: "2026-01-01",
        methodology: "/providers/koda-tested",
        models: [],
      };
      fs.writeFileSync(catalogueFile, JSON.stringify(empty));
      const report = await modelsBenchCommand(
        {
          quickModel: ["ollama/bench-model"],
          only: "continuity.identity-name,continuity.recall-port",
          baseUrl: server.url,
          out: path.join(tmp, "out"),
          updateCatalogue: catalogueFile,
        },
        runtime,
        { env, loadConfig: cfg, agentDir: () => path.join(tmp, "agent") },
      );
      expect(verifyBenchReport(report).ok).toBe(true);
      const model = report.models[0];
      expect(model.tasks.find((t) => t.id === "continuity.identity-name")?.status).toBe("pass");
      expect(model.usage.total).toBe(256);
      expect(server.bodies.some((b) => b.includes("memory_search"))).toBe(true);
      expect(fs.existsSync(path.join(tmp, "out", "bench-report.md"))).toBe(true);
      expect(fs.existsSync(path.join(tmp, "out", "work"))).toBe(false);
      expect(logs.join("\n")).toContain("pass    continuity.identity-name");
      const updated = JSON.parse(fs.readFileSync(catalogueFile, "utf8")) as Catalogue;
      expect(updated.models[0]).toMatchObject({
        provider: "ollama",
        model: "bench-model",
        status: "tested",
        reportHash: report.hash,
      });
      expect(updated.models[0].residency.region).toBe("local");
    } finally {
      await server.close();
    }
  });

  it("merges reports from chunked runs", async () => {
    const { runtime } = makeRuntime();
    const run = (only: string, out: string) =>
      modelsBenchCommand(
        { quickModel: ["ollama/m"], only, out: path.join(tmp, out), json: true },
        runtime,
        {
          env,
          loadConfig: cfg,
          agentDir: () => path.join(tmp, "agent"),
          createClient: ({ entry, model }) => ({
            ...createEchoClient("I am alice."),
            provider: entry.id,
            model,
          }),
        },
      );
    await run("continuity.identity-name", "a");
    await run("tool.read-file", "b");
    const merged = modelsBenchMergeCommand(
      [path.join(tmp, "a", "bench-report.json"), path.join(tmp, "b", "bench-report.json")],
      { out: path.join(tmp, "merged") },
      runtime,
      { env },
    );
    expect(merged.mergedFrom).toHaveLength(2);
    expect(merged.models[0].tasks.filter((t) => t.status !== "not_run")).toHaveLength(2);
    expect(() => modelsBenchMergeCommand([], { out: tmp }, runtime, { env })).toThrow(/report/);
  });
});

describe("kolo models tested", () => {
  const catalogue: Catalogue = {
    version: 1,
    suite: "2026.10.1",
    updatedAt: "2026-10-14",
    methodology: "/providers/koda-tested",
    models: [
      {
        provider: "ollama",
        model: "local-a",
        status: "tested",
        residency: { region: "local", source: "t" },
        scores: {
          toolUse: 60,
          policy: 70,
          continuity: 80,
          coding: 40,
          japanese: 30,
          portuguese: 50,
          efficiency: 20,
        },
        overall: 58,
        coverage: 0.35,
        subset: "quick",
        costPerResidentHour: { amount: 0, currency: "USD" },
        price: null,
        lastBenchmarked: "2026-10-14",
        reportHash: "b".repeat(64),
      },
      {
        provider: "sakura",
        model: "jp-b",
        status: "pending",
        residency: { region: "jp", source: "t" },
        scores: null,
        overall: null,
        coverage: null,
        subset: null,
        costPerResidentHour: null,
        price: null,
        lastBenchmarked: null,
        reportHash: null,
      },
    ],
  };

  it("prints a table with pending models and the quick-subset note", () => {
    const { runtime, logs } = makeRuntime();
    modelsTestedCommand({}, runtime, catalogue);
    const out = logs.join("\n");
    expect(out).toContain("ollama/local-a");
    expect(out).toContain("pending");
    expect(out).toContain("58*");
    expect(out).toContain("quick subset");
  });

  it("filters by residency and minimum score", () => {
    const { runtime, logs } = makeRuntime();
    modelsTestedCommand({ residency: "jp", json: true }, runtime, catalogue);
    expect((JSON.parse(logs[0]) as Catalogue).models.map((m) => m.model)).toEqual(["jp-b"]);
    modelsTestedCommand({ minScore: "50", json: true }, runtime, catalogue);
    expect((JSON.parse(logs[1]) as Catalogue).models.map((m) => m.model)).toEqual(["local-a"]);
    modelsTestedCommand({ testedOnly: true, residency: "jp" }, runtime, catalogue);
    expect(logs[2]).toBe("No models match.");
  });

  it("rejects bad filters with exit 2", () => {
    const { runtime } = makeRuntime();
    expect(() => modelsTestedCommand({ residency: "mars" }, runtime, catalogue)).toThrow(
      /residency/,
    );
    expect(() => modelsTestedCommand({ minScore: "200" }, runtime, catalogue)).toThrow(/min-score/);
  });
});
