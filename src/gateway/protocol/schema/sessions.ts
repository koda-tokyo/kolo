import { Type } from "@sinclair/typebox";
import { NonEmptyString, SessionLabelString } from "./primitives.js";

export const SessionsListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    activeMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
    /**
     * Read first 8KB of each session transcript to derive title from first user message.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeDerivedTitles: Type.Optional(Type.Boolean()),
    /**
     * Read last 16KB of each session transcript to extract most recent message preview.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeLastMessage: Type.Optional(Type.Boolean()),
    label: Type.Optional(SessionLabelString),
    spawnedBy: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    search: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsPreviewParamsSchema = Type.Object(
  {
    keys: Type.Array(NonEmptyString, { minItems: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 20 })),
  },
  { additionalProperties: false },
);

export const SessionsResolveParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    sessionId: Type.Optional(NonEmptyString),
    label: Type.Optional(SessionLabelString),
    agentId: Type.Optional(NonEmptyString),
    spawnedBy: Type.Optional(NonEmptyString),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SessionsPatchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    label: Type.Optional(Type.Union([SessionLabelString, Type.Null()])),
    thinkingLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    verboseLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    reasoningLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    reasoningView: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("collapsed"),
        Type.Literal("expanded"),
        Type.Null(),
      ]),
    ),
    responseUsage: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("tokens"),
        Type.Literal("full"),
        // Backward compat with older clients/stores.
        Type.Literal("on"),
        Type.Null(),
      ]),
    ),
    elevatedLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execHost: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execSecurity: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execAsk: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execNode: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    model: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnedBy: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    sendPolicy: Type.Optional(
      Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Null()]),
    ),
    groupActivation: Type.Optional(
      Type.Union([Type.Literal("mention"), Type.Literal("always"), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsResetParamsSchema = Type.Object(
  { key: NonEmptyString },
  { additionalProperties: false },
);

export const SessionsDeleteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    deleteTranscript: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SessionsCompactParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    maxLines: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

// ── M3b: discovery and attach ───────────────────────────────────────────────────────────────

export const SessionsDiscoverParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
    search: Type.Optional(Type.String()),
    activeMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    includeGlobal: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

export const SessionDiscoveryRowSchema = Type.Object(
  {
    id: Type.String(),
    key: Type.String(),
    agent: Type.String(),
    kind: Type.Union([
      Type.Literal("direct"),
      Type.Literal("group"),
      Type.Literal("global"),
      Type.Literal("unknown"),
    ]),
    label: Type.Optional(Type.String()),
    displayName: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    started: Type.Union([Type.String(), Type.Null()]),
    lastActivity: Type.Union([Type.String(), Type.Null()]),
    clients: Type.Integer(),
    state: Type.Union([Type.Literal("running"), Type.Literal("idle")]),
  },
  { additionalProperties: false },
);

export const SessionsDiscoverResultSchema = Type.Object(
  {
    ts: Type.Number(),
    count: Type.Integer(),
    sessions: Type.Array(SessionDiscoveryRowSchema),
  },
  { additionalProperties: false },
);

export const SessionAttachModeSchema = Type.Union([
  Type.Literal("interact"),
  Type.Literal("follow"),
  Type.Literal("pipe"),
]);

/**
 * Attach to one session: by `key` (session key, session id, label or agent id), or by the
 * outbound route of a messaging target (`channel` + `to`), which the gateway resolves to the
 * agent session that conversation belongs to (used by the LINE/WhatsApp pipes).
 */
export const SessionAttachParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    channel: Type.Optional(NonEmptyString),
    to: Type.Optional(NonEmptyString),
    accountId: Type.Optional(NonEmptyString),
    mode: Type.Optional(SessionAttachModeSchema),
  },
  { additionalProperties: false },
);

export const SessionAttachmentSchema = Type.Object(
  {
    connId: Type.String(),
    key: Type.String(),
    mode: SessionAttachModeSchema,
    since: Type.String(),
    client: Type.Object(
      {
        id: Type.String(),
        mode: Type.Optional(Type.String()),
        displayName: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    identity: Type.String(),
    scope: Type.String(),
  },
  { additionalProperties: false },
);

export const SessionAttachResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    attached: Type.Boolean(),
    session: Type.Intersect([
      SessionDiscoveryRowSchema,
      Type.Object({ attachments: Type.Array(SessionAttachmentSchema) }),
    ]),
  },
  { additionalProperties: false },
);

export const SessionDetachParamsSchema = Type.Object(
  { key: Type.Optional(NonEmptyString) },
  { additionalProperties: false },
);

export const SessionDetachResultSchema = Type.Object(
  { ok: Type.Literal(true), detached: Type.Array(Type.String()) },
  { additionalProperties: false },
);
