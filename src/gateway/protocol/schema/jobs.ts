import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const JobStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("loop_stopped"),
  Type.Literal("denied"),
]);

export const JobRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    agent: Type.String(),
    sessionKey: Type.String(),
    kind: Type.String(),
    status: JobStatusSchema,
    steps: Type.Integer({ minimum: 0 }),
    toolCalls: Type.Integer({ minimum: 0 }),
    startedAt: Type.String(),
    endedAt: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    parentJobId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const JobsListParamsSchema = Type.Object(
  {
    agent: Type.Optional(NonEmptyString),
    status: Type.Optional(JobStatusSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

export const JobsListResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    jobs: Type.Array(JobRecordSchema),
  },
  { additionalProperties: false },
);

export const JobsGetParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const JobsGetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    job: JobRecordSchema,
  },
  { additionalProperties: false },
);

export const JobsCancelParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const JobsCancelResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    job: Type.Optional(JobRecordSchema),
    reason: Type.Optional(
      Type.Union([Type.Literal("not_found"), Type.Literal("already_finished")]),
    ),
  },
  { additionalProperties: false },
);

export const JobCompletedEventSchema = JobRecordSchema;
