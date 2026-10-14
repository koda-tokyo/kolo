// src/consciousness/transport/index.ts
//
// Transport factory — creates the right transport based on configuration.

import type { Transport, TransportConfig } from "./types.js";
import { FileTransport } from "./file-transport.js";
import { SupabaseTransport } from "./supabase-transport.js";

export type { Transport, TransportConfig } from "./types.js";
export { FileTransport } from "./file-transport.js";
export { SupabaseTransport } from "./supabase-transport.js";
export { SupabaseRealtimeTransport } from "./supabase-realtime.js";

/**
 * Create a transport instance from configuration.
 *
 * @example
 *   const transport = createTransport({ type: "file", teamName: "kolo-team" });
 *   const transport = createTransport({ type: "supabase", teamName: "kolo-team", supabaseUrl: "...", supabaseKey: "..." });
 */
export function createTransport(config: TransportConfig): Transport {
  switch (config.type) {
    case "file":
      return new FileTransport(config.teamName, config.baseDir);

    case "supabase":
      if (!config.supabaseUrl || !config.supabaseKey) {
        throw new Error("SupabaseTransport requires supabaseUrl and supabaseKey");
      }
      return new SupabaseTransport({
        teamName: config.teamName,
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      });

    default:
      // Default to file transport for safety
      console.warn(`[transport] Unknown type "${config.type}", falling back to file`);
      return new FileTransport(config.teamName, config.baseDir);
  }
}
