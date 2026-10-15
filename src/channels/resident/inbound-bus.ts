// Inbound channel events (KoLo 2.0, M14a): every message a channel hands to the resident is
// announced here before the agent runs. The gateway subscribes once and broadcasts
// `channel.inbound` to attached clients, so `kurahi attach` and the TUI show the person's side of
// the conversation in real time, with channel and sender metadata. No listener: nothing happens.

export type ChannelInboundEvent = {
  channel: string;
  accountId?: string;
  sessionKey: string;
  agentId?: string;
  messageId?: string;
  sender: { id?: string; name?: string; role?: string };
  conversation: { id?: string; label?: string; type?: string };
  text: string;
  attachments: Array<{ path: string; size: number; name: string }>;
  /** Unix ms. */
  ts: number;
};

type Listener = (evt: ChannelInboundEvent) => void;

const listeners = new Set<Listener>();

export function onChannelInbound(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitChannelInbound(evt: ChannelInboundEvent): void {
  for (const listener of listeners) {
    try {
      listener(evt);
    } catch {
      // Observers never break the inbound path.
    }
  }
}

export function hasChannelInboundListeners(): boolean {
  return listeners.size > 0;
}

export function resetChannelInboundListenersForTest(): void {
  listeners.clear();
}
