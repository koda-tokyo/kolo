---
summary: "CLI reference for `kolo attach` (discover live sessions, attach a terminal to one, stream its events, send input)"
read_when:
  - You want to see what sessions a gateway is running and who is attached to them
  - You want to follow or drive an agent session from another terminal, machine or credential
  - You are giving someone an attach credential limited to specific sessions
title: "attach"
---

# `kolo attach`

Session discovery and attach (KoLo 2.0, M3b). The gateway is the one process that owns the
sessions; terminals, pipes and siblings are clients of it. `kolo attach` lists the sessions a
credential may see and attaches a terminal to one of them: the last messages are replayed, the
session's `chat` and `agent` events stream in as they happen, and lines typed on stdin are sent
as turns. Several clients can be attached to one session at the same time and all of them
receive the same event stream.

## Commands

### `kolo attach --list [--agent <id>] [--json]`

Sessions of every agent on the gateway: key, agent, kind, label, state (`running` while a turn
is in flight, else `idle`), attached clients and last activity. An `attach` credential whose
invitation carries a session allowlist sees only matching sessions; owner and admin see all.

### `kolo attach <session|agent> [--follow] [--history N] [--duration ms] [--verbose] [--json]`

`<session|agent>` is a session id, a session key (`agent:alice:main`), a label, or an agent id
(its main session). The gateway resolves it (`GET /api/sessions/{id}`), the terminal connects
over WebSocket with the credential `discover()` finds (the owner token file under `KOLO_HOME`,
else the paired device credential) and calls `session.attach`.

- `--follow` attaches read-only (mode `follow`); nothing typed is sent.
- `--history N` replays the last N messages before streaming (default 20, `0` to skip).
- `--duration ms` leaves after that long (otherwise until stdin EOF or `/quit`).
- `--verbose` also prints tool and lifecycle events.
- `--json` prints JSON lines: `attached`, `history`, `chat`, `agent`.

Piping works: `echo "status?" | kolo attach ops` sends one line, prints the reply and leaves
once the turn ends (bounded by `--timeout`, default 600 000 ms).

Exit codes: `0` ok, `1` error (unknown session, refused), `2` usage, `3` gateway unreachable.

## Scope and allowlists

`sessions.discover`, `session.attach`, `session.detach`, `GET /api/sessions` and
`GET /api/sessions/{id}` need the `attach` scope at least. An invitation may restrict a
credential to a set of sessions:

```
kolo pair invite --scope attach --sessions "agent:alice:*,label:ops"
```

Patterns are globs over session keys; a bare word is an agent id (`alice` = `agent:alice:*`);
`label:<x>` matches a label. The gateway enforces the list on discovery (filtered), on
`GET /api/sessions/{id}` and `session.attach` (404 / "No session found", so nothing can be
probed), on every WebSocket request that names a `sessionKey` or `agentId` (`chat.send`,
`chat.history`, `agent`, `send`, …) and on the event stream: a restricted client never receives
`chat`/`agent` events of other sessions.

## Audit

`session.attach` (allowed/denied, with mode `interact`, `follow` or `pipe`, client id and
connection id) and `session.detach` (reason `detach` or `disconnect`, attached duration) land in
the hash-chained audit log. A closing socket detaches every session it held.

## Messaging pipes

`kolo message send` to LINE, WhatsApp or any other channel from a terminal is a direct pipe. It
is itself an attach client: it opens one gateway connection, calls `session.attach` with the
channel and target (mode `pipe`; the gateway resolves the conversation's session), asks the
gateway to deliver through the `send` method (which records the outbound text in that session)
and detaches. The terminal process no longer writes the session store or transcript, and
without a reachable gateway the pipe fails with exit `3`. The house rule stands: only an
explicit terminal/CLI client ever triggers a send; nothing in this path replies on its own.

## API

`GET /api/sessions`, `GET /api/sessions/{id}`; WebSocket `sessions.discover`, `session.attach`,
`session.detach`. The live description is at `GET /doc` (`x-kolo-min-scope: attach`).
