import { describe, expect, it } from "vitest";
import { TUI_KEYBIND_ACTIONS } from "../config/types.tui.js";
import {
  DEFAULT_TUI_CHORDS,
  DEFAULT_TUI_KEYBINDS,
  formatKeybinds,
  matchAction,
  matchChord,
  parseBinding,
  parseKeyId,
  resolveKeybinds,
} from "./keybinds.js";

describe("parseKeyId", () => {
  it("normalises modifiers and case", () => {
    expect(parseKeyId("Ctrl+P")).toBe("ctrl+p");
    expect(parseKeyId("alt+Enter")).toBe("alt+enter");
    expect(parseKeyId("shift+ctrl+a")).toBe("ctrl+shift+a");
    expect(parseKeyId("F2")).toBe("f2");
    expect(parseKeyId("ctrl+pageup")).toBe("ctrl+pageUp");
  });

  it("rejects things that are not keys", () => {
    expect(parseKeyId("")).toBeNull();
    expect(parseKeyId("ctrl+")).toBeNull();
    expect(parseKeyId("super+x")).toBeNull();
    expect(parseKeyId("ctrl+ctrl+x")).toBeNull();
    expect(parseKeyId("hello")).toBeNull();
  });
});

describe("parseBinding", () => {
  it("reads direct keys and leader chords", () => {
    expect(parseBinding("ctrl+p")).toEqual({ key: "ctrl+p", chord: false });
    expect(parseBinding("leader+s")).toEqual({ key: "s", chord: true });
    expect(parseBinding("Leader + ctrl+s")).toEqual({ key: "ctrl+s", chord: true });
    expect(parseBinding("leader+")).toBeNull();
    expect(parseBinding("leader")).toBeNull();
  });
});

describe("resolveKeybinds", () => {
  it("gives every action a direct key or a chord by default, without conflicts", () => {
    const { bindings, leader, warnings } = resolveKeybinds(undefined);
    expect(warnings).toEqual([]);
    expect(leader).toBe("ctrl+x");
    const direct = new Set<string>();
    const chords = new Set<string>();
    for (const action of TUI_KEYBIND_ACTIONS) {
      expect(bindings[action].length, action).toBeGreaterThan(0);
      expect(
        bindings[action].some((b) => b.chord),
        `${action} chord`,
      ).toBe(true);
      for (const binding of bindings[action]) {
        const set = binding.chord ? chords : direct;
        expect(set.has(binding.key), `${action} ${binding.key}`).toBe(false);
        set.add(binding.key);
      }
    }
    expect(Object.keys(DEFAULT_TUI_KEYBINDS).toSorted()).toEqual(
      [...TUI_KEYBIND_ACTIONS].toSorted(),
    );
    expect(Object.keys(DEFAULT_TUI_CHORDS).toSorted()).toEqual([...TUI_KEYBIND_ACTIONS].toSorted());
    expect(direct.has("ctrl+x")).toBe(false);
  });

  it("overrides one action and keeps the rest; a list sets several bindings", () => {
    const { bindings, warnings } = resolveKeybinds({ sessions: "f11", help: ["f10", "leader+?"] });
    expect(warnings).toEqual([]);
    expect(bindings.sessions).toEqual([
      { key: "s", chord: true },
      { key: "f11", chord: false },
    ]);
    expect(bindings.models[0]).toEqual({ key: "ctrl+l", chord: false });
    expect(bindings.help).toEqual([
      { key: "f10", chord: false },
      { key: "?", chord: true },
    ]);
    expect(resolveKeybinds({ jobs: "leader+x" }).bindings.jobs).toEqual([
      { key: "f3", chord: false },
      { key: "x", chord: true },
    ]);
  });

  it("warns on unknown actions and bad keys, keeping the default", () => {
    const { bindings, warnings } = resolveKeybinds({ nope: "ctrl+x", models: "not a key" });
    expect(bindings.models[0]?.key).toBe("ctrl+l");
    expect(warnings.some((w) => w.includes('unknown action "nope"'))).toBe(true);
    expect(warnings.some((w) => w.includes("tui.keybinds.models"))).toBe(true);
  });

  it("resolves a conflict: the later action wins and the earlier one loses the binding", () => {
    const { bindings, warnings } = resolveKeybinds({ sessions: "ctrl+l" });
    // sessions is declared before models; both now want ctrl+l -> models wins.
    expect(bindings.models.some((b) => b.key === "ctrl+l")).toBe(true);
    expect(bindings.sessions.some((b) => !b.chord)).toBe(false);
    expect(bindings.sessions.some((b) => b.chord && b.key === "s")).toBe(true);
    expect(warnings).toEqual([
      "tui.keybinds: ctrl+l is bound to both sessions and models; models wins",
    ]);
  });

  it("reports chord conflicts separately from direct keys", () => {
    const { bindings, warnings } = resolveKeybinds({ jobs: "leader+s" });
    expect(warnings).toEqual([
      "tui.keybinds: ctrl+x s is bound to both sessions and jobs; jobs wins",
    ]);
    expect(bindings.sessions.some((b) => b.chord)).toBe(false);
    expect(bindings.sessions.some((b) => b.key === "ctrl+p")).toBe(true);
  });

  it("changes the leader, reserves it and escape, and turns chords off with an empty leader", () => {
    const changed = resolveKeybinds({ leader: "ctrl+b", status: "ctrl+b", jobs: "leader+escape" });
    expect(changed.leader).toBe("ctrl+b");
    expect(changed.bindings.status.some((b) => !b.chord)).toBe(false);
    expect(changed.bindings.jobs.some((b) => b.chord)).toBe(false);
    expect(changed.warnings).toEqual([
      "tui.keybinds.status: ctrl+b is the leader key; binding dropped",
      "tui.keybinds.jobs: escape cannot be a chord key (it cancels the chord)",
    ]);
    const off = resolveKeybinds({ leader: "" });
    expect(off.leader).toBeNull();
    expect(off.bindings.sessions.every((b) => !b.chord)).toBe(true);
    expect(resolveKeybinds({ leader: "nope" }).warnings[0]).toContain("tui.keybinds.leader");
  });
});

