import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultExportPath,
  exportTranscript,
  parseExportArgs,
  renderTranscriptJson,
  renderTranscriptMarkdown,
} from "./export.js";

const messages = [
  { role: "user", content: "hello", timestamp: 1_700_000_000_000 },
  {
    role: "assistant",
    model: "m1",
    timestamp: 1_700_000_001_000,
    content: [
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "Running a tool. Token sk-abcdefghijklmnopqrstuvwxyz123456" },
      { type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "exec",
    isError: false,
    content: [{ type: "text", text: "file.txt\n```\nAPI_KEY=supersecretvalue12345678\n```" }],
  },
];
const meta = { sessionKey: "agent:alice:main", agentId: "alice", exportedAt: new Date(0) };

describe("parseExportArgs", () => {
  it("reads format and path in either order of presence", () => {
    expect(parseExportArgs("")).toEqual({ format: "md", outPath: undefined });
    expect(parseExportArgs("json")).toEqual({ format: "json", outPath: undefined });
    expect(parseExportArgs("markdown out.md")).toEqual({ format: "md", outPath: "out.md" });
    expect(parseExportArgs("out.json")).toEqual({ format: "json", outPath: "out.json" });
    expect(parseExportArgs("md a b")).toEqual({ error: "usage: /export [md|json] [path]" });
  });
});

describe("renderTranscriptMarkdown", () => {
  it("renders user, assistant, thinking, tool calls and tool results", () => {
    const text = renderTranscriptMarkdown(messages, meta);
    expect(text).toContain("# Session agent:alice:main");
    expect(text).toContain("- agent: alice");
    expect(text).toContain("## User (2023-11-14T22:13:20.000Z)");
    expect(text).toContain("## Assistant (2023-11-14T22:13:21.000Z) · m1");
    expect(text).toContain("<details><summary>thinking</summary>");
    expect(text).toContain("Tool call: `exec`");
    expect(text).toContain('"command": "ls"');
    expect(text).toContain("### Tool result: exec (ok)");
    // Nested fences get a longer fence.
    expect(text).toContain("````\nfile.txt");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("renders JSON with the messages untouched", () => {
    const parsed = JSON.parse(renderTranscriptJson(messages, meta));
    expect(parsed.sessionKey).toBe("agent:alice:main");
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.exportedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("exportTranscript", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-export-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a redacted file at the default path and refuses to overwrite", async () => {
    const result = await exportTranscript({ messages, meta, format: "md", cwd: dir });
    expect(result.path).toBe(defaultExportPath(dir, meta.sessionKey, "md", meta.exportedAt));
    expect(path.basename(result.path)).toBe("kolo-session-agent-alice-main-19700101T000000Z.md");
    const text = fs.readFileSync(result.path, "utf8");
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(text).not.toContain("supersecretvalue12345678");
    expect(text).toContain("## User");
    expect(result.messages).toBe(3);
    expect(result.bytes).toBe(Buffer.byteLength(text));
    await expect(exportTranscript({ messages, meta, format: "md", cwd: dir })).rejects.toThrow(
      /file exists/,
    );
  });

  it("writes JSON to a given relative path, creating directories", async () => {
    const result = await exportTranscript({
      messages,
      meta,
      format: "json",
      outPath: "out/t.json",
      cwd: dir,
    });
    expect(result.path).toBe(path.join(dir, "out", "t.json"));
    const parsed = JSON.parse(fs.readFileSync(result.path, "utf8"));
    expect(parsed.messages[1].content[1].text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});
