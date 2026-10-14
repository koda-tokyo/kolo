/**
 * Wolfram Alpha plugin for KoLo.
 *
 * Provides a `wolfram_query` tool that all agents can use for:
 * - Mathematical calculations
 * - Unit conversions
 * - Scientific data
 * - Financial calculations
 * - General knowledge
 *
 * Config: set `appId` in plugin config or `WOLFRAM_APP_ID` env var.
 * Free tier: 2,000 queries/month.
 */
import { Type } from "@sinclair/typebox";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

/** Call Wolfram Alpha Short Answers API (fast, simple). */
async function queryWolframShort(query: string, appId: string): Promise<string> {
  const url = `https://api.wolframalpha.com/v1/result?appid=${encodeURIComponent(appId)}&i=${encodeURIComponent(query)}&timeout=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    if (res.status === 501) return `Wolfram Alpha could not interpret: "${query}"`;
    throw new Error(`Wolfram Alpha API error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Call Wolfram Alpha Full Results API (detailed, structured). */
async function queryWolframFull(
  query: string,
  appId: string,
): Promise<string> {
  const url = `https://api.wolframalpha.com/v2/query?input=${encodeURIComponent(query)}&appid=${encodeURIComponent(appId)}&output=json&timeout=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Wolfram Alpha API error: ${res.status}`);

  const data = (await res.json()) as {
    queryresult?: {
      success?: boolean;
      pods?: Array<{
        title?: string;
        subpods?: Array<{ plaintext?: string }>;
      }>;
    };
  };

  const qr = data.queryresult;
  if (!qr?.success || !qr.pods?.length) {
    return `Wolfram Alpha could not solve: "${query}"`;
  }

  const lines: string[] = [];
  for (const pod of qr.pods) {
    const title = pod.title ?? "Result";
    for (const sub of pod.subpods ?? []) {
      if (sub.plaintext) {
        lines.push(`**${title}:** ${sub.plaintext}`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : "No text results available.";
}

const wolframAlphaPlugin = {
  id: "wolfram-alpha",
  name: "Wolfram Alpha",
  description: "Computational knowledge — math, science, data, conversions",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      appId: { type: "string" as const },
    },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "wolfram_query",
        label: "Wolfram Alpha",
        description:
          "Query Wolfram Alpha for calculations, conversions, scientific data, " +
          "statistics, financial info, and general knowledge. " +
          'Examples: "integrate x^2 from 0 to 10", "GDP of Japan", "convert 5 miles to km", ' +
          '"150 lbs in kg", "weather in Dubai".',
        parameters: Type.Object({
          query: Type.String({ description: "The question or calculation" }),
          mode: Type.Optional(
            Type.Union([Type.Literal("short"), Type.Literal("full")], {
              description: 'Response mode: "short" (fast one-liner) or "full" (detailed pods). Default: short.',
            }),
          ),
        }),

        async execute(
          _toolId: string,
          params: Record<string, unknown>,
        ) {
          // Resolve API key: plugin config > env var
          const appId =
            (api.pluginConfig?.appId as string | undefined) ??
            process.env.WOLFRAM_APP_ID;

          if (!appId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Wolfram Alpha not configured. Set appId in plugin config or WOLFRAM_APP_ID env var.\nGet a free key at: https://developer.wolframalpha.com/",
                },
              ],
            };
          }

          const query = typeof params.query === "string" ? params.query.trim() : "";
          if (!query) {
            return {
              content: [{ type: "text" as const, text: "No query provided." }],
            };
          }

          const mode = params.mode === "full" ? "full" : "short";

          try {
            const result =
              mode === "full"
                ? await queryWolframFull(query, appId)
                : await queryWolframShort(query, appId);

            return {
              content: [{ type: "text" as const, text: result }],
              details: { query, mode, source: "wolfram-alpha" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                { type: "text" as const, text: `Wolfram Alpha error: ${message}` },
              ],
            };
          }
        },
      },
      { names: ["wolfram_query"] },
    );

    // CLI command: `KoLo wolfram "what is 2^100"`
    api.registerCli(
      ({ program }) => {
        program
          .command("wolfram <query...>")
          .description("Query Wolfram Alpha from the command line")
          .option("-f, --full", "Full detailed results instead of short answer")
          .action(async (queryParts: string[], opts: { full?: boolean }) => {
            const query = queryParts.join(" ");
            const appId =
              (api.pluginConfig?.appId as string | undefined) ??
              process.env.WOLFRAM_APP_ID;

            if (!appId) {
              console.error("Set appId in wolfram-alpha plugin config or WOLFRAM_APP_ID env var.");
              process.exitCode = 1;
              return;
            }

            try {
              const result = opts.full
                ? await queryWolframFull(query, appId)
                : await queryWolframShort(query, appId);
              console.log(result);
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["wolfram"] },
    );
  },
};

export default wolframAlphaPlugin;
