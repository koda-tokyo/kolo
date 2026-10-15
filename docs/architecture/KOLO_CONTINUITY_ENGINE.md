# Kurahi Continuity Engine (3-Layer Memory)

This is the implementation of **IP Aspect #6**: Working, Mid-Term, and Long-Term memory for each user, with a prompt-friendly snapshot used by the Covenant system.

## Overview

The Continuity Engine provides Kurahi with persistent, layered memory that enables genuine relationship continuity across sessions.

### Three Layers

| Layer                      | Scope           | Purpose                        | Example                                       |
| -------------------------- | --------------- | ------------------------------ | --------------------------------------------- |
| **Working Memory (WM)**    | Current session | "What are we doing right now?" | "Discussing Phase 1 implementation"           |
| **Mid-Term Memory (MTM)**  | Days/weeks      | "What happened recently?"      | "Job change last week, exam prep ongoing"     |
| **Long-Term Memory (LTM)** | Stable facts    | "Who are they?"                | "Lives in Tokyo, works in HR, values privacy" |

## Code Structure

```
src/continuity/
  types.ts      # WM, MTM, LTM interfaces
  snapshot.ts   # buildContinuitySnapshot() for covenant prompts
  index.ts      # re-exports
```

## Integration with Covenant

The continuity snapshot is passed to `summariseForSystem()` in the covenant module:

```ts
import { buildContinuitySnapshot } from "../continuity";
import { summariseForSystem } from "../covenant";

const snapshot = buildContinuitySnapshot(continuityState);
const systemText = summariseForSystem(covenant, snapshot);
```

This produces a unified system prompt fragment that includes:

- Relationship mode and values (from Covenant)
- Recent context and stable facts (from Continuity)

## Integration with System Prompt

Use the prompt helper to combine base system prompt with covenant:

```ts
import { buildKoLoSystemPromptWithCovenant } from "../prompt/koloPrompt";

// In the orchestrator/runner:
const fullSystemPrompt = buildKoLoSystemPromptWithCovenant({
  baseSystemPrompt: appendPrompt, // from buildEmbeddedSystemPrompt
  covenant: userCovenant, // loaded from covenant service
  continuityState: continuity, // loaded from continuity service
});
```

Or use `buildCovenantSection()` to get just the covenant text for manual composition.

## Future Work

- [ ] Working memory service (conversation buffer management)
- [ ] Mid-term episode extraction (automatic summarization)
- [ ] Long-term fact persistence (embeddings + retrieval)
- [ ] Memory consolidation (WM → MTM → LTM promotion)

---

_Part of Kurahi's 7 differentiating IP aspects. See `docs/ip/KOLO_IP_STRUCTURE.md` for the full list._
