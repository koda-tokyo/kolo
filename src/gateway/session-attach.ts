// Session attachments (KoLo 2.0, M3b).
//
// A client attaches to a session (`session.attach`) to drive it and follow its event stream;
// several clients may be attached to one session and all receive the same `agent`/`chat`
// events (the broadcaster sends them to every connected client that may see the session). The
// registry below is the gateway's view of who is attached to what: it feeds the discovery API
// (`clients` per session), audits attach/detach, and detaches a connection when its socket
// closes. It is process-wide (one gateway per process) and resettable for tests.

export type SessionAttachMode = "interact" | "follow" | "pipe";

export type SessionAttachment = {
  connId: string;
  key: string;
  mode: SessionAttachMode;
  since: string;
  client: { id: string; mode?: string; displayName?: string };
  /** Audit identity of the client ("owner:token", "device:<fingerprint>"). */
  identity: string;
  device?: string;
  scope: string;
};

export type SessionAttachmentView = Omit<SessionAttachment, "connId" | "device"> & {
  connId: string;
};

export function parseSessionAttachMode(raw: unknown): SessionAttachMode | null {
  if (raw === undefined || raw === null) {
    return "interact";
  }
  if (raw === "interact" || raw === "follow" || raw === "pipe") {
    return raw;
  }
  return null;
}

export class SessionAttachRegistry {
  private readonly byKey = new Map<string, Map<string, SessionAttachment>>();
  private readonly byConn = new Map<string, Set<string>>();

  /** Attach (idempotent per connection + key: a re-attach only updates the mode). */
  attach(att: SessionAttachment): { created: boolean; attachment: SessionAttachment } {
    const key = att.key.trim().toLowerCase();
    let conns = this.byKey.get(key);
    if (!conns) {
      conns = new Map();
      this.byKey.set(key, conns);
    }
    const existing = conns.get(att.connId);
    if (existing) {
      existing.mode = att.mode;
      return { created: false, attachment: existing };
    }
    const stored = { ...att, key };
    conns.set(att.connId, stored);
    let keys = this.byConn.get(att.connId);
    if (!keys) {
      keys = new Set();
      this.byConn.set(att.connId, keys);
    }
    keys.add(key);
    return { created: true, attachment: stored };
  }

  detach(connId: string, key: string): SessionAttachment | undefined {
    const normalized = key.trim().toLowerCase();
    const conns = this.byKey.get(normalized);
    const att = conns?.get(connId);
    if (!conns || !att) {
      return undefined;
    }
    conns.delete(connId);
    if (conns.size === 0) {
      this.byKey.delete(normalized);
    }
    const keys = this.byConn.get(connId);
    keys?.delete(normalized);
    if (keys && keys.size === 0) {
      this.byConn.delete(connId);
    }
    return att;
  }

  /** Every attachment of one connection (socket close). */
  detachAll(connId: string): SessionAttachment[] {
    const keys = [...(this.byConn.get(connId) ?? [])];
    const out: SessionAttachment[] = [];
    for (const key of keys) {
      const att = this.detach(connId, key);
      if (att) {
        out.push(att);
      }
    }
    return out;
  }

  attachmentsOf(key: string): SessionAttachment[] {
    return [...(this.byKey.get(key.trim().toLowerCase())?.values() ?? [])];
  }

  keysOf(connId: string): string[] {
    return [...(this.byConn.get(connId) ?? [])];
  }

  isAttached(connId: string, key: string): boolean {
    return this.byConn.get(connId)?.has(key.trim().toLowerCase()) ?? false;
  }

  /** Attached client counts per session key (for discovery rows). */
  counts(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [key, conns] of this.byKey) {
      out.set(key, conns.size);
    }
    return out;
  }

  clear(): void {
    this.byKey.clear();
    this.byConn.clear();
  }
}

let shared: SessionAttachRegistry | null = null;

export function getSessionAttachRegistry(): SessionAttachRegistry {
  if (!shared) {
    shared = new SessionAttachRegistry();
  }
  return shared;
}

export function resetSessionAttachRegistryForTest(): void {
  shared = null;
}

/** Public view of one attachment (no device fingerprint). */
export function attachmentView(att: SessionAttachment): SessionAttachmentView {
  const { device: _device, ...rest } = att;
  return rest;
}
