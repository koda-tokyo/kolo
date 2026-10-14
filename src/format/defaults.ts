import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../config/config.js";
import type { FormatConfig } from "../config/types.format.js";
import { detectOnPath } from "../lsp/defaults.js";

/**
 * Formatters after edits (KoLo 2.0, M10). Each language has candidate commands; the first one
 * found on PATH (and whose root marker, if any, exists above the file) runs after a file-edit
 * tool succeeds. Nothing is bundled or downloaded; an absent command means no formatting.
 */

export const FORMAT_DEFAULT_TIMEOUT_MS = 10_000;
export const FORMAT_DEFAULT_MAX_OUTPUT_CHARS = 2000;

type Candidate = {
  /** argv; `{file}` is replaced by the file path. */
  argv: string[];
  /** Only used when one of these files exists above the edited file. */
  rootMarkers?: string[];
};

type DefaultFormatter = { extensions: string[]; candidates: Candidate[] };

const WEB_CANDIDATES: Candidate[] = [
  { argv: ["biome", "format", "--write", "{file}"], rootMarkers: ["biome.json", "biome.jsonc"] },
  { argv: ["prettier", "--write", "{file}"] },
];

export const FORMAT_DEFAULTS: Record<string, DefaultFormatter> = {
  typescript: { extensions: ["ts", "tsx", "mts", "cts"], candidates: WEB_CANDIDATES },
  javascript: { extensions: ["js", "jsx", "mjs", "cjs"], candidates: WEB_CANDIDATES },
  json: { extensions: ["json", "jsonc"], candidates: WEB_CANDIDATES },
  css: { extensions: ["css", "scss", "less"], candidates: WEB_CANDIDATES },
  markdown: {
    extensions: ["md", "mdx"],
    candidates: [{ argv: ["prettier", "--write", "{file}"] }],
  },
  yaml: {
    extensions: ["yml", "yaml"],
    candidates: [{ argv: ["prettier", "--write", "{file}"] }],
  },
  html: {
    extensions: ["html", "vue", "svelte"],
    candidates: [{ argv: ["prettier", "--write", "{file}"] }],
  },
  python: {
    extensions: ["py", "pyi"],
    candidates: [{ argv: ["ruff", "format", "{file}"] }, { argv: ["black", "-q", "{file}"] }],
  },
  go: { extensions: ["go"], candidates: [{ argv: ["gofmt", "-w", "{file}"] }] },
  rust: {
    extensions: ["rs"],
    candidates: [{ argv: ["rustfmt", "--edition", "2021", "{file}"] }],
  },
};

export type ResolvedFormatter = {
  language: string;
  extensions: string[];
  candidates: Candidate[];
  source: "default" | "config";
};

/** Split a configured command line into argv, honouring single and double quotes. */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || current) {
        out.push(current);
      }
      current = "";
      has = false;
      continue;
    }
    current += ch;
  }
  if (has || current) {
    out.push(current);
  }
  return out;
}

/** User `format.onEdit` merged over the defaults; `false` removes a language. */
export function resolveFormatters(config?: Pick<KoLoConfig, "format">): ResolvedFormatter[] {
  const cfg: FormatConfig | undefined = config?.format;
  if (cfg?.enabled === false) {
    return [];
  }
  const merged = new Map<string, ResolvedFormatter>();
  for (const [language, entry] of Object.entries(FORMAT_DEFAULTS)) {
    merged.set(language, {
      language,
      extensions: [...entry.extensions],
      candidates: entry.candidates,
      source: "default",
    });
  }
  for (const [language, value] of Object.entries(cfg?.onEdit ?? {})) {
    if (value === false) {
      merged.delete(language);
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const argv = splitCommandLine(value.trim());
    if (argv.length === 0) {
      continue;
    }
    if (!argv.includes("{file}")) {
      argv.push("{file}");
    }
    const base = merged.get(language);
    // A language without defaults is matched by its own id as the extension (`format.onEdit.sql`).
    const extensions = base?.extensions ?? [language.toLowerCase()];
    merged.set(language, { language, extensions, candidates: [{ argv }], source: "config" });
  }
  return [...merged.values()];
}

export type FormatterSelection = {
  language: string;
  argv: string[];
  /** Absolute path of the command on PATH. */
  commandPath: string;
};

function hasRootMarker(filePath: string, markers: string[]): boolean {
  let dir = path.dirname(filePath);
  for (;;) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return true;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

/**
 * Pick the formatter for a file: the language whose extensions match, then the first candidate
 * whose command is on PATH and whose root marker (if any) exists. `detect` is injectable for tests.
 */
export function formatterForFile(
  formatters: ResolvedFormatter[],
  filePath: string,
  options: {
    detect?: (command: string) => string | undefined;
    cache?: Map<string, string | undefined>;
  } = {},
): FormatterSelection | undefined {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (!ext) {
    return undefined;
  }
  const formatter = formatters.find((entry) => entry.extensions.includes(ext));
  if (!formatter) {
    return undefined;
  }
  const detect = options.detect ?? detectOnPath;
  const cache = options.cache;
  for (const candidate of formatter.candidates) {
    const command = candidate.argv[0];
    if (!command) {
      continue;
    }
    if (candidate.rootMarkers && !hasRootMarker(filePath, candidate.rootMarkers)) {
      continue;
    }
    let resolved: string | undefined;
    if (cache?.has(command)) {
      resolved = cache.get(command);
    } else {
      resolved = detect(command);
      cache?.set(command, resolved);
    }
    if (!resolved) {
      continue;
    }
    return {
      language: formatter.language,
      argv: candidate.argv.map((arg) => (arg === "{file}" ? filePath : arg)),
      commandPath: resolved,
    };
  }
  return undefined;
}
