import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Ollama provider", () => {
  it("should not include ollama when no local endpoint or API key is configured", async () => {
    // The host running the tests may itself point at a local Ollama; the case is "nothing configured".
    const saved = {
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
      OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    };
    for (const key of Object.keys(saved)) {
      delete process.env[key];
    }
    try {
      const agentDir = mkdtempSync(join(tmpdir(), "kolo-test-"));
      const { resolveImplicitProviders } = await import("./models-config.providers.js");
      const providers = await resolveImplicitProviders({ agentDir });

      expect(providers?.ollama).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("includes ollama as a local fallback when OLLAMA_HOST is configured", async () => {
    const previousHost = process.env.OLLAMA_HOST;
    const previousVitest = process.env.VITEST;
    const agentDir = mkdtempSync(join(tmpdir(), "kolo-test-"));

    try {
      process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
      process.env.VITEST = "1";
      const { resolveImplicitProviders } = await import("./models-config.providers.js");

      const providers = await resolveImplicitProviders({ agentDir });

      expect(providers?.ollama).toMatchObject({
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "ollama-local",
        authHeader: false,
      });
    } finally {
      if (previousHost === undefined) {
        delete process.env.OLLAMA_HOST;
      } else {
        process.env.OLLAMA_HOST = previousHost;
      }
      if (previousVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previousVitest;
      }
    }
  });

  // Discovery failures are cached for OLLAMA_FAILURE_CACHE_TTL_MS and never warn on stderr
  // (stderr noise made pnpm treat runs as failed), so the second call must not refetch.
  it("caches Ollama discovery failures and stays silent within the cooldown window", async () => {
    const previousHost = process.env.OLLAMA_HOST;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVitest = process.env.VITEST;
    const agentDir = mkdtempSync(join(tmpdir(), "kolo-test-"));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      vi.stubGlobal("fetch", fetchMock);
      const { resolveImplicitProviders } = await import("./models-config.providers.js");

      await resolveImplicitProviders({ agentDir });
      await resolveImplicitProviders({ agentDir });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (previousHost === undefined) {
        delete process.env.OLLAMA_HOST;
      } else {
        process.env.OLLAMA_HOST = previousHost;
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previousVitest;
      }
    }
  });
});
