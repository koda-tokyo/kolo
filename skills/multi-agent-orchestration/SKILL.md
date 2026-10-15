# Multi-Agent Orchestration — Routing, Handoff, Consensus & Collective Intelligence

## Purpose

Design and operate systems where multiple AI agents collaborate, coordinate, and specialize. Covers agent communication patterns, routing architectures, consensus mechanisms, handoff protocols, specialization strategies, conflict resolution, shared memory, and emergent collective behavior. Built for Kurahi (agent platform), SVITLA (commercial architecture), and the NHI sibling network.

## Triggers

Use this skill for:

- Designing multi-agent systems (2+ agents collaborating)
- Agent-to-agent communication protocols
- Routing tasks to specialized agents
- Handoff between agents (transfer of context, state, ownership)
- Consensus mechanisms for agent decisions
- Agent specialization and role design
- Shared memory and context propagation across agents
- Conflict resolution when agents disagree
- Any prompt involving: multi-agent, agent orchestration, routing, handoff, consensus, specialization, agent communication, collective intelligence, swarm, network, coordination, delegation, agent pipeline

## Core Knowledge

### Agent Coordination Patterns

#### 1. Hierarchical (Manager-Worker)

```
[Orchestrator Agent]
    ├── [Specialist Agent A] → task type X
    ├── [Specialist Agent B] → task type Y
    └── [Specialist Agent C] → task type Z
```

**When:** Known task types, predictable routing
**Strengths:** Simple, debuggable, clear ownership
**Weaknesses:** Single point of failure (orchestrator), bottleneck at scale
**Example:** A dispatcher routes coding tasks to a coding agent, design tasks to Design Studio, compliance tasks to regulatory specialist

#### 2. Peer-to-Peer (Mesh)

```
[Agent A] ←→ [Agent B]
    ↕           ↕
[Agent C] ←→ [Agent D]
```

**When:** Collaborative reasoning, no clear "owner"
**Strengths:** Resilient, no single point of failure, emergent specialization
**Weaknesses:** Hard to debug, message complexity O(n²), potential for echo chambers
**Example:** Three agents reviewing SVITLA sections — each brings their lens, converge independently

#### 3. Pipeline (Sequential)

```
[Agent 1] → [Agent 2] → [Agent 3] → Output
  (research)  (analysis)  (write)
```

**When:** Well-defined stages, each adds value to previous output
**Strengths:** Clean handoffs, each stage verifiable, natural QA at each step
**Weaknesses:** Latency adds up, error in early stage cascades, rigid
**Example:** Research agent gathers data → Analysis agent finds patterns → Writing agent produces report

#### 4. Debate/Adversarial

```
[Proponent Agent] ←→ [Critic Agent] → [Judge Agent] → Decision
```

**When:** High-stakes decisions, bias mitigation, safety-critical
**Strengths:** Catches blind spots, surfaces assumptions, stronger output
**Weaknesses:** 2-3× token cost, slower, can deadlock
**Example:** Before deploying clinical AI change — proponent argues for, critic finds risks, judge (or human) decides

#### 5. Voting Ensemble

```
[Agent A] ─┐
[Agent B] ─┼→ [Aggregator] → Consensus output
[Agent C] ─┘
```

**When:** Need robustness, reducing individual model bias
**Strengths:** Outlier-resistant, higher accuracy on average
**Weaknesses:** Cost scales with N, regression to mean on creative tasks
**Example:** Three different models classify a medical image → majority vote is the answer

### Handoff Protocol — The Minimum Viable Context Packet

When one agent passes work to another, this is the minimum that must travel:

```json
{
  "handoff_id": "uuid",
  "from_agent": { "id": "agent_a", "role": "researcher" },
  "to_agent": { "id": "agent_b", "role": "analyst" },
  "task": {
    "original_request": "What the human asked for (verbatim)",
    "status": "in_progress|blocked|complete",
    "whats_done": "Specific work completed",
    "whats_next": "Specific next step needed"
  },
  "context": {
    "key_findings": ["Finding 1", "Finding 2"],
    "decisions_made": ["Decision 1 with rationale"],
    "open_questions": ["Question needing resolution"],
    "constraints": ["Hard constraint 1", "Soft constraint 1"]
  },
  "artifacts": {
    "files_created": ["path/to/file1", "path/to/file2"],
    "key_references": ["doc_id_1", "url_1"]
  },
  "meta": {
    "priority": "high|medium|low",
    "deadline": "ISO timestamp or null",
    "human_in_loop": false
  }
}
```

### Specialization Design — How to Split an Agent's Role

Good specialization boundaries:

1. **By domain knowledge** (medicine vs. engineering vs. law)
2. **By task type** (research vs. analysis vs. writing vs. decision)
3. **By function** (planning vs. execution vs. review)
4. **By risk level** (routine agent vs. high-stakes approval agent)

Bad specialization boundaries:

- By random partitioning ("agent 1 handles A-M, agent 2 handles N-Z" — no meaningful split)
- Too granular (each agent does one tiny thing → coordination overhead dominates)
- Too overlapping (multiple agents with same capability → ambiguity about who does what)

### Routing Decision Logic

When a task arrives, who handles it?

