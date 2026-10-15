import type { KoLoPluginApi } from "KoLo/plugin-sdk";
/**
 * LocationIQ plugin for Kurahi.
 *
 * Provides `geocode` tool — forward/reverse geocoding.
 * Free tier: 5,000 requests/day (~150K/month).
 * Config: `apiKey` in plugin config or `LOCATIONIQ_API_KEY` env var.
 */
import { Type } from "@sinclair/typebox";

interface GeoLocation {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    road?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}

async function forwardGeocode(query: string, apiKey: string): Promise<GeoLocation[]> {
  const url = `https://us1.locationiq.com/v1/search?key=${apiKey}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`LocationIQ error: ${res.status}`);
  return res.json() as Promise<GeoLocation[]>;
}

async function reverseGeocode(lat: number, lon: number, apiKey: string): Promise<GeoLocation> {
  const url = `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`LocationIQ error: ${res.status}`);
  return res.json() as Promise<GeoLocation>;
}

function formatLocation(loc: GeoLocation): string {
  const lines = [`**${loc.display_name}**`];
  lines.push(`**Coordinates:** ${loc.lat}, ${loc.lon}`);
  if (loc.address) {
    const a = loc.address;
    const parts = [a.road, a.city, a.state, a.country, a.postcode].filter(Boolean);
    if (parts.length) lines.push(`**Address:** ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

const locationiqPlugin = {
  id: "locationiq",
  name: "LocationIQ",
  description: "Geocoding and location data — 5,000 free requests/day",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiKey: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "geocode",
        label: "Geocode",
        description:
          "Convert addresses to coordinates (forward) or coordinates to addresses (reverse). " +
          '5,000 free requests/day. Examples: "Banyan Tree Dubai JLT", "25.0657,55.1713".',
        parameters: Type.Object({
          query: Type.String({
            description: "Address/place name for forward geocoding, or 'lat,lon' for reverse",
          }),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ?? process.env.LOCATIONIQ_API_KEY;

          if (!apiKey) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "LocationIQ not configured. Set apiKey in plugin config or LOCATIONIQ_API_KEY env var.\nGet a free key at: https://locationiq.com/",
                },
              ],
            };
          }

          const query = typeof params.query === "string" ? params.query.trim() : "";
          if (!query) return { content: [{ type: "text" as const, text: "No query provided." }] };

          try {
            // Detect reverse geocoding (lat,lon format)
            const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
            if (coordMatch) {
              const loc = await reverseGeocode(
                Number(coordMatch[1]),
                Number(coordMatch[2]),
                apiKey,
              );
              return {
                content: [{ type: "text" as const, text: formatLocation(loc) }],
                details: { type: "reverse", lat: loc.lat, lon: loc.lon, source: "locationiq" },
              };
            }

            const results = await forwardGeocode(query, apiKey);
            if (results.length === 0) {
              return { content: [{ type: "text" as const, text: `No results for: "${query}"` }] };
            }

            const text = results.map(formatLocation).join("\n\n---\n\n");
            return {
              content: [{ type: "text" as const, text }],
              details: { type: "forward", query, count: results.length, source: "locationiq" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Geocode error: ${message}` }] };
          }
        },
      },
      { names: ["geocode"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("geocode <query...>")
          .description("Geocode an address or reverse-geocode coordinates")
          .action(async (parts: string[]) => {
            const query = parts.join(" ");
            const apiKey =
              (api.pluginConfig?.apiKey as string | undefined) ?? process.env.LOCATIONIQ_API_KEY;
            if (!apiKey) {
              console.error("Set LOCATIONIQ_API_KEY env var.");
              process.exitCode = 1;
              return;
            }
            try {
              const results = await forwardGeocode(query, apiKey);
              for (const r of results) console.log(formatLocation(r) + "\n");
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["geocode"] },
    );
  },
};

export default locationiqPlugin;
