// Zod fragments for channel-native residents (KoLo 2.0, M14). Shared by the core channel
// schemas, the LINE extension schema and the `channels` block itself.
import { z } from "zod";

export const ChannelIdentityRoleSchema = z.enum(["owner", "admin", "attach"]);
export const ChannelIdentitiesSchema = z.record(z.string(), ChannelIdentityRoleSchema);
export const ChannelLocaleSchema = z.enum(["en", "ja", "pt"]);
export const ChannelSessionModeSchema = z.enum(["per-conversation", "shared"]);

export const ChannelsInboxSchema = z
  .object({
    maxFileBytes: z.number().int().min(1024).max(2_147_483_647).optional(),
    maxFilesPerMessage: z.number().int().min(1).max(64).optional(),
    retentionDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

export const ChannelsDeliverySchema = z
  .object({
    maxRetries: z.number().int().min(0).max(20).optional(),
    backoffMs: z.number().int().min(0).max(3_600_000).optional(),
    maxBackoffMs: z.number().int().min(0).max(3_600_000).optional(),
    dedupeTtlMs: z.number().int().min(0).max(86_400_000).optional(),
    policy: z.enum(["human-triggered", "allow-automated", "replies-only"]).optional(),
    replyWindowMs: z
      .number()
      .int()
      .min(0)
      .max(7 * 86_400_000)
      .optional(),
  })
  .strict();

export const ChannelsApprovalsSchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            channel: z.string().min(1),
            to: z.string().min(1),
            accountId: z.string().optional(),
            threadId: z.union([z.string(), z.number()]).optional(),
          })
          .strict(),
      )
      .optional(),
    identities: z.array(z.string()).optional(),
  })
  .strict();

const WebhookAccountShape = {
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  outboundUrl: z.string().url().optional(),
  outboundToken: z.string().optional(),
  allowFrom: z.array(z.string()).optional(),
  textChunkLimit: z.number().int().positive().optional(),
  sessionMode: ChannelSessionModeSchema.optional(),
  identities: ChannelIdentitiesSchema.optional(),
  locale: ChannelLocaleSchema.optional(),
};

export const WebhookChannelSchema = z
  .object({
    ...WebhookAccountShape,
    accounts: z.record(z.string(), z.object(WebhookAccountShape).strict().optional()).optional(),
  })
  .strict();

/** Keys added to the `channels` block itself. */
export const ChannelsResidentShape = {
  sessionMode: ChannelSessionModeSchema.optional(),
  locale: ChannelLocaleSchema.optional(),
  inbox: ChannelsInboxSchema.optional(),
  delivery: ChannelsDeliverySchema.optional(),
  approvals: ChannelsApprovalsSchema.optional(),
  webhook: WebhookChannelSchema.optional(),
};
