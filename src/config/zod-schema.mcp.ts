// Zod schema for `mcp` (KoLo 2.0, M6). Header values are strings; a `{"$secret": name}` ref is
// replaced by a placeholder string before validation (src/secrets/resolve.ts), so it fits here.
import { z } from "zod";

const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const McpServerSchema = z
  .object({
    transport: z.union([z.literal("stdio"), z.literal("http")]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    allowTools: z.array(z.string().min(1)).max(256).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === "stdio" && !server.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "stdio servers need `command`.",
      });
    }
    if (server.transport === "http" && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "http servers need `url`.",
      });
    }
    if (server.transport === "http" && server.url && !/^https?:\/\//i.test(server.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "`url` must be http(s).",
      });
    }
  });

export const McpSchema = z
  .object({
    servers: z
      .record(
        z.string().regex(SERVER_ID, "server ids: lowercase letters, digits, _ or -"),
        McpServerSchema,
      )
      .optional(),
  })
  .strict();
