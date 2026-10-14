import { describe, expect, it } from "vitest";
import {
  globMatch,
  parseSessionAllowlist,
  sessionAllowed,
  sessionIdentityFromKey,
  sessionPatternMatches,
} from "./session-allowlist.js";

describe("session allowlist (M3b)", () => {
  it("parses, trims, lower-cases and deduplicates; empty means no restriction", () => {
    expect(parseSessionAllowlist(undefined)).toEqual({ ok: true });
    expect(parseSessionAllowlist([])).toEqual({ ok: true });
    expect(parseSessionAllowlist([" Agent:Atlas:* ", "agent:atlas:*", "ops"])).toEqual({
      ok: true,
      sessions: ["agent:atlas:*", "ops"],
    });
    expect(parseSessionAllowlist("agent:atlas:*").ok).toBe(false);
    expect(parseSessionAllowlist([""]).ok).toBe(false);
    expect(parseSessionAllowlist([42]).ok).toBe(false);
    expect(parseSessionAllowlist(Array.from({ length: 33 }, (_, i) => `s${i}`)).ok).toBe(false);
  });

  it("matches globs over keys, bare agent ids and labels", () => {
    expect(globMatch("agent:atlas:*", "agent:atlas:main")).toBe(true);
    expect(globMatch("agent:atlas:*", "agent:iris:main")).toBe(false);
    expect(globMatch("agent:?ris:main", "agent:iris:main")).toBe(true);
    expect(globMatch("a.b", "axb")).toBe(false);

    const tigerMain = sessionIdentityFromKey("agent:atlas:main", { label: "ops" });
    expect(sessionPatternMatches("agent:atlas:main", tigerMain)).toBe(true);
    expect(sessionPatternMatches("agent:atlas:*", tigerMain)).toBe(true);
    expect(sessionPatternMatches("atlas", tigerMain)).toBe(true);
    expect(sessionPatternMatches("iris", tigerMain)).toBe(false);
    expect(sessionPatternMatches("label:ops", tigerMain)).toBe(true);
    expect(sessionPatternMatches("label:o*", tigerMain)).toBe(true);
    expect(sessionPatternMatches("label:dev", tigerMain)).toBe(false);
    // A bare word never matches a key by accident.
    expect(sessionPatternMatches("main", tigerMain)).toBe(false);
    // Session ids are matched too (the discovery id).
    expect(sessionPatternMatches("abc-123", { key: "agent:x:y", sessionId: "abc-123" })).toBe(true);
  });

  it("an absent or empty allowlist admits everything; otherwise any pattern must match", () => {
    const s = sessionIdentityFromKey("agent:orion:whatsapp:+1555");
    expect(sessionAllowed(undefined, s)).toBe(true);
    expect(sessionAllowed([], s)).toBe(true);
    expect(sessionAllowed(["agent:atlas:*"], s)).toBe(false);
    expect(sessionAllowed(["agent:atlas:*", "orion"], s)).toBe(true);
    expect(sessionAllowed(["agent:orion:whatsapp:*"], s)).toBe(true);
    expect(
      sessionAllowed(["AGENT:ORION:WHATSAPP:+1555"], { key: "Agent:Orion:WhatsApp:+1555" }),
    ).toBe(true);
  });
});
