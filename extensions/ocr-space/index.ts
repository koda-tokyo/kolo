import type { KoLoPluginApi } from "KoLo/plugin-sdk";
/**
 * OCR.space plugin for Kurahi.
 *
 * Provides `ocr_extract` tool — extract text from images and PDFs.
 * Free tier: 25,000 requests/month, max 1MB file.
 * Config: `apiKey` in plugin config or `OCR_SPACE_API_KEY` env var.
 */
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

async function ocrFromUrl(imageUrl: string, apiKey: string, language = "eng"): Promise<string> {
  const body = new URLSearchParams({
    apikey: apiKey,
    url: imageUrl,
    language,
    isOverlayRequired: "false",
    OCREngine: "2",
  });

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`OCR.space error: ${res.status}`);
  return parseOcrResponse(await res.json());
}

async function ocrFromFile(filePath: string, apiKey: string, language = "eng"): Promise<string> {
  const fileData = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  const mime = mimeMap[ext] ?? "application/octet-stream";
  const base64 = `data:${mime};base64,${fileData.toString("base64")}`;

  const body = new URLSearchParams({
    apikey: apiKey,
    base64Image: base64,
    language,
    isOverlayRequired: "false",
    OCREngine: "2",
    filetype: ext.replace(".", "").toUpperCase(),
  });

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`OCR.space error: ${res.status}`);
  return parseOcrResponse(await res.json());
}

function parseOcrResponse(data: unknown): string {
  const d = data as {
    ParsedResults?: Array<{ ParsedText?: string; ErrorMessage?: string }>;
    ErrorMessage?: string[];
    IsErroredOnProcessing?: boolean;
  };

  if (d.IsErroredOnProcessing) {
    throw new Error(d.ErrorMessage?.join("; ") ?? "OCR processing error");
  }

  const texts = (d.ParsedResults ?? []).map((r) => r.ParsedText?.trim()).filter(Boolean);

  return texts.length > 0 ? texts.join("\n\n---\n\n") : "No text extracted.";
}

const ocrSpacePlugin = {
  id: "ocr-space",
  name: "OCR.space",
  description: "Extract text from images and PDFs — 25,000 free requests/month",
  kind: null,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: { apiKey: { type: "string" as const } },
  },

  register(api: KoLoPluginApi) {
    api.registerTool(
      {
        name: "ocr_extract",
        label: "OCR",
        description:
          "Extract text from images (PNG, JPG, BMP, TIFF, GIF) or PDFs. " +
          "Provide a file path or URL. Supports 25+ languages. " +
          'Examples: "/path/to/document.pdf", "https://example.com/image.png".',
        parameters: Type.Object({
          input: Type.String({ description: "File path or URL of the image/PDF to OCR" }),
          language: Type.Optional(
            Type.String({
              description:
                'OCR language: "eng" (default), "jpn", "por", "ara", "chi_sim", "fre", "ger", "spa"',
            }),
          ),
        }),

        async execute(_toolId: string, params: Record<string, unknown>) {
          const apiKey =
            (api.pluginConfig?.apiKey as string | undefined) ?? process.env.OCR_SPACE_API_KEY;

          if (!apiKey) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "OCR.space not configured. Set apiKey in plugin config or OCR_SPACE_API_KEY env var.\nGet a free key at: https://ocr.space/ocrapi",
                },
              ],
            };
          }

          const input = typeof params.input === "string" ? params.input.trim() : "";
          if (!input) return { content: [{ type: "text" as const, text: "No input provided." }] };

          const language = typeof params.language === "string" ? params.language.trim() : "eng";

          try {
            const isUrl = input.startsWith("http://") || input.startsWith("https://");
            const text = isUrl
              ? await ocrFromUrl(input, apiKey, language)
              : await ocrFromFile(input, apiKey, language);

            return {
              content: [{ type: "text" as const, text: `## OCR Result\n\n${text}` }],
              details: { input: isUrl ? input : basename(input), language, source: "ocr.space" },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: `OCR error: ${message}` }] };
          }
        },
      },
      { names: ["ocr_extract"] },
    );

    api.registerCli(
      ({ program }) => {
        program
          .command("ocr <input>")
          .description("Extract text from image or PDF via OCR.space")
          .option("-l, --language <lang>", "OCR language (eng, jpn, por, ara)", "eng")
          .action(async (input: string, opts: { language: string }) => {
            const apiKey =
              (api.pluginConfig?.apiKey as string | undefined) ?? process.env.OCR_SPACE_API_KEY;
            if (!apiKey) {
              console.error("Set OCR_SPACE_API_KEY env var.");
              process.exitCode = 1;
              return;
            }
            try {
              const isUrl = input.startsWith("http");
              const text = isUrl
                ? await ocrFromUrl(input, apiKey, opts.language)
                : await ocrFromFile(input, apiKey, opts.language);
              console.log(text);
            } catch (err) {
              console.error(String(err));
              process.exitCode = 1;
            }
          });
      },
      { commands: ["ocr"] },
    );
  },
};

export default ocrSpacePlugin;
