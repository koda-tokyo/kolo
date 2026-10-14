// mDNS/DNS-SD service instance names are a single DNS label, and ciao asserts that a label is
// at most 63 bytes. Hosts with long names (cloud CI runners such as
// `sat12-bq160-79f8433a-8bb8-4c25-8f32-b2e9a903ce1e-BE7F32AEF935`) overflow that once the
// product suffix is appended, and the assertion used to take the whole gateway down at boot.
// This module keeps the name within the limit: a short hostname prefix, a stable short id
// derived from the full name (so two long hosts never collide), and the product suffix last.
import { createHash } from "node:crypto";

export const MDNS_LABEL_MAX_BYTES = 63;
export const BONJOUR_PRODUCT_SUFFIX = " (KoLo)";

const PREFIX_MAX_BYTES = 32;
const SHORT_ID_CHARS = 8;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Cut `value` to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateBytes(value: string, maxBytes: number): string {
  let out = "";
  for (const ch of value) {
    if (byteLength(out + ch) > maxBytes) {
      break;
    }
    out += ch;
  }
  return out;
}

/** Stable short id for a (possibly long) display name. */
export function shortNameId(name: string): string {
  return createHash("sha256").update(name, "utf8").digest("hex").slice(0, SHORT_ID_CHARS);
}

/**
 * Return `name` unchanged when it already fits a DNS label, otherwise
 * `<prefix>-<id><suffix>` where the prefix is the start of the name (at most 32 bytes), the id
 * is the first 8 hex chars of its SHA-256, and the suffix is " (KoLo)" when the name carried it.
 * The result is always at most `maxBytes` (63) bytes.
 */
export function fitBonjourInstanceName(
  name: string,
  maxBytes: number = MDNS_LABEL_MAX_BYTES,
): string {
  const trimmed = name.trim();
  if (byteLength(trimmed) <= maxBytes) {
    return trimmed;
  }
  const hasSuffix = /\s*\(KoLo\)\s*$/i.test(trimmed);
  const base = hasSuffix ? trimmed.replace(/\s*\(KoLo\)\s*$/i, "").trim() : trimmed;
  const suffix = hasSuffix ? BONJOUR_PRODUCT_SUFFIX : "";
  const id = shortNameId(base);
  const tail = `-${id}${suffix}`;
  const room = Math.max(1, Math.min(PREFIX_MAX_BYTES, maxBytes - byteLength(tail)));
  const prefix = truncateBytes(base, room).replace(/[\s._-]+$/g, "") || "KoLo";
  return `${prefix}${tail}`;
}
