import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { validateJsonSchemaValue } from "../plugins/schema-validator.js";
// Policy document schema (KoLo 2.0, M13a). One declarative file a security team can read,
// version and attest; the runtime enforces it for every resident on the gateway.
//
// Keys of `agents`, `budgets.agents` are agent-id globs (`*`, `trading-*`). Lists of tools,
// providers, models, channels, hosts and operations are globs too. A rule id is the path of the
// clause that decided (`agents[trading-*].tools.deny`), so an audit line points back into the
// file that was signed.
import { validateRedactRules } from "./redact.js";

export const POLICY_VERSION = 1;

const Glob = Type.String({ minLength: 1, description: "Glob (`*`, `**`, `?`)." });
const GlobList = (description: string) => Type.Array(Glob, { description });

const BreachAction = Type.Union(
  [Type.Literal("warn"), Type.Literal("pause"), Type.Literal("stop")],
  {
    description:
      "warn: allow and audit; pause: refuse until release or the next window; stop: refuse (deny).",
  },
);

const AgentLimits = Type.Object(
  {
    maxSteps: Type.Optional(Type.Integer({ minimum: 1, description: "Tool steps per job." })),
    maxConcurrentJobs: Type.Optional(Type.Integer({ minimum: 1 })),
    wallClockPerJobMs: Type.Optional(Type.Integer({ minimum: 1000 })),
  },
  { additionalProperties: false },
);

const ToolRules = Type.Object(
  {
    allow: Type.Optional(GlobList("When present, only tools matching one of these may run.")),
    deny: Type.Optional(GlobList("Tools matching one of these never run; deny wins over allow.")),
  },
  { additionalProperties: false },
);

