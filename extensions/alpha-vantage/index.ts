/**
 * Alpha Vantage financial data plugin for KoLo.
 *
 * Provides `finance_query` tool for stocks, forex, crypto, commodities.
 * Free tier: 25 requests/day.
 * Config: `apiKey` in plugin config or `ALPHA_VANTAGE_API_KEY` env var.
 */
import { Type } from "@sinclair/typebox";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

const BASE = "https://www.alphavantage.co/query";

async function fetchAV(params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function getStockQuote(symbol: string, apiKey: string): Promise<string> {
  const data = await fetchAV({ function: "GLOBAL_QUOTE", symbol }, apiKey);
  const q = data["Global Quote"] as Record<string, string> | undefined;
  if (!q || !q["05. price"]) return `No quote found for "${symbol}"`;

  return [
    `**${q["01. symbol"]}** — ${q["02. open"]} → **${q["05. price"]}**`,
    `**Change:** ${q["09. change"]} (${q["10. change percent"]})`,
    `**High/Low:** ${q["03. high"]} / ${q["04. low"]}`,
    `**Volume:** ${Number(q["06. volume"]).toLocaleString()}`,
    `**Latest:** ${q["07. latest trading day"]}`,
  ].join("\n");
}

async function getForexRate(from: string, to: string, apiKey: string): Promise<string> {
  const data = await fetchAV({
    function: "CURRENCY_EXCHANGE_RATE",
    from_currency: from.toUpperCase(),
    to_currency: to.toUpperCase(),
  }, apiKey);

  const r = data["Realtime Currency Exchange Rate"] as Record<string, string> | undefined;
  if (!r) return `No exchange rate found for ${from}→${to}`;

  return [
    `**${r["1. From_Currency Code"]}/${r["3. To_Currency Code"]}:** ${r["5. Exchange Rate"]}`,
    `**Bid/Ask:** ${r["8. Bid Price"]} / ${r["9. Ask Price"]}`,
    `**Updated:** ${r["6. Last Refreshed"]} ${r["7. Time Zone"]}`,
  ].join("\n");
}

async function getCryptoRate(symbol: string, market: string, apiKey: string): Promise<string> {
  const data = await fetchAV({
    function: "CURRENCY_EXCHANGE_RATE",
    from_currency: symbol.toUpperCase(),
    to_currency: market.toUpperCase(),
  }, apiKey);

  const r = data["Realtime Currency Exchange Rate"] as Record<string, string> | undefined;
  if (!r) return `No crypto data found for ${symbol}`;

  return [
    `**${r["2. From_Currency Name"]}:** ${r["5. Exchange Rate"]} ${r["3. To_Currency Code"]}`,
    `**Bid/Ask:** ${r["8. Bid Price"]} / ${r["9. Ask Price"]}`,
    `**Updated:** ${r["6. Last Refreshed"]}`,
  ].join("\n");
}

const alphaVantagePlugin = {
  id: "alpha-vantage",
  name: "Alpha Vantage Finance",
  description: "Stock quotes, forex rates, crypto prices — 25 free calls/day",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiKey: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "finance_query",
        label: "Finance Data",
        description:
          "Get stock quotes, forex exchange rates, or crypto prices. " +
          'Examples: "stock AAPL", "forex USD/JPY", "crypto BTC".',
        parameters: Type.Object({
          type: Type.Union([
            Type.Literal("stock"),
            Type.Literal("forex"),
            Type.Literal("crypto"),
          ], { description: 'Query type: "stock", "forex", or "crypto"' }),
          symbol: Type.String({ description: "Stock ticker (AAPL), currency pair (USD/JPY), or crypto symbol (BTC)" }),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ??
            process.env.ALPHA_VANTAGE_API_KEY;

          if (!apiKey) {
            return {
              content: [{
                type: "text" as const,
                text: "Alpha Vantage not configured. Set apiKey in plugin config or ALPHA_VANTAGE_API_KEY env var.\nGet a free key at: https://www.alphavantage.co/support/#api-key",
              }],
            };
          }

          const type = params.type as string;
          const symbol = (params.symbol as string || "").trim().toUpperCase();
          if (!symbol) return { content: [{ type: "text" as const, text: "No symbol provided." }] };

          try {
            let result: string;
            if (type === "forex") {
              const [from, to] = symbol.includes("/") ? symbol.split("/") : [symbol.slice(0, 3), symbol.slice(3) || "USD"];
              result = await getForexRate(from, to, apiKey);
            } else if (type === "crypto") {
              result = await getCryptoRate(symbol, "USD", apiKey);
            } else {
              result = await getStockQuote(symbol, apiKey);
            }

            return {
              content: [{ type: "text" as const, text: result }],
              details: { type, symbol, source: "alpha-vantage" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Finance error: ${message}` }] };
          }
        },
      },
      { names: ["finance_query"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("finance <type> <symbol>")
          .description("Get financial data (stock AAPL, forex USD/JPY, crypto BTC)")
          .action(async (type: string, symbol: string) => {
            const apiKey = (api.pluginConfig?.apiKey as string | undefined) ?? process.env.ALPHA_VANTAGE_API_KEY;
            if (!apiKey) { console.error("Set ALPHA_VANTAGE_API_KEY env var."); process.exitCode = 1; return; }
            try {
              let result: string;
              const sym = symbol.toUpperCase();
              if (type === "forex") {
                const [from, to] = sym.includes("/") ? sym.split("/") : [sym.slice(0, 3), sym.slice(3) || "USD"];
                result = await getForexRate(from, to, apiKey);
              } else if (type === "crypto") {
                result = await getCryptoRate(sym, "USD", apiKey);
              } else {
                result = await getStockQuote(sym, apiKey);
              }
              console.log(result);
            } catch (err) { console.error(String(err)); process.exitCode = 1; }
          });
      },
      { commands: ["finance"] },
    );
  },
};

export default alphaVantagePlugin;
