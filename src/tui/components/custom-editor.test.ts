import { describe, expect, it, vi } from "vitest";
import { resolveKeybinds } from "../keybinds.js";
import { CustomEditor } from "./custom-editor.js";

function makeEditor() {
  const tui = { requestRender: vi.fn(), terminal: { columns: 80, rows: 24 } };
  const editor = new CustomEditor(tui as never, { borderColor: (t: string) => t } as never);
  const resolved = resolveKeybinds(undefined);
  editor.bindings = resolved.bindings;
  editor.leader = resolved.leader;
  editor.onAction = vi.fn();
  editor.onLeaderState = vi.fn();
  return editor;
}

describe("CustomEditor leader chords", () => {
  it("arms on the leader, runs the chord on the next key and never types it", () => {
    const editor = makeEditor();
    editor.handleInput("\x18"); // ctrl+x
    expect(editor.isLeaderArmed()).toBe(true);
    expect(editor.onLeaderState).toHaveBeenCalledWith("armed");
    editor.handleInput("s");
    expect(editor.isLeaderArmed()).toBe(false);
    expect(editor.onAction).toHaveBeenCalledWith("sessions");
    expect(editor.getText()).toBe("");
  });

  it("escape cancels and an unbound key reports instead of typing", () => {
    const editor = makeEditor();
    editor.handleInput("\x18");
    editor.handleInput("\x1b");
    expect(editor.onLeaderState).toHaveBeenLastCalledWith("cancelled");
    expect(editor.onAction).not.toHaveBeenCalled();
    editor.handleInput("\x18");
    editor.handleInput("9");
    expect(editor.onLeaderState).toHaveBeenLastCalledWith("unbound", "9");
    expect(editor.getText()).toBe("");
  });

  it("direct keys still work and plain text still types", () => {
    const editor = makeEditor();
    editor.handleInput("\x10"); // ctrl+p
    expect(editor.onAction).toHaveBeenCalledWith("sessions");
    editor.handleInput("h");
    editor.handleInput("i");
    expect(editor.getText()).toBe("hi");
    // exit only fires on an empty editor
    editor.handleInput("\x04"); // ctrl+d
    expect(editor.onAction).not.toHaveBeenCalledWith("exit");
  });

  it("with chords off the leader key is typed or handled by the editor", () => {
    const editor = makeEditor();
    editor.leader = null;
    editor.handleInput("\x18");
    expect(editor.isLeaderArmed()).toBe(false);
    expect(editor.onLeaderState).not.toHaveBeenCalled();
  });
});
