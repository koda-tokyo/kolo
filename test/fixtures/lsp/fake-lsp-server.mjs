#!/usr/bin/env node
// Fake language server for tests (KoLo 2.0, M9b). JSON-RPC over stdio with Content-Length framing.
//   initialize -> capabilities; didOpen/didChange -> publishDiagnostics (one error per line that
//   contains "ERR", none otherwise); definition/references/hover -> fixed answers; shutdown/exit.
// FAKE_LSP_SILENT=1 never publishes diagnostics (timeout tests).

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function publish(uri, text) {
  if (process.env.FAKE_LSP_SILENT === "1") {
    return;
  }
  const diagnostics = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((line, index) => {
    const col = line.indexOf("ERR");
    if (col >= 0) {
      diagnostics.push({
        range: { start: { line: index, character: col }, end: { line: index, character: col + 3 } },
        severity: 1,
        source: "fake",
        message: `fake error at line ${index + 1}`,
      });
    }
  });
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
}

function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: { capabilities: { textDocumentSync: 1, hoverProvider: true } },
      });
      return;
    case "initialized":
      return;
    case "textDocument/didOpen":
      publish(params.textDocument.uri, params.textDocument.text);
      return;
    case "textDocument/didChange":
      publish(params.textDocument.uri, params.contentChanges?.[0]?.text);
      return;
    case "textDocument/definition":
      send({
        jsonrpc: "2.0",
        id,
        result: [
          {
            uri: params.textDocument.uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
        ],
      });
      return;
    case "textDocument/references":
      send({
        jsonrpc: "2.0",
        id,
        result: [
          {
            uri: params.textDocument.uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
          {
            uri: params.textDocument.uri,
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 7 } },
          },
        ],
      });
      return;
    case "textDocument/hover":
      send({ jsonrpc: "2.0", id, result: { contents: { kind: "markdown", value: "fake hover" } } });
      return;
    case "shutdown":
      send({ jsonrpc: "2.0", id, result: null });
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
      }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("latin1"));
    const length = match ? Number.parseInt(match[1], 10) : 0;
    const start = headerEnd + 4;
    if (buffer.length < start + length) {
      return;
    }
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // ignore malformed input
    }
  }
});

process.stdin.on("end", () => process.exit(0));
