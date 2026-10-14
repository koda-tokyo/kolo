import { describe, expect, test } from "vitest";
import { encodeFrame, FrameDecoder } from "./framing.js";

describe("lsp framing", () => {
  test("round-trips one message", () => {
    const decoder = new FrameDecoder();
    const out = decoder.push(encodeFrame({ jsonrpc: "2.0", id: 1, method: "x" }));
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, method: "x" }]);
  });

  test("handles split and coalesced frames and multibyte bodies", () => {
    const decoder = new FrameDecoder();
    const a = encodeFrame({ id: 1, text: "日本語" });
    const b = encodeFrame({ id: 2 });
    const joined = Buffer.concat([a, b]);
    const first = decoder.push(joined.subarray(0, 10));
    expect(first).toEqual([]);
    const rest = decoder.push(joined.subarray(10));
    expect(rest).toEqual([{ id: 1, text: "日本語" }, { id: 2 }]);
  });

  test("skips malformed header blocks and bodies", () => {
    const decoder = new FrameDecoder();
    const bad = Buffer.from("X-Nope: 1\r\n\r\n", "latin1");
    const badBody = Buffer.from("Content-Length: 3\r\n\r\n{{{", "latin1");
    const out = decoder.push(Buffer.concat([bad, badBody, encodeFrame({ ok: true })]));
    expect(out).toEqual([{ ok: true }]);
  });
});
