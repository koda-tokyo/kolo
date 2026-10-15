import type { KoLoPluginApi } from "KoLo/plugin-sdk";
/**
 * Open-Meteo weather plugin for Kurahi.
 *
 * Provides `weather_query` tool — unlimited, NO API key needed.
 * Covers: current weather, forecasts, historical data.
 * Source: https://open-meteo.com/
 */
import { Type } from "@sinclair/typebox";

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
  admin1?: string;
}

async function geocode(location: string): Promise<GeoResult | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

async function getWeather(lat: number, lon: number): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  const data = (await res.json()) as {
    current?: Record<string, number>;
    current_units?: Record<string, string>;
    daily?: Record<string, (number | string)[]>;
    daily_units?: Record<string, string>;
  };

  const c = data.current;
  const cu = data.current_units;
  const d = data.daily;
  if (!c || !cu) return "No weather data available.";

  const weatherCodes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Slight showers",
    81: "Moderate showers",
    82: "Violent showers",
    95: "Thunderstorm",
  };

  const lines: string[] = [];
  const code = c.weather_code as number;
  lines.push(
    `**Now:** ${weatherCodes[code] ?? "Unknown"}, ${c.temperature_2m}${cu.temperature_2m}`,
  );
  lines.push(`**Feels like:** ${c.apparent_temperature}${cu.apparent_temperature}`);
  lines.push(
    `**Humidity:** ${c.relative_humidity_2m}${cu.relative_humidity_2m} | **Wind:** ${c.wind_speed_10m} ${cu.wind_speed_10m}`,
  );

  if (d?.time) {
    lines.push("");
    lines.push("**3-Day Forecast:**");
    for (let i = 0; i < Math.min(3, d.time.length); i++) {
      const dayCode = (d.weather_code as number[])[i];
      const desc = weatherCodes[dayCode] ?? "Unknown";
      lines.push(
        `- ${d.time[i]}: ${desc}, ${(d.temperature_2m_min as number[])[i]}–${(d.temperature_2m_max as number[])[i]}°C, rain: ${(d.precipitation_sum as number[])[i]}mm`,
      );
    }
  }

  return lines.join("\n");
}

const openMeteoPlugin = {
  id: "open-meteo",
  name: "Open-Meteo Weather",
  description: "Free unlimited weather data — current conditions, forecasts, history",
  kind: null,
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "weather_query",
        label: "Weather",
        description:
          "Get current weather and 3-day forecast for any location. " +
          'Examples: "weather in Dubai", "Tokyo forecast", "London weather".',
        parameters: Type.Object({
          location: Type.String({ description: "City name or location" }),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const location = typeof params.location === "string" ? params.location.trim() : "";
          if (!location) {
            return { content: [{ type: "text" as const, text: "No location provided." }] };
          }

          try {
            const geo = await geocode(location);
            if (!geo) {
              return {
                content: [
                  { type: "text" as const, text: `Could not find location: "${location}"` },
                ],
              };
            }

            const label = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
            const weather = await getWeather(geo.latitude, geo.longitude);

            return {
              content: [{ type: "text" as const, text: `## Weather for ${label}\n\n${weather}` }],
              details: {
                location: label,
                lat: geo.latitude,
                lon: geo.longitude,
                source: "open-meteo",
              },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Weather error: ${message}` }] };
          }
        },
      },
      { names: ["weather_query"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("weather <location...>")
          .description("Get weather for any location")
          .action(async (parts: string[]) => {
            const location = parts.join(" ");
            try {
              const geo = await geocode(location);
              if (!geo) {
                console.error(`Could not find: "${location}"`);
                process.exitCode = 1;
                return;
              }
              const label = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
              console.log(`Weather for ${label}\n`);
              console.log(await getWeather(geo.latitude, geo.longitude));
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["weather"] },
    );
  },
};

export default openMeteoPlugin;
