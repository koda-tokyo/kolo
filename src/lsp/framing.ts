/** JSON-RPC over stdio framing (`Content-Length: n\r\n\r\n<body>`), as the LSP base protocol. */

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "latin1");
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** Feed bytes; returns every complete message decoded so far. Malformed frames are skipped. */
  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        break;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("latin1");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Unknown header block: drop it and keep scanning.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1] ?? "0", 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) {
        break;
      }
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        out.push(JSON.parse(body));
      } catch {
        // skip malformed body
      }
    }
    return out;
  }
}