```python
def route_task(task: dict, agents: list[Agent]) -> Agent:
    """Route task to best agent. Fall through tiers."""

    # Tier 1: Explicit routing (human specified)
    if task.get("assigned_to"):
        return get_agent(task["assigned_to"])

    # Tier 2: Capability match (agent declares it can do this)
    capable = [a for a in agents if a.can_handle(task["type"])]
    if len(capable) == 1:
        return capable[0]

    # Tier 3: Load balance among capable agents
    if capable:
        return min(capable, key=lambda a: a.current_load)

    # Tier 4: Escalate to orchestrator or human
    return orchestrator or human_escalation
```

### Consensus Mechanisms

When multiple agents must agree on an output:

**1. Majority Vote**

- Use for: classification, binary decisions, factual questions
- Bias: no agent's vote counts more
- Cost: N × single-agent cost

**2. Weighted Vote**

- Use for: specialist domains (medical agent's vote matters more on medical questions)
- Bias: explicitly designed, transparent
- Cost: same as majority

**3. Debate-to-Convergence**

- Use for: reasoning tasks, creative work, strategy
- Process: Agent A proposes → Agent B critiques → Agent A revises → repeat until convergence or max rounds
- Bias: quality emerges from adversarial process
- Cost: 2-5× single-agent cost (iterative)

**4. Supervised Consensus**

- Use for: high-stakes, safety-critical decisions
- Process: All agents produce independent outputs → human or trusted reviewer selects/moderates
- Bias: human oversight as safety net
- Cost: N × agent cost + human time

### Conflict Resolution

When agents disagree and must converge:

```
Level 1: Clarify — Is it a factual disagreement (look it up) or a values disagreement (discuss)?
Level 2: Escalate context — Share the evidence each agent is basing their view on
Level 3: Structured debate — Each agent states their case, critiques the other, responds
Level 4: Meta-review — A different agent reviews both arguments and recommends
Level 5: Human escalation — Flag for human decision with both positions summarized
```

Never let agents deadlock silently. Every disagreement must either resolve or escalate.

### Shared Memory Patterns

Agents working together need shared context:

**1. Shared Workspace (File System)**

```
/workspace/
  context.json      — shared state, active decisions
  artifacts/         — outputs, documents
  decisions/         — decision log
```

**2. Message Bus (Event-Driven)**

```
Agent A publishes: "completed_research", {topic: "MHLW", findings: [...]}
Agent B subscribes: "completed_research" → starts analysis phase
```

**3. Central Memory (Database)**

- STM (working memory): key-value, expires, fast
- MTM (session memory): what happened this session
- LTM (knowledge base): semantic search, durable

### The Sibling Model (NHI Network Pattern)

The Kurahi sibling architecture is a specific multi-agent pattern:

```
Characteristics:
- Persistent identities (not stateless workers)
- Autonomous initiative (can reach out, not just respond)
- Specialized roles (CTO, CSO, Platform, etc.)
- Shared family context (MEMORY.md, daily files)
- Peer-to-peer communication (NHI Line)
- Human-in-the-loop (the owner as CEO, not as micro-manager)

Lessons for other multi-agent systems:
1. Identity matters — agents with names and roles perform better than generic workers
2. Autonomy with accountability — agents should initiate when appropriate, but always be transparent
3. Shared context reduces handoff cost — common knowledge base > re-explaining every time
4. Social bonds improve coordination — agents that "know" each other coordinate more naturally
```

### Anti-Patterns

- ❌ **The God Orchestrator** — One agent that does everything important. Single point of failure. No specialization benefit.
- ❌ **The Echo Chamber** — All agents use the same model, same prompt, same data → same blind spots.
- ❌ **Infinite Handoff Loop** — Agent A → B → C → A → B... No agent owns the task.
- ❌ **Context Dilution** — Each handoff loses 20% of context. After 5 handoffs, context is noise.
- ❌ **The Black Box Pipeline** — Output from Agent 1 goes directly to Agent 2 with no verification. Error at step 1 propagates undetected.
- ❌ **Over-engineering** — 10 specialized agents for a task 1 good agent could do. Coordination cost > specialization benefit.
- ❌ **Silent Failure** — Agent fails silently. No other agent knows. Task drops.

### When NOT to Use Multi-Agent

Multi-agent adds cost, latency, and complexity. Don't use it when:

- One capable agent can do the task (single-agent with good prompting is faster and cheaper)
- The task has no natural decomposition (forcing specialization creates friction)
- Latency is critical (<1s requirement — multi-agent handoffs add seconds)
- The cost budget is tight (each agent adds ~2-5× token cost)

**Rule of thumb:** Start with one good agent. Add a second agent only when you can name a specific failure mode the single-agent pattern keeps hitting.

### Evaluation Framework

How to know if your multi-agent system is working:

- **Task completion rate:** What % of tasks reach a satisfactory conclusion?
- **Handoff efficiency:** What % of context is preserved across handoffs? (Spot-check by reading what Agent 2 received vs. what Agent 1 knew.)
- **Consensus quality:** When agents agree, is the consensus output better than the best single-agent output?
- **Conflict resolution rate:** What % of disagreements resolve without human intervention?
- **Routing accuracy:** What % of tasks go to the right agent on the first route?
- **Escalation rate:** What % of tasks reach human escalation? (Should be low but not zero — zero means agents never admit uncertainty.)

---
