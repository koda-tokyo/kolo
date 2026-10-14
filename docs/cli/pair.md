---
summary: "CLI reference for `kolo pair` (scoped device pairing: invitations, device-bound credentials)"
read_when:
  - You want to let another machine, app or agent talk to a gateway without handing it the owner token
  - You are approving, listing or revoking paired devices
  - A client reports reuse_detected, device_pending or reconsent_required
title: "pair"
---

# `kolo pair`

Scoped device pairing (KoLo 2.0, M3a). A device gets its own credential instead of a copy of
the gateway token, and that credential carries one scope:

| Scope     | Can                                                        |
| --------- | ---------------------------------------------------------- |
| `observe` | read: health, metrics, lists, histories, `/api/pair/me`     |
| `attach`  | observe + drive sessions: chat, agent turns, `/tools/invoke`, `/v1/*` |
| `admin`   | attach + manage the gateway: config, cron, pairing          |
| `owner`   | the gateway token file (`<KOLO_HOME>/secrets/gateway.token`); never granted by pairing |

Every HTTP route and every WebSocket method has a minimum scope (default `admin`), enforced on
the gateway. A credential below the minimum gets `403` (HTTP) or `missing scope: <scope>` (WS).

## Flow

On the gateway host (owner token or an `admin` credential):

```
kolo pair invite --scope attach --ttl 10m --label "phone"
```

The code (`kpi_…`) is printed once and stored only as a hash. It is single use and expires
after `--ttl` (default 10 minutes, maximum 60).

On the device:

```
kolo pair redeem kpi_… --url http://gateway-host:18789 --name "phone"
```

This generates an Ed25519 device key, proves it by signing a server nonce, and stores the
credential in `<KOLO_HOME>/secrets/devices/<fingerprint>.json` (mode 0600): a short-lived access
token (default 1 h) and a rotating refresh token (default 30 days). `kolo api`, `@kodasoken/kolo-client`
and every other local client find the file through discovery and refresh the access token when
it expires; no token is ever passed on argv.

## Commands

### `kolo pair invite --scope <observe|attach|admin> [--ttl 10m] [--label x] [--sessions p,q] [--no-auto-approve] [--json]`

Create a single-use invitation. An invitation can never grant more than its creator holds.
`--sessions` (M3b) restricts the credential to a session allowlist: comma-separated globs over
session keys (`agent:alice:*`), bare agent ids (`alice`) or labels (`label:ops`), repeatable.
The gateway enforces it on discovery, attach, every session-addressed call and the event stream;
see [attach](/cli/attach). Without it the credential sees every session its scope allows.
With `--no-auto-approve` the device that redeems it stays **pending** (its tokens are refused)
until `kolo pair approve <fingerprint>`; the default is trust-on-first-use, because the
invitation was minted on an already authenticated surface.

### `kolo pair list [--json]`

Invitations with their status: `pending`, `redeemed`, `expired`, `revoked`.

### `kolo pair devices [--json]`

Paired devices: fingerprint, name, scope, status (`approved`, `pending`, `revoked`,
`reconsent`), when paired and last seen, and how many credential families are alive.

### `kolo pair approve <fingerprint>`

Trust a pending device.

### `kolo pair revoke <fingerprint | inv_…>`

Revoke a device (every credential family it holds dies at once; the next request from that
device fails, including on open WebSocket connections) or an unredeemed invitation.

### `kolo pair redeem <code> [--url http://host:port] [--name x] [--json]`

Device side: redeem an invitation and store the credential file. `--json` prints the file path,
fingerprint, scope and status, never the tokens.

## Refresh, reuse, re-consent

- Refresh rotates both tokens; the previous refresh token is retired.
- Presenting a retired refresh token is **reuse**: someone holds a copy. The whole family is
  revoked and audited as `pair.reuse_detected`; the device must pair again.
- Devices paired longer ago than `gateway.pairing.reconsentDays` (default 90) are forced to pair
  again (`reconsent_required`, audited as `pair.reconsent`).
- Revocation is checked on every request from memory; the state is mirrored to
  `<KOLO_HOME>/secrets/credentials.json` (0600, hashes only) so a restart keeps it.

## Config

```json
{
  "gateway": {
    "pairing": {
      "accessTtlMinutes": 60,
      "refreshTtlDays": 30,
      "inviteTtlMinutes": 10,
      "reconsentDays": 90
    }
  }
}
```

## Audit

Every event lands in the hash-chained audit log: `pair.invite`, `pair.redeem`, `pair.refresh`,
`pair.reuse_detected`, `pair.revoke`, `pair.approve`, `pair.reconsent`, `pair.connect` (WS).

## API

`POST /api/pair/invite`, `GET /api/pair/invitations`, `DELETE /api/pair/invitations/{id}`,
`GET /api/pair/nonce`, `POST /api/pair/redeem`, `POST /api/pair/refresh`, `GET /api/pair/me`,
`GET /api/pair/devices`, `POST /api/pair/devices/{fingerprint}/approve|revoke`; WebSocket
`pair.nonce`, `pair.redeem`, `pair.refresh`, `pair.me`, `pair.invite`, `pair.list`,
`pair.devices`, `pair.approve`, `pair.revoke`. The live description is at `GET /doc`
(`x-kolo-min-scope` on each operation).
