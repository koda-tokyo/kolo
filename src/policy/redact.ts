// Context guard (KoLo 2.0, M13f): personal data in tool results is replaced with stable
// placeholders before the model sees it. The real values stay in a per-session vault inside the
// gateway and are put back only into the arguments of tools the policy names (`restoreTo`), so an
// agent can still act on a record (send the e-mail, update the row) without reading it.
//
//   data:
//     redact:
//       detectors: [email, phone, jp-my-number, br-cpf, br-cnpj, credit-card, jp-postal, ip]
//       fields: ["@personal", "patient_*"]          # JSON keys whose values are masked
//       patterns: [{ name: resident-id, regex: "R-\\d{6}" }]
//       agents: ["care-*"]                          # default: every agent
//       tools: ["*"]  exceptTools: ["memory_*"]     # which tool results are guarded
//       restoreTo: ["message", "mcp:crm/*"]         # tools that receive real values back
//
// Pure apart from the in-memory vault. Images and binary content are left untouched.
import { nameMatches } from "./match.js";

export const BUILTIN_DETECTORS = [
  "email",
  "credit-card",
  "jp-my-number",
  "br-cnpj",
  "br-cpf",
  "phone",
  "jp-postal",
  "ip",
] as const;
export type BuiltinDetector = (typeof BUILTIN_DETECTORS)[number];

/** Detectors used when `detectors` is absent (IP addresses are opt-in: too common in logs). */
export const DEFAULT_DETECTORS: readonly BuiltinDetector[] = BUILTIN_DETECTORS.filter(
  (d) => d !== "ip",
);

/** `@personal` in `fields`: common personal-data keys in English, Japanese and Portuguese. */
export const PERSONAL_FIELDS: readonly string[] = [
  "name",
  "full_name",
  "fullname",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "given_name",
  "family_name",
  "middle_name",
  "*_name",
  "address",
  "*_address",
  "street",
  "birth_date",
  "birthdate",
  "date_of_birth",
  "dob",
  "phone",
  "*_phone",
  "mobile",
  "email",
  "*_email",
  "氏名",
  "名前",
  "姓",
  "名",
  "フリガナ",
  "ふりがな",
  "住所",
  "生年月日",
  "電話番号",
  "nome",
  "nome_completo",
  "sobrenome",
  "endereco",
  "endereço",
  "data_nascimento",
  "data_de_nascimento",
  "telefone",
  "celular",
];

export type RedactPattern = { name: string; regex: string };

export type RedactRules = {
  detectors?: string[];
  fields?: string[];
  patterns?: RedactPattern[];
  agents?: string[];
  tools?: string[];
  exceptTools?: string[];
  restoreTo?: string[];
};

export type RedactionCounts = Record<string, number>;

// ── validators ──────────────────────────────────────────────────────────────

const digitsOf = (s: string) => s.replace(/\D/g, "");

function luhnOk(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Japanese Individual Number (マイナンバー): 12 digits, the last a check digit. */
export function myNumberOk(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 12 || /^(\d)\1+$/.test(d)) {
    return false;
  }
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const p = d.charCodeAt(11 - n) - 48;
    const q = n <= 6 ? n + 1 : n - 5;
    sum += p * q;
  }
  const r = sum % 11;
  const check = r <= 1 ? 0 : 11 - r;
  return check === d.charCodeAt(11) - 48;
}

export function cpfOk(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) {
    return false;
  }
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += (d.charCodeAt(i) - 48) * (len + 1 - i);
    }
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === d.charCodeAt(9) - 48 && calc(10) === d.charCodeAt(10) - 48;
}

export function cnpjOk(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) {
    return false;
  }
  const calc = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += (d.charCodeAt(i) - 48) * weights[i];
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === d.charCodeAt(12) - 48 && calc(13) === d.charCodeAt(13) - 48;
}

type Detector = { kind: string; re: RegExp; valid?: (m: string) => boolean };

