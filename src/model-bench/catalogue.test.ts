import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSigningKey } from "../continuity-suite/manifest.js";
import {
  type Catalogue,
  filterCatalogue,
  loadCatalogue,
  mergeReport,
  pickBestModel,
  residencyFromRegistry,
  validateCatalogue,
} from "./catalogue.js";
import { createEchoClient, createScriptedClient } from "./fake-client.js";
import { mergeBenchReports } from "./merge.js";
import { verifyBenchReport } from "./report.js";
import { runModelBench } from "./runner.js";

const entry = (over: Partial<Catalogue["models"][number]>): Catalogue["models"][number] => ({
  provider: "sakura",
  model: "m",
  status: "tested",
  residency: { region: "jp", source: "test" },
  scores: {
    toolUse: 50,
    policy: 50,
    continuity: 50,
    coding: 50,
    japanese: 50,
    portuguese: 50,
    efficiency: 50,
  },
  overall: 50,
  coverage: 1,
  subset: "full",
  costPerResidentHour: null,
  price: null,
  lastBenchmarked: "2026-10-14",
  reportHash: "a".repeat(64),
  ...over,
});

const cat = (models: Catalogue["models"]): Catalogue => ({
  version: 1,
  suite: "x",
  updatedAt: "2026-10-14",
  methodology: "/providers/koda-tested",
  models,
});

describe("KODA tested catalogue", () => {
  it("ships a valid catalogue", () => {
    expect(validateCatalogue(loadCatalogue())).toEqual([]);
    expect(loadCatalogue().models.length).toBeGreaterThan(0);
  });

  it("rejects bad entries", () => {
    const issues = validateCatalogue(
      cat([
        entry({ provider: "nope" }),
        entry({ model: "dup" }),
        entry({ model: "dup" }),
        entry({ model: "x", reportHash: null }),
        entry({ model: "y", residency: { region: "mars" as "jp", source: "" } }),
      ]),
    );
    expect(issues.join("\n")).toMatch(/not in the registry/);
    expect(issues.join("\n")).toMatch(/duplicate/);
    expect(issues.join("\n")).toMatch(/sha256/);
    expect(issues.join("\n")).toMatch(/residency/);
  });

  it("derives residency from the registry note", () => {
    expect(residencyFromRegistry("sakura").region).toBe("jp");
    expect(residencyFromRegistry("mistral").region).toBe("eu");
    expect(residencyFromRegistry("deepseek").region).toBe("cn");
    expect(residencyFromRegistry("ollama").region).toBe("local");
    expect(residencyFromRegistry("together").region).toBe("us");
    expect(residencyFromRegistry("openrouter").region).toBe("unknown");
  });

  it("filters and sorts by score", () => {
    const c = cat([
      entry({ model: "a", overall: 40 }),
      entry({ model: "b", overall: 80 }),
      entry({
        provider: "mistral",
        model: "c",
        overall: 90,
        residency: { region: "eu", source: "t" },
      }),
      entry({
        model: "d",
        status: "pending",
        overall: null,
        scores: null,
        reportHash: null,
        lastBenchmarked: null,
      }),
    ]);
    expect(filterCatalogue(c, { residency: "jp" }).map((m) => m.model)).toEqual(["b", "a", "d"]);
    expect(filterCatalogue(c, { minScore: 50 }).map((m) => m.model)).toEqual(["c", "b"]);
    expect(filterCatalogue(c, { status: "pending" }).map((m) => m.model)).toEqual(["d"]);
  });

  it("picks the best model the user can run, honouring residency", () => {
    const c = cat([
      entry({ model: "jp-low", overall: 40 }),
      entry({ model: "jp-high", overall: 70 }),
      entry({
        provider: "mistral",
        model: "eu-top",
        overall: 90,
        residency: { region: "eu", source: "t" },
      }),
    ]);
    expect(pickBestModel({ catalogue: c, available: () => true })?.entry.model).toBe("eu-top");
    expect(
      pickBestModel({ catalogue: c, available: () => true, residency: "jp" })?.entry.model,
    ).toBe("jp-high");
    expect(
      pickBestModel({ catalogue: c, available: (p, m) => p === "sakura" && m === "jp-low" })?.entry
        .model,
    ).toBe("jp-low");
    expect(pickBestModel({ catalogue: c, available: () => false })).toBeNull();
  });

  it("merges a signed report and keeps residency and notes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cat-"));
    try {
      const report = await runModelBench({
        targets: [
          {
            client: createScriptedClient({
              provider: "sakura",
              model: "gpt-oss-120b",
              script: () => ({ text: "I am alice." }),
            }),
            price: null,
            subset: "quick",
          },
        ],
        only: ["continuity.identity-name"],
        workRoot: path.join(tmp, "w"),
        outDir: path.join(tmp, "o"),
        key: loadSigningKey(tmp),
        evidence: false,
      });
      const merged = mergeReport(loadCatalogue(), report);
      const m = merged.models.find((e) => e.provider === "sakura" && e.model === "gpt-oss-120b");
      expect(m).toMatchObject({ status: "tested", reportHash: report.hash, subset: "quick" });
      expect(m?.residency.region).toBe("jp");
      expect(m?.price?.currency).toBe("JPY");
      expect(validateCatalogue(merged)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("mergeBenchReports", () => {
  it("combines chunked runs into one signed report", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-merge-"));
    try {
      const key = loadSigningKey(tmp);
      const run = (only: string[], at: string) =>
        runModelBench({
          targets: [{ client: createEchoClient("I am alice."), price: null, subset: "quick" }],
          only,
          workRoot: path.join(tmp, "w"),
          outDir: path.join(tmp, at.replace(/:/g, "-")),
          key,
          evidence: false,
          now: () => new Date(at),
        });
      const a = await run(["continuity.identity-name"], "2026-10-14T01:00:00Z");
      const b = await run(["continuity.recall-port"], "2026-10-14T02:00:00Z");
      const merged = mergeBenchReports({ reports: [b, a], key, createdAt: "2026-10-14T03:00:00Z" });
      expect(verifyBenchReport(merged).ok).toBe(true);
      expect(merged.mergedFrom).toEqual([a.hash, b.hash]);
      const m = merged.models[0];
      expect(m.tasks.find((t) => t.id === "continuity.identity-name")?.status).toBe("pass");
      expect(m.tasks.find((t) => t.id === "continuity.recall-port")?.status).toBe("fail");
      expect(m.usage.total).toBe(a.models[0].usage.total + b.models[0].usage.total);
      expect(m.subset).toBe("quick");

      const forged = structuredClone(a);
      forged.models[0].overall = 1;
      expect(() => mergeBenchReports({ reports: [forged], key, createdAt: "x" })).toThrow(/hash/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
