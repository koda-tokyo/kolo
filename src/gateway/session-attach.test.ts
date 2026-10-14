import { describe, expect, it } from "vitest";
import {
  attachmentView,
  parseSessionAttachMode,
  SessionAttachRegistry,
  type SessionAttachment,
} from "./session-attach.js";

function att(connId: string, key: string, mode: SessionAttachment["mode"] = "interact") {
  return {
    connId,
    key,
    mode,
    since: "2026-10-13T00:00:00.000Z",
    client: { id: "cli", mode: "cli" },
    identity: `owner:ws:${connId}`,
    device: "fp",
    scope: "owner",
  } satisfies SessionAttachment;
}

describe("session attach registry (M3b)", () => {
  it("tracks several clients on one session and detaches per connection", () => {
    const r = new SessionAttachRegistry();
    expect(r.attach(att("c1", "agent:atlas:main")).created).toBe(true);
    expect(r.attach(att("c2", "Agent:Atlas:Main", "follow")).created).toBe(true);
    // Re-attach from the same connection only updates the mode.
    const again = r.attach(att("c1", "agent:atlas:main", "pipe"));
    expect(again.created).toBe(false);
    expect(again.attachment.mode).toBe("pipe");
    expect(
      r
        .attachmentsOf("agent:atlas:main")
        .map((a) => a.connId)
        .toSorted(),
    ).toEqual(["c1", "c2"]);
    expect(r.counts().get("agent:atlas:main")).toBe(2);
    expect(r.isAttached("c2", "AGENT:ATLAS:MAIN")).toBe(true);

    expect(r.detach("c1", "agent:atlas:main")?.connId).toBe("c1");
    expect(r.detach("c1", "agent:atlas:main")).toBeUndefined();
    expect(r.counts().get("agent:atlas:main")).toBe(1);
    expect(r.keysOf("c1")).toEqual([]);
  });

  it("detachAll on close returns every attachment of that connection", () => {
    const r = new SessionAttachRegistry();
    r.attach(att("c1", "agent:a:main"));
    r.attach(att("c1", "agent:b:main"));
    r.attach(att("c2", "agent:a:main"));
    const gone = r
      .detachAll("c1")
      .map((a) => a.key)
      .toSorted();
    expect(gone).toEqual(["agent:a:main", "agent:b:main"]);
    expect(r.detachAll("c1")).toEqual([]);
    expect(r.counts().get("agent:a:main")).toBe(1);
    expect(r.counts().has("agent:b:main")).toBe(false);
  });

  it("parses modes strictly and hides the device fingerprint in views", () => {
    expect(parseSessionAttachMode(undefined)).toBe("interact");
    expect(parseSessionAttachMode("follow")).toBe("follow");
    expect(parseSessionAttachMode("pipe")).toBe("pipe");
    expect(parseSessionAttachMode("admin")).toBeNull();
    const view = attachmentView(att("c1", "agent:a:main"));
    expect("device" in view).toBe(false);
    expect(view.identity).toBe("owner:ws:c1");
  });
});
