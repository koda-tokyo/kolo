// Starter policy written by `kolo policy init` (KoLo 2.0, M13d). Documented line by line so a
// security team can read it as the specification it is; every section is optional.
export const STARTER_POLICY_YAML = `# KoLo policy — one declarative file, signed by an owner, enforced for every resident.
# Validate: kolo policy validate      Sign: kolo policy sign      Status: kolo policy status
# Schema:   kolo policy schema        Docs: see docs/policy
version: 1
name: starter
description: Conservative defaults. Agents keep their config permissions; nothing is stopped.

# Per agent (key = agent id glob). Later entries do not override earlier ones: every matching
# entry applies, deny wins over allow, and an allow list restricts to its union.
agents:
  "*":
    # Same syntax as agents.list[].permissions; these take precedence over the config rules.
    # permissions: ["read:**", "write:/workspace/**", "exec:git *"]
    tools:
      deny: []            # e.g. ["process", "gateway"]
      # allow: ["read", "write", "edit", "exec", "web_*", "mcp_*"]
    # providers: ["*"]    # model providers this agent may call
    # models: ["*"]       # provider/model refs
    # channels: ["*"]     # channels it may receive from and send to
    limits:
      maxConcurrentJobs: 4
      wallClockPerJobMs: 1800000

# Spend. Costs use the provider price tables in the config (models.providers[].models[].cost);
# a model without a price counts tokens only. onBreach: warn | pause | stop.
budgets:
  currency: USD
  resetHourUtc: 0
  fleet:
    tokensPerDay: 20000000
    onBreach: warn
  agents:
    "*":
      tokensPerDay: 5000000
      toolCallsPerHour: 1200
      onBreach: warn

# Kill switch. The runtime switch (kolo policy kill) is separate and survives restarts.
kill:
  fleet: false
  agents: []
  mayFlip: [owner, admin]

# Human approvals. Classes: exec | write | read | network | mcp | messaging | tool:<glob>.
approvals:
  # channel: "slack:#ops-approvals"
  timeoutMs: 120000
  require: []

# Egress for tools and MCP servers.
network:
  egress:
    deny: ["169.254.169.254", "metadata.google.internal"]
    # allow: ["*.example.com"]
  mcp:
    deny: []
    # allow: ["docs", "tickets"]

# Data never touched by any tool, and argument patterns that refuse a call.
data:
  neverRead: ["~/.ssh/**", "**/.env", "**/*.pem", "**/id_rsa*"]
  neverWrite: ["~/.ssh/**", "/etc/**"]
  secretPatterns:
    - "-----BEGIN [A-Z ]*PRIVATE KEY-----"
    - "AKIA[0-9A-Z]{16}"
  # Context guard: personal data in tool results becomes [[PII:KIND:n]] placeholders before the
  # model sees it; restoreTo lists tools that get the real values back. Uncomment to enable.
  # redact:
  #   fields: ["@personal"]
  #   restoreTo: ["message"]

# HTTP operationIds / WS methods refused for a credential scope.
requests:
  deny: []

# Attestation: with required true (the default) an unsigned policy is refused in enforce mode.
attestation:
  required: true
`;
