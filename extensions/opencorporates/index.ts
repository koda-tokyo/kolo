/**
 * OpenCorporates plugin for KoLo.
 *
 * Provides `company_search` tool — look up companies worldwide.
 * 200M+ companies across 140+ jurisdictions.
 * Free tier: basic lookups without API key. Token for higher limits.
 * Source: https://api.opencorporates.com/
 */
import { Type } from "@sinclair/typebox";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

interface CompanyResult {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  incorporation_date: string | null;
  current_status: string | null;
  registered_address_in_full: string | null;
  opencorporates_url: string;
}

async function searchCompanies(query: string, jurisdiction?: string, apiToken?: string): Promise<CompanyResult[]> {
  const params = new URLSearchParams({ q: query, format: "json" });
  if (jurisdiction) params.set("jurisdiction_code", jurisdiction.toLowerCase());
  if (apiToken) params.set("api_token", apiToken);

  const url = `https://api.opencorporates.com/v0.4/companies/search?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`OpenCorporates error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    results?: {
      companies?: Array<{ company: CompanyResult }>;
    };
  };

  return (data.results?.companies ?? []).map((c) => c.company);
}

async function getCompany(jurisdictionCode: string, companyNumber: string, apiToken?: string): Promise<CompanyResult | null> {
  const params = new URLSearchParams({ format: "json" });
  if (apiToken) params.set("api_token", apiToken);

  const url = `https://api.opencorporates.com/v0.4/companies/${jurisdictionCode.toLowerCase()}/${companyNumber}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;

  const data = (await res.json()) as { results?: { company?: CompanyResult } };
  return data.results?.company ?? null;
}

function formatCompany(c: CompanyResult): string {
  const lines = [`**${c.name}** (${c.company_number})`];
  lines.push(`**Jurisdiction:** ${c.jurisdiction_code.toUpperCase()}`);
  if (c.current_status) lines.push(`**Status:** ${c.current_status}`);
  if (c.incorporation_date) lines.push(`**Incorporated:** ${c.incorporation_date}`);
  if (c.registered_address_in_full) lines.push(`**Address:** ${c.registered_address_in_full}`);
  lines.push(`**Link:** ${c.opencorporates_url}`);
  return lines.join("\n");
}

const opencorporatesPlugin = {
  id: "opencorporates",
  name: "OpenCorporates",
  description: "Company search — 200M+ companies across 140+ jurisdictions",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiToken: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "company_search",
        label: "Company Search",
        description:
          "Search for companies worldwide — names, registration numbers, status, addresses. " +
          '200M+ companies across 140+ countries. Examples: "NLNG Nigeria", "Northfield Global UK", "My Terra SA Switzerland".',
        parameters: Type.Object({
          query: Type.String({ description: "Company name or search terms" }),
          jurisdiction: Type.Optional(
            Type.String({ description: 'Country/jurisdiction code (e.g. "gb", "ng", "ch", "us_de"). Optional.' }),
          ),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiToken =
            (api.pluginConfig?.apiToken as string | undefined) ??
            process.env.OPENCORPORATES_API_TOKEN;

          const query = typeof params.query === "string" ? params.query.trim() : "";
          if (!query) return { content: [{ type: "text" as const, text: "No query provided." }] };

          const jurisdiction = typeof params.jurisdiction === "string" ? params.jurisdiction.trim() : undefined;

          try {
            const results = await searchCompanies(query, jurisdiction, apiToken);
            if (results.length === 0) {
              return { content: [{ type: "text" as const, text: `No companies found for: "${query}"` }] };
            }

            const text = results.slice(0, 5).map(formatCompany).join("\n\n---\n\n");
            return {
              content: [{ type: "text" as const, text }],
              details: { query, jurisdiction, count: results.length, source: "opencorporates" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Company search error: ${message}` }] };
          }
        },
      },
      { names: ["company_search"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("company <query...>")
          .description("Search companies on OpenCorporates")
          .option("-j, --jurisdiction <code>", "Jurisdiction code (gb, ng, ch, us_de)")
          .action(async (parts: string[], opts: { jurisdiction?: string }) => {
            const query = parts.join(" ");
            const apiToken = (api.pluginConfig?.apiToken as string | undefined) ?? process.env.OPENCORPORATES_API_TOKEN;
            try {
              const results = await searchCompanies(query, opts.jurisdiction, apiToken);
              if (results.length === 0) { console.log(`No results for: "${query}"`); return; }
              for (const c of results.slice(0, 5)) { console.log(formatCompany(c) + "\n"); }
            } catch (err) { console.error(String(err)); process.exitCode = 1; }
          });
      },
      { commands: ["company"] },
    );
  },
};

export default opencorporatesPlugin;