describe("matchAction and matchChord", () => {
  it("maps raw terminal input to the bound action", () => {
    const { bindings } = resolveKeybinds({ sessions: "f2", status: "f12" });
    expect(matchAction("\x1b[12~", bindings)).toBe("sessions"); // F2 legacy sequence
    expect(matchAction("\x0f", bindings)).toBe("toggleReasoning"); // ctrl+o
    expect(matchAction("\x1bo", bindings)).toBe("toggleTools"); // alt+o
    expect(matchChord("f", bindings)).toBe("toggleReasoning");
    expect(matchAction("\x19", bindings)).toBe("toggleDiff"); // ctrl+y
    expect(matchAction("a", bindings)).toBeNull();
    expect(matchAction("s", bindings)).toBeNull(); // chord keys never match directly
    expect(matchChord("s", bindings)).toBe("sessions");
    expect(matchChord("q", bindings)).toBe("exit");
    expect(matchChord("\x0f", bindings)).toBeNull();
  });
});

describe("formatKeybinds", () => {
  it("prints one row per action with key, chord and description, then the leader", () => {
    const { bindings, leader } = resolveKeybinds(undefined);
    const lines = formatKeybinds(bindings, leader);
    expect(lines[0]).toMatch(/^action\s+key\s+chord\s+what it does$/);
    expect(lines).toHaveLength(TUI_KEYBIND_ACTIONS.length + 2);
    expect(lines[1]).toContain("sessions        ctrl+p");
    expect(lines[1]).toContain("ctrl+x s");
    expect(lines[1]).toContain("open the session switcher");
    expect(lines.at(-1)).toBe("leader: ctrl+x (then one key; escape cancels)");
    expect(formatKeybinds(resolveKeybinds({ leader: "" }).bindings, null).at(-1)).toBe(
      "leader: off",
    );
  });
});