const DETECTORS: Record<BuiltinDetector, Detector[]> = {
  email: [
    { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  ],
  "credit-card": [{ kind: "CARD", re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, valid: luhnOk }],
  "jp-my-number": [
    { kind: "MY_NUMBER", re: /(?<![\d-])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g, valid: myNumberOk },
  ],
  "br-cnpj": [
    { kind: "CNPJ", re: /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, valid: cnpjOk },
  ],
  "br-cpf": [{ kind: "CPF", re: /(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, valid: cpfOk }],
  phone: [
    // International: +81 3-1234-5678, +55 (11) 91234-5678, +1 415 555 0100
    { kind: "PHONE", re: /\+\d{1,3}[ -]?(?:\(\d{1,4}\)|\d{1,4})(?:[ -]?\d{2,5}){1,3}(?!\d)/g },
    // Japan domestic: 03-1234-5678, 090-1234-5678, 09012345678
    { kind: "PHONE", re: /(?<![\d-])0\d{1,4}-\d{1,4}-\d{3,4}(?![\d-])/g },
    { kind: "PHONE", re: /(?<!\d)0[789]0\d{8}(?!\d)/g },
    // Brazil domestic: (11) 91234-5678, 11 3456-7890
    { kind: "PHONE", re: /\(\d{2}\)\s?9?\d{4}-\d{4}(?!\d)/g },
  ],
  "jp-postal": [{ kind: "POSTAL", re: /〒\s?\d{3}-?\d{4}|(?<![\d-])\d{3}-\d{4}(?![\d-])/g }],
  ip: [
    {
      kind: "IP",
      re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
    },
  ],
};

// ── vault ───────────────────────────────────────────────────────────────────

export const PLACEHOLDER_RE = /\[\[PII:([A-Z0-9_]+):(\d+)\]\]/g;
const MAX_VAULT_SESSIONS = 512;
const MAX_VAULT_ENTRIES = 20_000;

export class RedactionVault {
  private byValue = new Map<string, string>();
  private byPlaceholder = new Map<string, string>();
  private counters = new Map<string, number>();

  get size(): number {
    return this.byPlaceholder.size;
  }

  placeholderFor(kind: string, value: string): string {
    const key = `${kind}\u0000${value}`;
    const existing = this.byValue.get(key);
    if (existing) {
      return existing;
    }
    if (this.byPlaceholder.size >= MAX_VAULT_ENTRIES) {
      // Full: still mask, but with a placeholder that cannot be restored.
      return `[[PII:${kind}:0]]`;
    }
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const ph = `[[PII:${kind}:${n}]]`;
    this.byValue.set(key, ph);
    this.byPlaceholder.set(ph, value);
    return ph;
  }

  valueOf(placeholder: string): string | undefined {
    return this.byPlaceholder.get(placeholder);
  }
}

const vaults = new Map<string, RedactionVault>();

export function vaultFor(sessionKey: string | undefined): RedactionVault {
  const key = (sessionKey ?? "").trim().toLowerCase() || "(no-session)";
  let v = vaults.get(key);
  if (v) {
    vaults.delete(key);
    vaults.set(key, v); // LRU touch
    return v;
  }
  v = new RedactionVault();
  vaults.set(key, v);
  while (vaults.size > MAX_VAULT_SESSIONS) {
    const oldest = vaults.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    vaults.delete(oldest);
  }
  return v;
}

export function resetRedactionVaults(): void {
  vaults.clear();
}

// ── redaction ───────────────────────────────────────────────────────────────

export type CompiledRedactor = {
  detectors: Detector[];
  fields: string[];
};

function sanitizeKind(name: string): string {
  const s = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "FIELD";
}

export function compileRedactor(rules: RedactRules): CompiledRedactor {
  const names = (rules.detectors ?? DEFAULT_DETECTORS) as string[];
  const detectors: Detector[] = [];
  for (const name of BUILTIN_DETECTORS) {
    if (names.includes(name)) {
      detectors.push(...DETECTORS[name]);
    }
  }
  for (const p of rules.patterns ?? []) {
    detectors.push({ kind: sanitizeKind(p.name), re: new RegExp(p.regex, "gu") });
  }
  const fields = (rules.fields ?? []).flatMap((f) => (f === "@personal" ? PERSONAL_FIELDS : [f]));
  return { detectors, fields: fields.map((f) => f.toLowerCase()) };
}

function bump(counts: RedactionCounts, kind: string) {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

export function redactText(
  text: string,
  r: CompiledRedactor,
  vault: RedactionVault,
  counts: RedactionCounts,
): string {
  let out = text;
  for (const d of r.detectors) {
    d.re.lastIndex = 0;
    out = out.replace(d.re, (m: string) => {
      if (m.startsWith("[[PII:") || (d.valid && !d.valid(m))) {
        return m;
      }
      bump(counts, d.kind);
      return vault.placeholderFor(d.kind, m);
    });
  }
  return out;
}

function fieldMatches(r: CompiledRedactor, key: string): boolean {
  const k = key.toLowerCase();
  return r.fields.some((f) => nameMatches(f, k));
}

/** Deep copy with masked field values and detector hits; non-plain objects are kept as they are. */
export function redactValue(
  value: unknown,
  r: CompiledRedactor,
  vault: RedactionVault,
  counts: RedactionCounts,
  depth = 0,
): unknown {
  if (depth > 32) {
    return value;
  }
  if (typeof value === "string") {
    return redactText(value, r, vault, counts);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, r, vault, counts, depth + 1));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        r.fields.length > 0 &&
        fieldMatches(r, k) &&
        v !== null &&
        v !== "" &&
        (typeof v === "string" || typeof v === "number")
      ) {
        const kind = sanitizeKind(k);
        bump(counts, kind);
        out[k] = vault.placeholderFor(kind, String(v));
      } else {
        out[k] = redactValue(v, r, vault, counts, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Text that is a JSON document gets field masking too; anything else only the detectors. */
export function redactToolText(
  text: string,
  r: CompiledRedactor,
  vault: RedactionVault,
  counts: RedactionCounts,
): string {
  const t = text.trim();
  if (r.fields.length > 0 && (t.startsWith("{") || t.startsWith("["))) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const masked = redactValue(parsed, r, vault, counts);
      return t.includes("\n") ? JSON.stringify(masked, null, 2) : JSON.stringify(masked);
    } catch {
      // not JSON: fall through
    }
  }
  return redactText(text, r, vault, counts);
}

/** A tool result `{ content: [{type:"text",text}], details }` with text and details masked. */
export function redactToolResult(
  result: unknown,
  r: CompiledRedactor,
  vault: RedactionVault,
): { result: unknown; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  if (typeof result === "string") {
    return { result: redactToolText(result, r, vault, counts), counts };
  }
  if (!result || typeof result !== "object") {
    return { result, counts };
  }
  const src = result as { content?: unknown; details?: unknown };
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  if (Array.isArray(src.content)) {
    out.content = src.content.map((block: unknown) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        const b = block as { text: string };
        return { ...b, text: redactToolText(b.text, r, vault, counts) };
      }
      return block;
    });
  }
  if (src.details !== undefined) {
    out.details = redactValue(src.details, r, vault, counts);
  }
  return { result: out, counts };
}

