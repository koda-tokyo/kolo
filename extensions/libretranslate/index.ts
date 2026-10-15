import type { KoLoPluginApi } from "KoLo/plugin-sdk";
/**
 * LibreTranslate plugin for Kurahi.
 *
 * Provides `translate` tool — open-source translation.
 * Supports: en, ja, pt, es, fr, it, ar, zh, ko, de, and more.
 * Self-host for unlimited use, or use free instance.
 * Config: `apiUrl` (default libretranslate.com), optional `apiKey`.
 */
import { Type } from "@sinclair/typebox";

const DEFAULT_URL = "https://libretranslate.com";

async function translate(
  text: string,
  source: string,
  target: string,
  apiUrl: string,
  apiKey?: string,
): Promise<string> {
  const body: Record<string, string> = { q: text, source, target };
  if (apiKey) body.api_key = apiKey;

  const res = await fetch(`${apiUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LibreTranslate error: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as { translatedText?: string };
  return data.translatedText ?? "No translation returned.";
}

async function detectLanguage(text: string, apiUrl: string, apiKey?: string): Promise<string> {
  const body: Record<string, string> = { q: text };
  if (apiKey) body.api_key = apiKey;

  const res = await fetch(`${apiUrl}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return "auto";
  const data = (await res.json()) as Array<{ language: string; confidence: number }>;
  return data[0]?.language ?? "auto";
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  pt: "Portuguese",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ar: "Arabic",
  zh: "Chinese",
  ko: "Korean",
  de: "German",
  ru: "Russian",
  nl: "Dutch",
  tr: "Turkish",
  hi: "Hindi",
};

const libreTranslatePlugin = {
  id: "libretranslate",
  name: "LibreTranslate",
  description: "Open-source translation — 30+ languages, self-hostable",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      apiUrl: { type: "string" as const },
      apiKey: { type: "string" as const },
    },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "translate",
        label: "Translate",
        description:
          "Translate text between languages. Auto-detects source language. " +
          "Supports: en, ja, pt, es, fr, it, ar, zh, ko, de, ru, and more. " +
          'Examples: "translate Hello to Japanese", "translate おはよう to English".',
        parameters: Type.Object({
          text: Type.String({ description: "Text to translate" }),
          target: Type.String({
            description: 'Target language code: "en", "ja", "pt", "es", "fr", "it", "ar", "zh"',
          }),
          source: Type.Optional(
            Type.String({ description: "Source language code (auto-detected if omitted)" }),
          ),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiUrl =
            (api.pluginConfig?.apiUrl as string | undefined) ??
            process.env.LIBRETRANSLATE_URL ??
            DEFAULT_URL;
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ?? process.env.LIBRETRANSLATE_API_KEY;

          const text = typeof params.text === "string" ? params.text.trim() : "";
          if (!text) return { content: [{ type: "text" as const, text: "No text provided." }] };

          const target = typeof params.target === "string" ? params.target.trim() : "en";
          let source = typeof params.source === "string" ? params.source.trim() : "";

          try {
            if (!source) source = await detectLanguage(text, apiUrl, apiKey);

            const result = await translate(text, source, target, apiUrl, apiKey);
            const srcName = LANG_NAMES[source] ?? source;
            const tgtName = LANG_NAMES[target] ?? target;

            return {
              content: [
                {
                  type: "text" as const,
                  text: `**${srcName} → ${tgtName}:**\n${result}`,
                },
              ],
              details: { source, target, source: "libretranslate" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `Translation error: ${message}` }] };
          }
        },
      },
      { names: ["translate"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("translate <target> <text...>")
          .description("Translate text (e.g., translate ja Hello world)")
          .option("-s, --source <lang>", "Source language (auto-detected)")
          .action(async (target: string, textParts: string[], opts: { source?: string }) => {
            const text = textParts.join(" ");
            const apiUrl =
              (api.pluginConfig?.apiUrl as string | undefined) ??
              process.env.LIBRETRANSLATE_URL ??
              DEFAULT_URL;
            const apiKey =
              (api.pluginConfig?.apiKey as string | undefined) ??
              process.env.LIBRETRANSLATE_API_KEY;
            try {
              const source = opts.source ?? (await detectLanguage(text, apiUrl, apiKey));
              const result = await translate(text, source, target, apiUrl, apiKey);
              console.log(`${LANG_NAMES[source] ?? source} → ${LANG_NAMES[target] ?? target}:`);
              console.log(result);
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["translate"] },
    );
  },
};

export default libreTranslatePlugin;
