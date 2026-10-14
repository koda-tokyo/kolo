/**
 * Coalesces render requests. While a stream is active every delta asks for a render; drawing
 * each one is a re-render storm. The scheduler draws at most once per `intervalMs` while busy
 * and immediately when idle (the first request after a quiet period is not delayed).
 */
export type RenderTarget = { requestRender: (force?: boolean) => void };

export type RenderScheduler = {
  /** Ask for a render; coalesced while busy. */
  request: () => void;
  /** Draw now (used for user-visible state changes such as a command result). */
  flush: () => void;
  /** Number of renders actually issued to the target. */
  renders: () => number;
  stop: () => void;
};

export function createRenderScheduler(
  target: RenderTarget,
  opts: { intervalMs?: number; now?: () => number } = {},
): RenderScheduler {
  const intervalMs = opts.intervalMs ?? 33;
  const now = opts.now ?? Date.now;
  let lastRender = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | null = null;
  let count = 0;

  const draw = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastRender = now();
    count++;
    target.requestRender();
  };

  const request = () => {
    if (timer) {
      return; // a draw is already scheduled for this window
    }
    const elapsed = now() - lastRender;
    if (elapsed >= intervalMs) {
      draw();
      return;
    }
    timer = setTimeout(draw, intervalMs - elapsed);
    timer.unref?.();
  };

  return {
    request,
    flush: draw,
    renders: () => count,
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