export const AgentPolicySchema = Type.Object(
  {
    permissions: Type.Optional(
      Type.Array(Type.String({ minLength: 3 }), {
        description:
          "`class:pattern` rules (read | write | exec), the same syntax as agents.list[].permissions; these take precedence over the config rules.",
      }),
    ),
    tools: Type.Optional(ToolRules),
    providers: Type.Optional(GlobList("Model providers this agent may call (absent = any).")),
    models: Type.Optional(GlobList("`provider/model` refs this agent may call (absent = any).")),
    channels: Type.Optional(GlobList("Channels this agent may receive from and send to.")),
    limits: Type.Optional(AgentLimits),
    reasoning: Type.Optional(
      Type.Object(
        {
          expose: Type.Optional(
            Type.Boolean({
              description:
                "false: the agent's reasoning never leaves the gateway (overrides the config).",
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type AgentPolicy = Static<typeof AgentPolicySchema>;

const BudgetLimits = Type.Object(
  {
    tokensPerDay: Type.Optional(Type.Integer({ minimum: 1 })),
    costPerDay: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    toolCallsPerHour: Type.Optional(Type.Integer({ minimum: 1 })),
    wallClockPerJobMs: Type.Optional(Type.Integer({ minimum: 1000 })),
    onBreach: Type.Optional(BreachAction),
  },
  { additionalProperties: false },
);
export type BudgetLimits = Static<typeof BudgetLimits>;

export const BudgetsSchema = Type.Object(
  {
    currency: Type.Optional(
      Type.String({
        minLength: 3,
        maxLength: 3,
        description: "ISO 4217 code the cost figures are in (price tables are per provider).",
      }),
    ),
    resetHourUtc: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 23, description: "Daily window start (UTC hour)." }),
    ),
    fleet: Type.Optional(BudgetLimits),
    agents: Type.Optional(Type.Record(Type.String(), BudgetLimits)),
  },
  { additionalProperties: false },
);

export const KillSchema = Type.Object(
  {
    fleet: Type.Optional(Type.Boolean({ description: "true: every agent is stopped." })),
    agents: Type.Optional(GlobList("Agent ids (globs) stopped by the document itself.")),
    mayFlip: Type.Optional(
      Type.Array(Type.Union([Type.Literal("owner"), Type.Literal("admin")]), {
        description: "Who may flip the runtime switch (default owner and admin).",
      }),
    ),
  },
  { additionalProperties: false },
);

const ApprovalClass = Type.String({
  minLength: 1,
  description: "exec | write | read | network | mcp | messaging | tool:<glob>",
});

export const ApprovalsSchema = Type.Object(
  {
    channel: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Where a human is asked (`<channel>:<target>`, e.g. `slack:#ops-approvals`).",
      }),
    ),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3_600_000 })),
    require: Type.Optional(
      Type.Array(
        Type.Object(
          {
            class: ApprovalClass,
            agents: Type.Optional(GlobList("Agents the rule applies to (default all).")),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

export const NetworkSchema = Type.Object(
  {
    egress: Type.Optional(
      Type.Object(
        {
          allow: Type.Optional(GlobList("Hosts tools may reach (absent = any).")),
          deny: Type.Optional(GlobList("Hosts tools never reach.")),
        },
        { additionalProperties: false },
      ),
    ),
    mcp: Type.Optional(
      Type.Object(
        {
          allow: Type.Optional(GlobList("MCP server ids whose tools may run (absent = any).")),
          deny: Type.Optional(GlobList("MCP server ids whose tools never run.")),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const RedactSchema = Type.Object(
  {
    detectors: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "Built-in detectors: email, phone, jp-my-number, br-cpf, br-cnpj, credit-card, jp-postal, ip (default: all but ip).",
      }),
    ),
    fields: Type.Optional(
      GlobList(
        'JSON keys whose values are masked; "@personal" adds common name/address/birth-date keys (EN, JA, PT).',
      ),
    ),
    patterns: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 40 }),
            regex: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        { description: "Extra detectors: a name and a regular expression." },
      ),
    ),
    agents: Type.Optional(GlobList("Agents the guard applies to (default all).")),
    tools: Type.Optional(
      GlobList("Tools whose results are guarded (default all); mcp:<server>/<tool> for MCP."),
    ),
    exceptTools: Type.Optional(GlobList("Tools whose results are never guarded.")),
    restoreTo: Type.Optional(
      GlobList(
        "Tools whose arguments get the real values back in place of placeholders (default none).",
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Context guard: personal data in tool results is replaced with placeholders before the model sees it.",
  },
);

export const DataSchema = Type.Object(
  {
    neverRead: Type.Optional(GlobList("Path globs no tool may read.")),
    neverWrite: Type.Optional(GlobList("Path globs no tool may write.")),
    secretPatterns: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Regular expressions; a tool call whose arguments match is refused.",
      }),
    ),
    redact: Type.Optional(RedactSchema),
  },
  { additionalProperties: false },
);

export const RequestsSchema = Type.Object(
  {
    deny: Type.Optional(
      Type.Array(
        Type.Object(
          {
            operations: GlobList("HTTP operationIds or WS methods (globs)."),
            scopes: Type.Optional(GlobList("Credential scopes the rule applies to (default all).")),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

export const AttestationSchema = Type.Object(
  {
    required: Type.Optional(
      Type.Boolean({ description: "false lets an unsigned document load in enforce mode." }),
    ),
    owners: Type.Optional(
      Type.Array(Type.String({ minLength: 32 }), {
        description: "Additional trusted owner public keys (base64url raw Ed25519).",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ShieldSchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([Type.Literal("stop"), Type.Literal("alert"), Type.Literal("off")], {
        description:
          "stop (default): a detection stops every agent; alert: audit and log only; off.",
      }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Extra folders to watch, besides the state directory and agent workspaces.",
      }),
    ),
    canaries: Type.Optional(
      Type.Boolean({ description: "Plant a decoy file in each watched folder (default true)." }),
    ),
    rewrites: Type.Optional(
      Type.Integer({
        minimum: 3,
        maximum: 1000,
        description: "Suspicious rewrites that trigger (default 12).",
      }),
    ),
    windowSeconds: Type.Optional(
      Type.Integer({ minimum: 10, maximum: 3600, description: "Sliding window (default 60)." }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Ransomware shield: decoy files and mass-encryption detection that stop every agent.",
  },
);

export const PolicyDocumentSchema = Type.Object(
  {
    version: Type.Literal(POLICY_VERSION),
    name: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String()),
    agents: Type.Optional(Type.Record(Type.String(), AgentPolicySchema)),
    budgets: Type.Optional(BudgetsSchema),
    kill: Type.Optional(KillSchema),
    approvals: Type.Optional(ApprovalsSchema),
    network: Type.Optional(NetworkSchema),
    data: Type.Optional(DataSchema),
    requests: Type.Optional(RequestsSchema),
    attestation: Type.Optional(AttestationSchema),
    shield: Type.Optional(ShieldSchema),
  },
  {
    additionalProperties: false,
    $id: "https://kolo.dev/schemas/policy-v1.json",
    title: "Kurahi policy document",
  },
);
export type PolicyDocument = Static<typeof PolicyDocumentSchema>;

/** The JSON Schema `kurahi policy schema` prints (and editors can validate against). */
export function policyJsonSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...(PolicyDocumentSchema as unknown as Record<string, unknown>),
  };
}

export type PolicyValidation =
  | { ok: true; policy: PolicyDocument; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Structural validation plus the semantic checks a schema cannot express. */
export function validatePolicyDocument(raw: unknown): PolicyValidation {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ["policy must be a mapping with `version: 1`"], warnings };
  }
  const structural = validateJsonSchemaValue({
    schema: PolicyDocumentSchema as unknown as Record<string, unknown>,
    cacheKey: "policy-v1",
    value: raw,
  });
  if (!structural.ok) {
    return { ok: false, errors: structural.errors, warnings };
  }
  const policy = raw as PolicyDocument;
  const errors: string[] = [];
  for (const [i, pattern] of (policy.data?.secretPatterns ?? []).entries()) {
    try {
      new RegExp(pattern);
    } catch (err) {
      errors.push(`data.secretPatterns[${i}]: invalid regular expression (${String(err)})`);
    }
  }
  if (policy.data?.redact) {
    errors.push(...validateRedactRules(policy.data.redact));
  }
  for (const [agent, entry] of Object.entries(policy.agents ?? {})) {
    for (const [i, rule] of (entry.permissions ?? []).entries()) {
      const colon = rule.indexOf(":");
      const ruleClass = colon > 0 ? rule.slice(0, colon).trim().toLowerCase() : "";
      if (!["read", "write", "exec"].includes(ruleClass) || colon === rule.length - 1) {
        errors.push(
          `agents[${agent}].permissions[${i}]: expected "read|write|exec:<pattern>", got "${rule}"`,
        );
      }
    }
    if (entry.tools?.allow && entry.tools.allow.length === 0) {
      warnings.push(`agents[${agent}].tools.allow is empty: no tool may run for this agent`);
    }
  }
  for (const [i, rule] of (policy.approvals?.require ?? []).entries()) {
    const cls = rule.class;
    const known = ["exec", "write", "read", "network", "mcp", "messaging"];
    if (!known.includes(cls) && !cls.startsWith("tool:")) {
      errors.push(`approvals.require[${i}].class: unknown class "${cls}"`);
    }
  }
  if ((policy.approvals?.require?.length ?? 0) > 0 && !policy.approvals?.channel) {
    warnings.push(
      "approvals.require is set but approvals.channel is not: asks go to attached operators only",
    );
  }
  const checkBudget = (label: string, limits: BudgetLimits | undefined) => {
    if (!limits) {
      return;
    }
    if (limits.costPerDay !== undefined && !policy.budgets?.currency) {
      warnings.push(`${label}.costPerDay is set without budgets.currency (USD assumed)`);
    }
  };
  checkBudget("budgets.fleet", policy.budgets?.fleet);
  for (const [agent, limits] of Object.entries(policy.budgets?.agents ?? {})) {
    checkBudget(`budgets.agents[${agent}]`, limits);
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, policy, warnings };
}

export const __schemas: Record<string, TSchema> = {
  PolicyDocumentSchema,
  AgentPolicySchema,
  BudgetsSchema,
  KillSchema,
  ApprovalsSchema,
  NetworkSchema,
  DataSchema,
  RedactSchema,
  ShieldSchema,
  RequestsSchema,
  AttestationSchema,
};
