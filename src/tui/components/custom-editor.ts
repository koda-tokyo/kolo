import { Editor, type KeyId, matchesKey } from "@mariozechner/pi-tui";
import { type KeyBinding, matchAction, matchChord, type TuiKeybindAction } from "../keybinds.js";

/**
 * Editor with a configurable action map (`tui.keybinds`). Actions are dispatched through
 * `onAction`; `exit` only fires on an empty editor and `abort` never fires while the
 * autocomplete popup is open, so typing is never interrupted by a stray key.
 *
 * Leader chords (M10): pressing the leader key arms the editor; the next key is matched against
 * the chord bindings instead of being typed. Escape, or a key with no chord, disarms it.
 */
export class CustomEditor extends Editor {
  bindings: Partial<Record<TuiKeybindAction, KeyBinding[]>> = {};
  leader: KeyId | null = null;
  onAction?: (action: TuiKeybindAction) => void;
  onAltEnter?: () => void;
  /** Called when the leader is pressed (`armed`), released without an action, or misses. */
  onLeaderState?: (state: "armed" | "cancelled" | "unbound", key?: string) => void;
  private leaderArmed = false;

  isLeaderArmed(): boolean {
    return this.leaderArmed;
  }

  handleInput(data: string): void {
    if (this.leaderArmed) {
      this.leaderArmed = false;
      if (matchesKey(data, "escape")) {
        this.onLeaderState?.("cancelled");
        return;
      }
      const chord = matchChord(data, this.bindings);
      if (chord) {
        this.dispatch(chord, data);
      } else {
        this.onLeaderState?.("unbound", data);
      }
      return;
    }
    if (this.leader && !this.isShowingAutocomplete() && matchesKey(data, this.leader)) {
      this.leaderArmed = true;
      this.onLeaderState?.("armed");
      return;
    }
    if (matchesKey(data, "alt+enter") && this.onAltEnter) {
      this.onAltEnter();
      return;
    }
    const action = matchAction(data, this.bindings);
    if (action && this.onAction) {
      this.dispatch(action, data);
      return;
    }
    super.handleInput(data);
  }

  private dispatch(action: TuiKeybindAction, data: string): void {
    if (!this.onAction) {
      return;
    }
    if (action === "abort" && this.isShowingAutocomplete()) {
      super.handleInput(data);
      return;
    }
    if (action === "exit") {
      if (this.getText().length === 0) {
        this.onAction(action);
      }
      return;
    }
    this.onAction(action);
  }
}
