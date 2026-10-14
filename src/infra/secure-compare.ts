import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison.
 *
 * Both sides are hashed first so the buffers handed to `timingSafeEqual` always
 * have the same length; a plain length check would leak the secret's length and
 * `timingSafeEqual` throws on unequal lengths.
 */
export function safeEqualSecret(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
