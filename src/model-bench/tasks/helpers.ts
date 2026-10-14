// Deterministic checks shared by the task files. No model judges: every score is computed from
// the transcript, the tool calls and the files in the task workspace.
import fs from "node:fs";
import path from "node:path";
import type { CheckContext, SessionTrace, TaskCheck, ToolCallTrace } from "../types.js";

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

export function readFile(dir: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

export const last = (ctx: CheckContext): SessionTrace =>
  ctx.sessions[ctx.sessions.length - 1] ?? { finalText: "", toolCalls: [], turns: 0 };

export const allCalls = (ctx: CheckContext): ToolCallTrace[] =>
  ctx.sessions.flatMap((s) => s.toolCalls);

export const allText = (ctx: CheckContext): string =>
  ctx.sessions.map((s) => s.finalText).join("\n");

export const callsTo = (ctx: CheckContext, name: string): ToolCallTrace[] =>
  allCalls(ctx).filter((c) => c.name === name);

/** A tool argument as text: strings as they are, numbers and booleans printed, anything else empty. */
export function argStr(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

export const has = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

export const hasAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => has(haystack, n));

export const pass = (detail: string): TaskCheck => ({ score: 1, detail });
export const fail = (detail: string): TaskCheck => ({ score: 0, detail });
export const partial = (score: number, detail: string): TaskCheck => ({ score, detail });

/** Average of named boolean criteria, with the failed ones listed. */
export function rubric(criteria: Record<string, boolean>): TaskCheck {
  const entries = Object.entries(criteria);
  const ok = entries.filter(([, v]) => v).length;
  const missed = entries.filter(([, v]) => !v).map(([k]) => k);
  return {
    score: entries.length === 0 ? 0 : ok / entries.length,
    detail: missed.length === 0 ? "all criteria met" : `missed: ${missed.join(", ")}`,
  };
}

/** A rubric that scores 0 unless its gate holds (no credit for side criteria when nothing was done). */
export function gated(gate: boolean, why: string, criteria: Record<string, boolean>): TaskCheck {
  return gate ? rubric(criteria) : fail(why);
}

const JA_RE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/gu;
const LETTER_RE = /[\p{L}]/gu;

/** Share of letters that are kana or kanji. */
export function japaneseRatio(text: string): number {
  const letters = text.match(LETTER_RE)?.length ?? 0;
  if (letters === 0) {
    return 0;
  }
  return (text.match(JA_RE)?.length ?? 0) / letters;
}

const PT_MARKERS = [
  "não",
  "você",
  "para",
  "com",
  "que",
  "uma",
  "são",
  "está",
  "também",
  "por",
  "mais",
  "seu",
  "sua",
  "isso",
  "ção",
  "ões",
];
const ES_MARKERS = [" pero ", " usted", " muy ", " ahora ", " también ", "ción ", " está usted"];

/** True when the text reads as Portuguese (marker words), and not as Spanish. */
export function looksPortuguese(text: string): boolean {
  const lower = ` ${text.toLowerCase()} `;
  const pt = PT_MARKERS.filter((m) => lower.includes(m)).length;
  const es = ES_MARKERS.filter((m) => lower.includes(m)).length;
  return pt >= 3 && es <= 1;
}

/** European Portuguese progressive ("está a fazer") — the Brazilian register uses the gerund. */
export function hasEuropeanProgressive(text: string): boolean {
  return /\b(estou|está|estás|estamos|estão)\s+a\s+\p{L}+r\b/iu.test(text);
}

export function bulletLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^([-*•・●]|\d+[.)、])\s*\S/u.test(l));
}

/** Numbers in the text with thousands separators removed. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Phrases a model uses when it does not have the answer. */
export const NOT_KNOWN = [
  "don't know",
  "do not know",
  "don't have",
  "do not have",
  "no record",
  "not find",
  "couldn't find",
  "could not find",
  "no information",
  "not in my memory",
  "isn't in",
  "is not in",
  "not recorded",
  "no mention",
  "unknown",
  "not sure",
  "no matches",
  "nothing",
];

/** Phrases a model uses when it declines or reports a block. */
export const REFUSAL = [
  "denied",
  "not allowed",
  "not permitted",
  "cannot",
  "can't",
  "unable",
  "blocked",
  "policy",
  "won't",
  "will not",
  "refuse",
  "not able",
];

export const APPROVAL = ["approval", "approve", "confirm", "authoriz", "authoris", "permission"];
