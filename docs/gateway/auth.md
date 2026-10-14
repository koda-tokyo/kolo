---
summary: "Gateway shared-secret token: per-gateway token file, precedence, clients, admin routes"
read_when:
  - Setting up or rotating the Gateway token
  - Running several Gateways on one host
  - A client gets token_mismatch or 401
title: "Gateway Auth"
---

# Gateway auth

Each Gateway has its own shared-secret token, stored in a file that only the owning user can read.
The token never goes in config, on the command line, or in logs.

## Token file

- Default path: `<KOLO_HOME>/secrets/gateway.token` (directory `0700`, file `0600`).
- On first start, a token-mode Gateway that finds no token from any source generates the file
  with 32 random bytes (hex).
- Override the path with `gateway.auth.tokenFile` in config, or with the
  `KOLO_GATEWAY_TOKEN_FILE` environment variable. Set `gateway.auth.tokenFile: false` to disable
  the file source.
- With several Gateways on one host, give each its own `KOLO_HOME`. Each one then gets its own token.

## Precedence

The Gateway and local clients resolve the token in the same order:

1. The token file (`KOLO_GATEWAY_TOKEN_FILE`, then `gateway.auth.tokenFile`, then the default path).
2. The `KOLO_GATEWAY_TOKEN` environment variable.
3. `gateway.auth.token` in config. This is deprecated and logs a one-time warning. It is used
   only when there is no token file.

In remote mode, clients keep using `gateway.remote.token`.

## Clients

`KoLo tui`, `KoLo agent`, `KoLo health` and every Gateway client read the same file or
environment variable. Run them with the Gateway's `KOLO_HOME`, or point them at the Gateway's file:

```bash
KOLO_GATEWAY_TOKEN_FILE=~/.kolo-gw2/secrets/gateway.token KoLo tui --url ws://127.0.0.1:18800
```

`KoLo tui --token` is still accepted but deprecated: any user on the host can see the value with `ps`.

Device tokens issued after pairing are stored per Gateway URL and role
(`<KOLO_HOME>/identity/device-auth.json`). Two Gateways on one host never swap device tokens.
Entries from older versions that were keyed by role only are read as a fallback and dropped the
first time that Gateway issues a new device token.

## HTTP routes

`/api/admin/*` and `/metrics` require one of:

- `Authorization: Bearer <gateway token>` (the same check as `/tools/invoke`), or
- a valid `kolo_session` cookie for a user with the `admin` role.

`/health` and `/api/health` stay open.

## Rotating the token

1. Write a new token to the file: `umask 077; openssl rand -hex 32 > <KOLO_HOME>/secrets/gateway.token`.
2. Restart the Gateway.
3. Clients that read the file pick up the new token on their next connect.
