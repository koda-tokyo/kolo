import { describe, expect, it, vi } from "vitest";
import { createGatewayHttp, httpBaseFromWsUrl } from "./gateway-http.js";

describe("gateway http", () => {
  it("derives the http base from the ws url", () => {
    expect(httpBaseFromWsUrl("ws://127.0.0.1:18789")).toBe("http://127.0.0.1:18789");
    expect(httpBaseFromWsUrl("wss://gw.example/ws/")).toBe("https://gw.example/ws");
    expect(httpBaseFromWsUrl("ws://h:1/?x=1")).toBe("http://h:1");
  });

  it("sends the bearer token and normalises errors", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/boom")) {
        return new Response(JSON.stringify({ ok: false, error: "nothing to undo" }), {
          status: 409,
        });
      }
      expect(init.headers).toMatchObject({ authorization: "Bearer t0k" });
      return new Response(JSON.stringify({ ok: true, cursor: 1 }), { status: 200 });
    });
    const http = createGatewayHttp({ url: "ws://127.0.0.1:1", token: "t0k" }, fetchImpl as never);
    const ok = await http.request<{ cursor: number }>("POST", "/api/x", { action: "undo" });
    expect(ok).toEqual({ ok: true, body: { ok: true, cursor: 1 } });
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"action":"undo"}');
    const bad = await http.request("GET", "/boom");
    expect(bad).toEqual({ ok: false, status: 409, error: "nothing to undo" });
    const noToken = createGatewayHttp({ url: "ws://127.0.0.1:1" }, fetchImpl as never);
    expect((await noToken.request("GET", "/x")).ok).toBe(false);
    const down = createGatewayHttp(
      { url: "ws://127.0.0.1:1", token: "t" },
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never,
    );
    const result = await down.request("GET", "/x");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("gateway unreachable");
  });
});
