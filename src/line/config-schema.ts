import { z } from "zod";
import {
  ChannelIdentitiesSchema,
  ChannelLocaleSchema,
} from "../config/zod-schema.channels-resident.js";

const DmPolicySchema = z.enum(["open", "allowlist", "pairing", "disabled"]);
const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);

const LineGroupConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    systemPrompt: z.string().optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict();

const LineAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    channelAccessToken: z.string().optional(),
    channelSecret: z.string().optional(),
    tokenFile: z.string().optional(),
    secretFile: z.string().optional(),
    name: z.string().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    mediaMaxMb: z.number().optional(),
    webhookPath: z.string().optional(),
    // Route inbound messages into an existing agent session (e.g. "agent:alice:main")
    // instead of spawning an isolated per-conversation session. Replies still go back
    // out via LINE (OriginatingChannel/OriginatingTo are preserved on the inbound ctx).
    routeToSession: z.string().optional(),
    identities: ChannelIdentitiesSchema.optional(),
    locale: ChannelLocaleSchema.optional(),
    groups: z.record(z.string(), LineGroupConfigSchema.optional()).optional(),
  })
  .strict();

export const LineConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    channelAccessToken: z.string().optional(),
    channelSecret: z.string().optional(),
    tokenFile: z.string().optional(),
    secretFile: z.string().optional(),
    name: z.string().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    mediaMaxMb: z.number().optional(),
    webhookPath: z.string().optional(),
    // Route inbound messages into an existing agent session (e.g. "agent:alice:main")
    // instead of spawning an isolated per-conversation session. Replies still go back
    // out via LINE (OriginatingChannel/OriginatingTo are preserved on the inbound ctx).
    routeToSession: z.string().optional(),
    identities: ChannelIdentitiesSchema.optional(),
    locale: ChannelLocaleSchema.optional(),
    accounts: z.record(z.string(), LineAccountConfigSchema.optional()).optional(),
    groups: z.record(z.string(), LineGroupConfigSchema.optional()).optional(),
  })
  .strict();

export type LineConfigSchemaType = z.infer<typeof LineConfigSchema>;
