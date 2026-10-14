import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { Catalogue } from "../model-bench/catalogue.js";
import { applyKodaTestedProfile, listLocalModels } from "./init-koda-tested.js";

const scores = {
  toolUse: 50,
  policy: 50,
  continuity: 50,
  coding: 50,
  japanese: 50,
  portuguese: 50,
  efficiency: 50,
};
const tested = (
  provider: string,
  model: string,
  overall: number,
  region: "jp" | "eu" | "local",
) => ({
  provider,
  model,
  status: "tested" as const,
  residency: { region, source: "t" },
  scores,
  overall,
  coverage: 1,
  subset: "full" as const,
  costPerResidentHour: null,
  price: null,
  lastBenchmarked: "2026-10-14",
  reportHash: "c".repeat(64),
});

const catalogue: Catalogue = {
  version: 1,
  suite: "x",
  updatedAt: "2026-10-14",
  methodology: "/providers/koda-tested",
  models: [
    tested("mistral", "eu-model", 90, "eu"),
    tested("sakura", "gpt-oss-120b", 80, "jp"),
    tested("ollama", "qwen2.5:7b", 40, "local"),
  ],
};

const emptyStore = { version: 1, profiles: {} } as unknown as AuthProfileStore;
const tags = (names: string[]) =>
  (async () =>
    new Response(
      JSON.stringify({ models: names.map((name) => ({ name })) }),
    )) as unknown as typeof fetch;
const down = (async () => {
  throw new Error("ECONNREFUSED");
}) as unknown as typeof fetch;

describe("kolo init --provider koda-tested", () => {
  it("picks the highest-scoring model whose key is set, and stores the env key", async () => {
    const stored: string[] = [];
    const result = await applyKodaTestedProfile(
      {},
      {},
      {
        store: emptyStore,
        env: { SAKURA_API_KEY: "sk-sakura-test-123456" },
        fetchFn: down,
        catalogue,
        storeKey: (provider) => {
          stored.push(provider);
          return `${provider}:default`;
        },
      },
    );
    expect(result.ref).toBe("sakura/gpt-oss-120b");
    expect(result.config.agents?.defaults?.model?.primary).toBe("sakura/gpt-oss-120b");
    expect(result.config.models?.providers?.sakura?.baseUrl).toContain("sakura");
    expect(JSON.stringify(result.config)).not.toContain("sk-sakura-test");
    expect(stored).toEqual(["sakura"]);
  });

  it("honours the residency preference and local models", async () => {
    const result = await applyKodaTestedProfile(
      {},
      { residency: "local" },
      { store: emptyStore, env: {}, fetchFn: tags(["qwen2.5:7b"]), catalogue },
    );
    expect(result.ref).toBe("ollama/qwen2.5:7b");
    const none = await applyKodaTestedProfile(
      {},
      { residency: "jp" },
      { store: emptyStore, env: {}, fetchFn: down, catalogue },
    );
    expect(none.ref).toBeUndefined();
    expect(none.summary).toContain("residency jp");
  });

  it("lists local models and tolerates a missing server", async () => {
    expect(await listLocalModels(undefined, tags(["a", "b"]))).toEqual(["a", "b"]);
    expect(await listLocalModels("http://127.0.0.1:11434/v1", down)).toEqual([]);
  });
});
