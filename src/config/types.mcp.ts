// MCP client configuration (KoLo 2.0, M6).
//
//   mcp.servers.<id> = {
//     transport: "stdio" | "http",
//     command, args?, env?, cwd?      (stdio)
//     url, headers?                   (http: streamable HTTP; header values may be {"$secret": name})
//     enabled?: boolean               (default true)
//     allowTools?: string[]           (globs over tool names; exec-like tools need an explicit match)
//     timeoutMs?: number              (per request; default 30 000)
//   }

export type McpTransportKind = "stdio" | "http";

export type McpServerConfig = {
  transport: McpTransportKind;
  /** stdio: executable to spawn (never a shell line). */
  command?: string;
  args?: string[];
  /** stdio: environment for the child; merged over a minimal default environment. */
  env?: Record<string, string>;
  cwd?: string;
  /** http: streamable-HTTP endpoint. */
  url?: string;
  /** http: extra request headers; a value may be a `{"$secret": "<name>"}` reference. */
  headers?: Record<string, string>;
  enabled?: boolean;
  /**
   * Globs over the server's tool names. Absent: every tool except exec-like ones (exec, shell,
   * run, write, delete …) is exposed; exec-like tools need an explicit matching glob.
   */
  allowTools?: string[];
  /** Per-request timeout in ms (default 30 000). */
  timeoutMs?: number;
};

export type McpConfig = {
  servers?: Record<string, McpServerConfig>;
};
