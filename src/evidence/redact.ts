// Bounded, redacted values for evidence events (KoLo 2.0, M12a): the audit redactor for secret
// keys and token patterns, then a byte cap from `evidence.maxEventBytes`.
import { redactAuditValue } from "../audit/redact.js";
import { canonicalJson, sha256Hex } from "../continuity-suite/manifest.js";
import { redactSensitiveText } from "../logging/redact.js";

export function digestOf(value: unknown): string {
  return sha256Hex(typeof value === "string" ? value : canonicalJson(value ?? null));
}

export function clip(text: string, max: number): { text: string; clipped: boolean } {
  if (Buffer.byteLength(text, "utf8") <= max) {
    return { text, clipped: false };
  }
  let out = text.slice(0, max);
  while (Buffer.byteLength(out, "utf8") > max) {
    out = out.slice(0, -1);
  }
  return { text: out, clipped: true };
}

/** Bounded, redacted text: secrets replaced, then cut to `max` bytes. */
export function boundedText(text: string, max: number): { text: string; clipped: boolean } {
  return clip(redactSensitiveText(text, { mode: "tools" }), max);
}

/** Bounded, redacted structured value (tool args): the audit redactor, then a byte cap. */
export function boundedValue(value: unknown, max: number): { value: unknown; clipped: boolean } {
  const redacted = redactAuditValue(value ?? null);
  const text = JSON.stringify(redacted);
  if (Buffer.byteLength(text, "utf8") <= max) {
    return { value: redacted, clipped: false };
  }
  return { value: clip(text, max).text, clipped: true };
}

/** Plain text of a tool result the way the model sees it, or JSON when it has none. */
export function resultText(result: unknown): string {
  if (result === null || result === undefined) {
    return "";
  }
  if (typeof result === "string") {
    return result;
  }
  const rec = result as { content?: unknown; text?: unknown };
  if (typeof rec.text === "string") {
    return rec.text;
  }
  if (Array.isArray(rec.content)) {
    const parts = rec.content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : "",
      )
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
