import { getPublicKeyAsync, utils, verifyAsync } from "@noble/ed25519";
import { describe, expect, it } from "vitest";
import {
  pairProofPayload,
  readPairCode,
  redeemPairCode,
  refreshDelayMs,
  type PairCredential,
} from "./pair-link";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromB64url(s: string): Uint8Array {
  const n = s.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(n + "=".repeat((4 - (n.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("phone pairing link (M16)", () => {
  it("reads #pair=<code> and keeps other fragment parameters", () => {
    expect(readPairCode("#pair=kpi_abcdefghijkl")).toEqual({ code: "kpi_abcdefghijkl", rest: "" });
    expect(readPairCode("#pair=kpi_abcdefghijkl&tab=chat")).toEqual({
      code: "kpi_abcdefghijkl",
      rest: "#tab=chat",
    });
    expect(readPairCode("#pair=nope")).toBe(null);
    expect(readPairCode("")).toBe(null);
  });

  it("signs the redeem proof the gateway verifies and returns the scoped credential", async () => {
    const priv = utils.randomSecretKey();
    const pub = await getPublicKeyAsync(priv);
    const identity = { deviceId: "fp-1", publicKey: b64url(pub), privateKey: b64url(priv) };
    const requests: Array<{ url: string; body?: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/pair/nonce")) {
        return new Response(JSON.stringify({ nonce: "n-1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          device: { scope: "attach" },
          accessToken: "kpa_x",
          accessExpiresAt: "2026-10-14T01:00:00Z",
          refreshToken: "kpr_y",
          refreshExpiresAt: "2026-11-13T00:00:00Z",
        }),
        { status: 200 },
      );
    };
    const cred = await redeemPairCode({
      origin: "https://192.168.1.20:18789",
      code: "kpi_abcdefghijkl",
      deviceName: "phone browser",
      identity,
      fetchImpl,
    });
    expect(cred).toMatchObject({ accessToken: "kpa_x", scope: "attach", fingerprint: "fp-1" });
    const redeem = requests[1];
    expect(redeem.url).toBe("https://192.168.1.20:18789/api/pair/redeem");
    expect(redeem.body).toMatchObject({
      code: "kpi_abcdefghijkl",
      nonce: "n-1",
      deviceKeyPub: identity.publicKey,
    });
    const payload = await pairProofPayload("redeem", "n-1", "kpi_abcdefghijkl");
    expect(payload).toMatch(/^kolo-pair-v1\|redeem\|n-1\|[0-9a-f]{64}$/);
    expect(
      await verifyAsync(
        fromB64url(redeem.body?.signature ?? ""),
        new TextEncoder().encode(payload),
        pub,
      ),
    ).toBe(true);
  });

  it("refreshes five minutes before the access token expires", () => {
    const cred = { accessExpiresAt: "2026-10-14T01:00:00Z" } as PairCredential;
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(refreshDelayMs(cred, now)).toBe(55 * 60_000);
    expect(refreshDelayMs(cred, Date.parse("2026-10-14T02:00:00Z"))).toBe(0);
  });
});
