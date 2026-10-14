/**
 * NewsData.io plugin for KoLo.
 *
 * Provides `news_search` tool for structured news from 200K+ sources.
 * Free tier: 200 requests/day.
 * Config: `apiKey` in plugin config or `NEWSDATA_API_KEY` env var.
 */
import { Type } from "@sinclair/typebox";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

interface NewsArticle {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source_id: string;
  country: string[] | null;
  category: string[] | null;
}

async function searchNews(
  query: string,
  apiKey: string,
  opts: { country?: string; category?: string; language?: string } = {},
): Promise<NewsArticle[]> {
  const params = new URLSearchParams({ apikey: apiKey, q: query });
  if (opts.country) params.set("country", opts.country);
  if (opts.category) params.set("category", opts.category);
  params.set("language", opts.language ?? "en");

  const url = `https://newsdata.io/api/1/latest?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`NewsData error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    status?: string;
    results?: NewsArticle[];
  };

  return data.results ?? [];
}

const newsdataPlugin = {
  id: "newsdata",
  name: "NewsData.io",
  description: "News search — 200K+ sources, 200 free requests/day",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiKey: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "news_search",
        label: "News Search",
        description:
          "Search news articles from 200K+ sources worldwide. Filter by country, category, language. " +
          'Examples: "AI regulations", "Japan business", "oil and gas Nigeria".',
        parameters: Type.Object({
          query: Type.String({ description: "News search query" }),
          country: Type.Optional(Type.String({ description: 'Country code: "us", "jp", "ng", "ae", "gb"' })),
          category: Type.Optional(Type.String({ description: 'Category: "business", "technology", "science", "politics", "world"' })),
          language: Type.Optional(Type.String({ description: 'Language code (default "en"). Use "ja" for Japanese, "pt" for Portuguese.' })),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ??
            process.env.NEWSDATA_API_KEY;

          if (!apiKey) {
            return {
              content: [{
                type: "text" as const,
                text: "NewsData not configured. Set apiKey in plugin config or NEWSDATA_API_KEY env var.\nGet a free key at: https://newsdata.io/",
              }],
            };
          }

          const query = typeof params.query === "string" ? params.query.trim() : "";
          if (!query) return { content: [{ type: "text" as const, text: "No query provided." }] };

          try {
            const articles = await searchNews(query, apiKey, {
              country: params.country as string | undefined,
              category: params.category as string | undefined,
              language: params.language as string | undefined,
            });

            if (articles.length === 0) {
              return { content: [{ type: "text" as const, text: `No news found for: "${query}"` }] };
            }

            const text = articles.slice(0, 5).map((a) => {
              const meta = [a.source_id, a.pubDate?.split(" ")[0]].filter(Boolean).join(" | ");
              return `**[${a.title}](${a.link})**\n_${meta}_\n${a.description ?? "No description."}`;
            }).join("\n\n");

            return {
              content: [{ type: "text" as const, text }],
              details: { query, count: articles.length, source: "newsdata.io" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `News error: ${message}` }] };
          }
        },
      },
      { names: ["news_search"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("news <query...>")
          .description("Search news via NewsData.io")
          .option("-c, --country <code>", "Country code (us, jp, ng, ae)")
          .option("--category <cat>", "Category (business, technology, science)")
          .action(async (parts: string[], opts: { country?: string; category?: string }) => {
            const query = parts.join(" ");
            const apiKey = (api.pluginConfig?.apiKey as string | undefined) ?? process.env.NEWSDATA_API_KEY;
            if (!apiKey) { console.error("Set NEWSDATA_API_KEY env var."); process.exitCode = 1; return; }
            try {
              const articles = await searchNews(query, apiKey, opts);
              for (const a of articles.slice(0, 5)) console.log(`${a.title}\n  ${a.link}\n  ${a.pubDate ?? ""}\n`);
            } catch (err) { console.error(String(err)); process.exitCode = 1; }
          });
      },
      { commands: ["news"] },
    );
  },
};

export default newsdataPlugin;
