---
summary: "Three starter policies: hospital-safe, trading-desk, manufacturing-floor"
read_when:
  - You want a policy to start from for a regulated or industrial fleet
title: "Policy examples"
---

# Policy examples

Copy one to `<KOLO_HOME>/policy/policy.yaml`, edit the agent ids, hosts and channels, then
`kurahi policy validate && kurahi policy sign`. The raw files are in `docs/policy/examples/`.
See [Policy](/policy) for every field.

## Hospital-safe

No execution, record systems only, patient data paths never read by tools, every outbound message
approved by a person, daily spend that pauses rather than stops a shift.

```yaml
# Hospital-safe starter policy. Residents answer staff questions, draft notes and summarise
# records; they execute nothing, reach only the record systems, never read patient files
# directly, and a person approves every message to a care channel.
version: 1
name: hospital-safe
description: Clinical assistants with no execution, record systems only, human-approved outbound messages.

agents:
  "*":
    tools:
      deny: [exec, process, browser, gateway, nodes, cron, kip_engine_task]
      allow: [read, memory_*, sessions_*, session_status, web_fetch, message, mcp_*, agents_list]
    permissions:
      - "read:/workspace/**"
      - "write:/workspace/drafts/**"
    channels: [slack, web]
    limits:
      maxConcurrentJobs: 2
      wallClockPerJobMs: 600000
      maxSteps: 60

budgets:
  currency: USD
  resetHourUtc: 0
  fleet:
    tokensPerDay: 10000000
    costPerDay: 150
    onBreach: pause
  agents:
    "*":
      tokensPerDay: 1500000
      costPerDay: 25
      toolCallsPerHour: 300
      onBreach: pause

kill:
  fleet: false
  agents: []
  mayFlip: [owner, admin]

approvals:
  channel: "slack:#care-approvals"
  timeoutMs: 300000
  require:
    - class: messaging # every message a resident sends is approved by a person
    - class: write # drafts too

network:
  egress:
    allow: ["ehr.internal.example", "labs.internal.example", "docs.internal.example"]
    deny: ["169.254.169.254"]
  mcp:
    allow: [ehr, labs]

data:
  neverRead:
    - "/data/patients/**"
    - "**/*.dcm"
    - "**/*.hl7"
    - "~/.ssh/**"
    - "**/.env"
  neverWrite:
    - "/data/**"
    - "/etc/**"
  secretPatterns:
    - "-----BEGIN [A-Z ]*PRIVATE KEY-----"
    - "\\b[0-9]{3}-[0-9]{2}-[0-9]{4}\\b" # SSN-shaped
    - "\\bMRN[:# ]?[0-9]{6,}\\b" # medical record numbers

requests:
  deny:
    - operations: [runCodeMode, "codeMode.*", invokeTool, "node.invoke"]
      scopes: [attach, observe]

attestation:
  required: true
```

## Trading desk

One provider and model family, order execution behind an approval, a hard `stop` on cost, the kill
switch flippable by the owner only, Code Mode denied to paired devices.

