import type { KoLoPluginApi } from "KoLo/plugin-sdk";
/**
 * Brave Search plugin for Kurahi.
 *
 * Provides `web_search` tool for all agents.
 * Free tier: 2,000 queries/month.
 * Config: set `apiKey` in plugin config or `BRAVE_SEARCH_API_KEY` env var.
 */
import { Type } from "@sinclair/typebox";

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

async function braveSearch(query: string, apiKey: string, count = 5): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Brave Search error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}

const braveSearchPlugin = {
  id: "brave-search",
  name: "Brave Search",
  description: "Web search — 2,000 free queries/month",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiKey: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "web_search",
        label: "Brave Search",
        description:
          "Search the web for current information. Returns top results with titles, URLs, and descriptions. " +
          'Examples: "latest AI news", "Dubai real estate market 2026", "NLNG Nigeria".',
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          count: Type.Optional(Type.Number({ description: "Number of results (1-10, default 5)" })),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ?? process.env.BRAVE_SEARCH_API_KEY;

          if (!apiKey) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Brave Search not configured. Set apiKey in plugin config or BRAVE_SEARCH_API_KEY env var.\nGet a free key at: https://brave.com/search/api/",
                },
              ],
            };
          }

          const query = typeof params.query === "string" ? params.query.trim() : "";
          if (!query) return { content: [{ type: "text" as const, text: "No query provided." }] };

          const count = Math.min(10, Math.max(1, Number(params.count) || 5));

          try {
            const results = await braveSearch(query, apiKey, count);
            if (results.length === 0) {
              return { content: [{ type: "text" as const, text: `No results for: "${query}"` }] };
            }

            const text = results
              .map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.description}`)
              .join("\n\n");

            return {
              content: [{ type: "text" as const, text }],
              details: { query, count: results.length, source: "brave-search" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Search error: ${message}` }] };
          }
        },
      },
      { names: ["web_search"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("search <query...>")
          .description("Search the web via Brave Search")
          .option("-n, --count <n>", "Number of results", "5")
          .action(async (parts: string[], opts: { count?: string }) => {
            const query = parts.join(" ");
            const apiKey =
              (api.pluginConfig?.apiKey as string | undefined) ?? process.env.BRAVE_SEARCH_API_KEY;
            if (!apiKey) {
              console.error("Set BRAVE_SEARCH_API_KEY env var.");
              process.exitCode = 1;
              return;
            }
            try {
              const results = await braveSearch(query, apiKey, Number(opts.count) || 5);
              for (const r of results) console.log(`${r.title}\n  ${r.url}\n  ${r.description}\n`);
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["search"] },
    );
  },
};

export default braveSearchPlugin;
