// Script preparation (KoLo 2.0, M6): TypeScript → JavaScript by *type stripping* on the host.
// Stripping is a parse, not an evaluation: no code runs here. Node's built-in stripper
// (`node:module` stripTypeScriptTypes, Node ≥ 22.13) is used when present; without it a
// TypeScript script is refused rather than guessed at.
import { createRequire } from "node:module";

type Stripper = (code: string, opts: { mode: "strip" }) => string;

let cachedStripper: Stripper | null | undefined;

function loadStripper(): Stripper | null {
  if (cachedStripper !== undefined) {
    return cachedStripper;
  }
  try {
    const mod = createRequire(import.meta.url)("node:module") as {
      stripTypeScriptTypes?: Stripper;
    };
    cachedStripper =
      typeof mod.stripTypeScriptTypes === "function" ? mod.stripTypeScriptTypes : null;
  } catch {
    cachedStripper = null;
  }
  return cachedStripper;
}

/** Node prints an ExperimentalWarning on the first strip; silence that one line only. */
function stripQuietly(stripper: Stripper, code: string): string {
  const original = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : ((warning as Error)?.message ?? "");
    if (text.includes("stripTypeScriptTypes")) {
      return;
    }
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripper(code, { mode: "strip" });
  } finally {
    process.emitWarning = original;
  }
}

const TS_HINT =
  /(^|[\s;(])(?:interface|type|enum|namespace|declare|abstract|implements|readonly|satisfies)\s|:\s*(?:string|number|boolean|unknown|any|void|never|Promise<|Record<|Array<)|\bas\s+(?:const|unknown|any|string|number)\b|<[A-Z][A-Za-z0-9_]*>\s*\(|\)\s*:\s*[A-Za-z_][\w<>[\],\s|]*\s*(?:=>|\{)/;

export type PreparedScript =
  | { ok: true; code: string; stripped: boolean }
  | { ok: false; error: string };

/** The script is the body of an async arrow: `return`/`await` at the top level are legal. */
export function wrapScript(body: string): string {
  return `(async () => {\n${body}\n})`;
}

/**
 * Returns a runnable JavaScript function expression (see `wrapScript`). `language: "ts"` always
 * strips types; `"js"` never does; when absent the script is stripped when it looks like
 * TypeScript and the stripper exists.
 */
export function prepareScript(script: string, language?: "js" | "ts"): PreparedScript {
  const wrapped = wrapScript(script);
  if (language === "js") {
    return { ok: true, code: wrapped, stripped: false };
  }
  const looksTs = language === "ts" || TS_HINT.test(script);
  if (!looksTs) {
    return { ok: true, code: wrapped, stripped: false };
  }
  const stripper = loadStripper();
  if (!stripper) {
    if (language === "ts") {
      return {
        ok: false,
        error: "TypeScript scripts need Node 22.13+ (stripTypeScriptTypes); send JavaScript",
      };
    }
    return { ok: true, code: wrapped, stripped: false };
  }
  try {
    return { ok: true, code: stripQuietly(stripper, wrapped), stripped: true };
  } catch (err) {
    if (language === "ts") {
      return {
        ok: false,
        error: `TypeScript strip failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // Heuristic said TS but it does not parse as TS: run it as the JavaScript it may be.
    return { ok: true, code: wrapped, stripped: false };
  }
}
