import { validateToolArguments } from "@mariozechner/pi-ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSandboxedEditTool, createSandboxedReadTool } from "./pi-tools.read.js";

describe("Claude-style aliases pass argument validation", () => {
  it("accepts file_path / old_string / new_string without the original keys", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-alias-"));
    try {
      fs.writeFileSync(path.join(root, "a.ini"), "port=8080\n");
      const read = createSandboxedReadTool(root);
      const edit = createSandboxedEditTool(root);
      expect(() =>
        validateToolArguments(read, {
          type: "toolCall",
          id: "1",
          name: "read",
          arguments: { file_path: "a.ini" },
        }),
      ).not.toThrow();
      const args = validateToolArguments(edit, {
        type: "toolCall",
        id: "2",
        name: "edit",
        arguments: { file_path: "a.ini", old_string: "8080", new_string: "9090" },
      });
      await edit.execute("2", args);
      expect(fs.readFileSync(path.join(root, "a.ini"), "utf8")).toBe("port=9090\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