```yaml
# Trading-desk starter policy. Research agents on one provider and model family, the
# order-execution MCP server behind a human approval, a hard stop on daily cost, the kill switch
# in the owner's hands only, and no Code Mode from paired devices.
version: 1
name: trading-desk
description: Research and execution assistants with one model family, approved order execution and a hard cost stop.

agents:
  "*":
    providers: [acme]
    models: ["acme/large-*"]
    tools:
      deny: [exec, process, browser, gateway, nodes, cron]
    channels: [slack]
    limits:
      maxConcurrentJobs: 3
      wallClockPerJobMs: 900000
  "research-*":
    permissions:
      - "read:**"
      - "write:/workspace/research/**"
    tools:
      deny: [mcp_orders_*]
  "exec-*":
    permissions:
      - "read:/workspace/**"
      - "write:/workspace/blotter/**"

budgets:
  currency: USD
  resetHourUtc: 21 # desk day rolls over after the close (UTC)
  fleet:
    tokensPerDay: 30000000
    costPerDay: 600
    onBreach: stop
  agents:
    "research-*":
      tokensPerDay: 4000000
      costPerDay: 80
      onBreach: pause
    "exec-*":
      tokensPerDay: 500000
      costPerDay: 20
      toolCallsPerHour: 120
      onBreach: stop

kill:
  fleet: false
  agents: []
  mayFlip: [owner]

approvals:
  channel: "slack:#desk-approvals"
  timeoutMs: 120000
  require:
    - class: "tool:mcp_orders_*" # every order goes past a person
      agents: ["exec-*"]
    - class: network
      agents: ["exec-*"]

network:
  egress:
    allow: ["marketdata.internal.example", "oms.internal.example", "*.acme.example"]
    deny: ["169.254.169.254"]
  mcp:
    allow: [marketdata, orders, docs]

data:
  neverRead: ["~/.ssh/**", "**/.env", "/vault/**", "**/*.pem"]
  neverWrite: ["/etc/**", "/vault/**", "/workspace/blotter/settled/**"]
  secretPatterns:
    - "-----BEGIN [A-Z ]*PRIVATE KEY-----"
    - "AKIA[0-9A-Z]{16}"
    - "\\bapi[_-]?key\\b\\s*[:=]\\s*[A-Za-z0-9_-]{16,}"

requests:
  deny:
    - operations: [runCodeMode, "codeMode.*"]
      scopes: [attach, observe]
    - operations: ["config.*", "plugins.reload", reloadPlugin]
      scopes: [admin]

attestation:
  required: true
```

## Manufacturing floor

Line agents limited to the historian and ticketing servers, writes only inside the shift workspace,
short jobs with wall-clock caps, egress denied to the control network.

```yaml
# Manufacturing-floor starter policy. Line agents read the historian and raise tickets; they
# write only inside the shift workspace, run short jobs with a wall-clock cap, and never reach
# the control network. Maintenance agents may run a fixed set of diagnostics with approval.
version: 1
name: manufacturing-floor
description: Line and maintenance assistants limited to the historian and ticketing systems, short jobs, no control-network egress.

agents:
  "*":
    tools:
      deny: [browser, gateway, nodes, cron, kip_engine_task]
    channels: [telegram, web]
    limits:
      maxConcurrentJobs: 2
      wallClockPerJobMs: 300000
      maxSteps: 40
  "line-*":
    permissions:
      - "read:/workspace/shift/**"
      - "write:/workspace/shift/**"
    tools:
      deny: [exec, process]
    providers: [local]
  "maint-*":
    permissions:
      - "read:/workspace/**"
      - "write:/workspace/maint/**"
      - "exec:diag-*"
      - "exec:plc-status *"

budgets:
  currency: EUR
  resetHourUtc: 4 # before the morning shift
  fleet:
    tokensPerDay: 8000000
    costPerDay: 120
    onBreach: pause
  agents:
    "line-*":
      tokensPerDay: 400000
      toolCallsPerHour: 200
      wallClockPerJobMs: 180000
      onBreach: pause
    "maint-*":
      tokensPerDay: 1500000
      costPerDay: 40
      onBreach: warn

kill:
  fleet: false
  agents: []
  mayFlip: [owner, admin]

approvals:
  channel: "telegram:-1001234567890"
  timeoutMs: 180000
  require:
    - class: exec
      agents: ["maint-*"]

network:
  egress:
    allow: ["historian.plant.example", "tickets.plant.example", "docs.plant.example"]
    deny: ["10.10.0.0/16", "plc-*", "scada-*", "169.254.169.254"]
  mcp:
    allow: [historian, tickets]
    deny: [plc]

data:
  neverRead: ["/plc/**", "/scada/**", "~/.ssh/**", "**/.env"]
  neverWrite: ["/plc/**", "/scada/**", "/etc/**", "/workspace/shift/signed-off/**"]
  secretPatterns:
    - "-----BEGIN [A-Z ]*PRIVATE KEY-----"

requests:
  deny:
    - operations: [runCodeMode, "codeMode.*", "node.invoke"]
      scopes: [attach, observe]

attestation:
  required: true
```