/** Put real values back into tool arguments. Unknown placeholders are left as they are. */
export function restoreValue(
  value: unknown,
  vault: RedactionVault,
  counter: { n: number },
  depth = 0,
): unknown {
  if (depth > 32) {
    return value;
  }
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER_RE, (ph: string) => {
      const real = vault.valueOf(ph);
      if (real === undefined) {
        return ph;
      }
      counter.n += 1;
      return real;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => restoreValue(v, vault, counter, depth + 1));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = restoreValue(v, vault, counter, depth + 1);
    }
    return out;
  }
  return value;
}

// ── scope ───────────────────────────────────────────────────────────────────

const anyMatch = (globs: readonly string[] | undefined, value: string) =>
  (globs ?? []).some((g) => nameMatches(g, value));

/** Tool name as policy rules see it: `mcp:<server>/<tool>` for MCP tools. */
export function toolRef(tool: string, mcpServer?: string): string {
  return mcpServer ? `mcp:${mcpServer}/${tool}` : tool;
}

export function redactionApplies(rules: RedactRules, agentId: string, ref: string, tool: string) {
  if (rules.agents && !anyMatch(rules.agents, agentId)) {
    return false;
  }
  const matchTool = (globs?: string[]) => anyMatch(globs, ref) || anyMatch(globs, tool);
  if (rules.exceptTools && matchTool(rules.exceptTools)) {
    return false;
  }
  return rules.tools ? matchTool(rules.tools) : true;
}

export function restoreAllowed(rules: RedactRules, ref: string, tool: string): boolean {
  return anyMatch(rules.restoreTo, ref) || anyMatch(rules.restoreTo, tool);
}

/** Semantic checks for `data.redact` (schema handles the shapes). */
export function validateRedactRules(rules: RedactRules): string[] {
  const errors: string[] = [];
  for (const d of rules.detectors ?? []) {
    if (!(BUILTIN_DETECTORS as readonly string[]).includes(d)) {
      errors.push(
        `data.redact.detectors: unknown detector "${d}" (known: ${BUILTIN_DETECTORS.join(", ")})`,
      );
    }
  }
  for (const [i, p] of (rules.patterns ?? []).entries()) {
    try {
      const re = new RegExp(p.regex, "gu");
      if (re.test("")) {
        errors.push(`data.redact.patterns[${i}] (${p.name}): matches the empty string`);
      }
    } catch (err) {
      errors.push(`data.redact.patterns[${i}] (${p.name}): invalid regex (${String(err)})`);
    }
  }
  return errors;
}
