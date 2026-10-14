// Single-instance guard for the gateway.
//
// KoLo 2.0 (M1d): the old os.tmpdir() lock (`<tmp>/kolo-<uid>/gateway.<hash>.lock`) is gone.
// The one lock is the gateway lease at `<KOLO_HOME>/run/gateway.lock`
// (src/gateway-v3/supervisor/lease.ts), acquired by the server on start: O_EXCL create,
// pid liveness, heartbeat, stale reclaim, release on exit. This module only keeps the error
// type that "another gateway owns this state root / port" failures are reported with.

export class GatewayLockError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayLockError";
  }
}
