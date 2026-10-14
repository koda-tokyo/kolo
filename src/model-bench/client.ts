// Model clients for the bench. The real client goes through the same provider adapter the agent
// runtime uses (`complete` with the OpenAI-compatible adapter), so tool schemas, tool calls and
// usage are what a resident would see. Keys are passed in memory only and never logged.
import {
  type AssistantMessage,
  complete,
  type Message,
  type Model,
  type Tool,
} from "@mariozechner/pi-ai";
import {
  type ProviderRegistryEntry,
  getProvider,
  registryBaseUrlForConfig,
} from "../providers/registry.js";

export type BenchTurnRequest = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  signal?: AbortSignal;
};

export type BenchModelClient = {
  provider: string;
  model: string;
  complete: (req: BenchTurnRequest) => Promise<AssistantMessage>;
};

export class BenchUnsupportedError extends Error {}

export type PiAiClientOptions = {
  entry: ProviderRegistryEntry;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** Per model turn. */
  timeoutMs: number;
  maxTokens?: number;
};

/** Only OpenAI-compatible surfaces (hosted and local) are benchmarked in phase 1. */
export function benchSupportsProvider(entry: ProviderRegistryEntry): boolean {
  return entry.apiStyle === "openai-compatible" || entry.apiStyle === "ollama";
}

export function createPiAiClient(opts: PiAiClientOptions): BenchModelClient {
  if (!benchSupportsProvider(opts.entry)) {
    throw new BenchUnsupportedError(
      `provider "${opts.entry.id}" uses the ${opts.entry.apiStyle} API style; the bench covers OpenAI-compatible endpoints only`,
    );
  }
  const baseUrl = registryBaseUrlForConfig(opts.entry, opts.baseUrl);
  if (!baseUrl) {
    throw new BenchUnsupportedError(`provider "${opts.entry.id}" needs a base URL`);
  }
  const model: Model<"openai-completions"> = {
    id: opts.model,
    name: opts.model,
    api: "openai-completions",
    provider: opts.entry.id,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: opts.maxTokens ?? 2048,
  };
  const apiKey = opts.apiKey ?? (opts.entry.apiStyle === "ollama" ? "ollama-local" : undefined);
  return {
    provider: opts.entry.id,
    model: opts.model,
    complete: async (req) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      timer.unref?.();
      try {
        return await complete(
          model,
          { systemPrompt: req.systemPrompt, messages: req.messages, tools: req.tools },
          {
            apiKey,
            maxTokens: opts.maxTokens ?? 2048,
            temperature: 0,
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** `provider/model` → registry entry and model id; the model part may contain slashes. */
export function parseBenchModelRef(ref: string): { entry: ProviderRegistryEntry; model: string } {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    throw new Error(`expected provider/model, got "${ref}"`);
  }
  const providerId = ref.slice(0, idx);
  const entry = getProvider(providerId);
  if (!entry) {
    throw new Error(`unknown provider id "${providerId}"`);
  }
  return { entry, model: ref.slice(idx + 1) };
}
