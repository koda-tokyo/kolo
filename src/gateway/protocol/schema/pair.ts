// WebSocket method params for pairing credentials (KoLo 2.0, M3a). Same semantics as the
// HTTP routes under /api/pair; see src/gateway/pair-store.ts.
import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const PairScopeSchema = Type.Union([
  Type.Literal("observe"),
  Type.Literal("attach"),
  Type.Literal("admin"),
]);

export const PairNonceParamsSchema = Type.Object({}, { additionalProperties: false });

export const PairRedeemParamsSchema = Type.Object(
  {
    code: NonEmptyString,
    deviceKeyPub: NonEmptyString,
    deviceName: Type.Optional(Type.String({ maxLength: 80 })),
    nonce: NonEmptyString,
    signature: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PairRefreshParamsSchema = Type.Object(
  {
    refreshToken: NonEmptyString,
    nonce: NonEmptyString,
    signature: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PairMeParamsSchema = Type.Object({}, { additionalProperties: false });

export const PairInviteParamsSchema = Type.Object(
  {
    scope: PairScopeSchema,
    ttlMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })),
    label: Type.Optional(Type.String({ maxLength: 80 })),
    autoApprove: Type.Optional(Type.Boolean()),
    /** M3b: session allowlist (globs over session keys, bare agent ids, `label:<x>`). */
    sessions: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 32 }),
    ),
  },
  { additionalProperties: false },
);

export const PairListParamsSchema = Type.Object({}, { additionalProperties: false });

export const PairDevicesParamsSchema = Type.Object({}, { additionalProperties: false });

export const PairApproveParamsSchema = Type.Object(
  { fingerprint: NonEmptyString },
  { additionalProperties: false },
);

export const PairRevokeParamsSchema = Type.Object(
  {
    fingerprint: Type.Optional(NonEmptyString),
    invitationId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
