// WS `codeMode.run` (KoLo 2.0, M6): same contract as POST /api/code-mode/run.
import { Type } from "@sinclair/typebox";

export const CodeModeRunParamsSchema = Type.Object(
  {
    script: Type.String({ minLength: 1 }),
    language: Type.Optional(Type.Union([Type.Literal("js"), Type.Literal("ts")])),
    sessionKey: Type.Optional(Type.String()),
    allowTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 256 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600_000 })),
    maxToolCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
  },
  { additionalProperties: false },
);

export const CodeModeCallSchema = Type.Object(
  {
    seq: Type.Integer(),
    tool: Type.String(),
    ok: Type.Boolean(),
    ms: Type.Integer(),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CodeModeRunResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    runId: Type.String(),
    value: Type.Optional(Type.Unknown()),
    error: Type.Optional(
      Type.Object(
        {
          code: Type.String(),
          message: Type.String(),
          stack: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    calls: Type.Array(CodeModeCallSchema),
    toolCalls: Type.Integer(),
    logs: Type.Array(
      Type.Object({ level: Type.String(), text: Type.String() }, { additionalProperties: false }),
    ),
    logsTruncated: Type.Boolean(),
    durationMs: Type.Integer(),
    tools: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
