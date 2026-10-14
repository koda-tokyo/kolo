import type { WebSocket } from "ws";
import type { PairPrincipal } from "../pair-store.js";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  /** Set when the connection authenticated with a pairing access token (M3a). */
  pairing?: PairPrincipal;
};
