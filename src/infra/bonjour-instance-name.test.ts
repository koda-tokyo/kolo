import { describe, expect, it } from "vitest";
import { fitBonjourInstanceName, MDNS_LABEL_MAX_BYTES } from "./bonjour-instance-name.js";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("fitBonjourInstanceName", () => {
  it("leaves short names alone", () => {
    expect(fitBonjourInstanceName("Mac Studio (KoLo)")).toBe("Mac Studio (KoLo)");
    expect(fitBonjourInstanceName("  KoLo  ")).toBe("KoLo");
  });

  it("fits a 90-char hostname under the 63-byte DNS label limit, suffix last", () => {
    const hostname = "a".repeat(30) + "-" + "b".repeat(30) + "-" + "c".repeat(28);
    expect(hostname).toHaveLength(90);
    const fitted = fitBonjourInstanceName(`${hostname} (KoLo)`);
    expect(bytes(fitted)).toBeLessThanOrEqual(MDNS_LABEL_MAX_BYTES);
    expect(fitted.endsWith(" (KoLo)")).toBe(true);
    expect(fitted.startsWith("a".repeat(30))).toBe(true);
    expect(fitted).toMatch(/^a{30}-b-[0-9a-f]{8} \(KoLo\)$/);
    // Stable: the same host always gets the same label.
    expect(fitBonjourInstanceName(`${hostname} (KoLo)`)).toBe(fitted);
  });

  it("fits the macOS runner name that crashed the gateway", () => {
    const name = "sat12-bq160-79f8433a-8bb8-4c25-8f32-b2e9a903ce1e-BE7F32AEF935 (KoLo)";
    expect(bytes(name)).toBeGreaterThan(MDNS_LABEL_MAX_BYTES);
    const fitted = fitBonjourInstanceName(name);
    expect(bytes(fitted)).toBeLessThanOrEqual(MDNS_LABEL_MAX_BYTES);
    expect(fitted).toMatch(/^sat12-bq160-79f8433a-8bb8-4c25-8-[0-9a-f]{8} \(KoLo\)$/);
  });

  it("keeps two long hosts distinct", () => {
    const a = fitBonjourInstanceName(`${"host".repeat(20)}-one (KoLo)`);
    const b = fitBonjourInstanceName(`${"host".repeat(20)}-two (KoLo)`);
    expect(a).not.toBe(b);
  });

  it("counts bytes, not characters, and never splits a code point", () => {
    const name = "é".repeat(40) + " (KoLo)"; // 80 bytes of prefix
    const fitted = fitBonjourInstanceName(name);
    expect(bytes(fitted)).toBeLessThanOrEqual(MDNS_LABEL_MAX_BYTES);
    expect(fitted).toMatch(/^é+-[0-9a-f]{8} \(KoLo\)$/);
  });

  it("works without the product suffix", () => {
    const fitted = fitBonjourInstanceName("x".repeat(100));
    expect(bytes(fitted)).toBeLessThanOrEqual(MDNS_LABEL_MAX_BYTES);
    expect(fitted).toMatch(/^x{32}-[0-9a-f]{8}$/);
  });
});
