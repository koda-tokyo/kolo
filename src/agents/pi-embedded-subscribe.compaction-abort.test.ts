import { describe, expect, it } from "vitest";
import { handleAgentEnd } from "./pi-embedded-subscribe.handlers.lifecycle.js";

/**
 * Regression: a run that aborts DURING compaction used to leave
 * compactionInFlight true forever. maybeResolveCompactionWait is guarded on
 * !compactionInFlight, so it refused to settle the retry promise and every
 * later send on that session waited on a promise that never resolved.
 *
 * Observed 2026-08-08: Iris's session compacted mid-run, the run aborted, and
 * the session silently accepted nothing for 84 minutes while the client still
 * displayed "connected".
 */
describe("compaction state after an aborted run", () => {
  const makeCtx = () => {
    const state = {
      compactionInFlight: true, // died mid-compaction
      pendingCompactionRetry: 0,
      blockBuffer: "",
      blockState: { thinking: false, final: false, inlineCode: {} as never },
    };
    let resolved = false;
    return {
      resolved: () => resolved,
      state,
      ctx: {
        state,
        params: { runId: "run-under-test" },
        log: { debug: () => {} },
        blockChunker: null,
        emitBlockChunk: () => {},
        resolveCompactionRetry: () => {
          resolved = true;
        },
        maybeResolveCompactionWait: () => {
          // real guard, copied verbatim from the implementation
          if (state.pendingCompactionRetry === 0 && !state.compactionInFlight) resolved = true;
        },
      },
    };
  };

  it("clears compactionInFlight when the agent ends", () => {
    const { ctx, state } = makeCtx();
    handleAgentEnd(ctx as never);
    expect(state.compactionInFlight).toBe(false);
  });

  it("settles the compaction wait instead of hanging forever", () => {
    const h = makeCtx();
    handleAgentEnd(h.ctx as never);
    expect(h.resolved()).toBe(true);
  });
});
