---
summary: "Channel-native residents: one session across chat channels and the terminal, commands, approvals, delivery guarantees"
read_when:
  - You want to talk to the resident from the chat app you already use
  - You need to understand how a channel conversation maps to a session
  - You run channels in production and need delivery and approval semantics
title: "Channel residents"
---

# Channel residents

A resident is the agent that lives in your gateway. Channels are its front doors: the same
session the engineer sees in `kurahi attach` or `kurahi tui` is the one you talk to from LINE,
WhatsApp, Slack, Telegram, Discord or any other connected channel. This page describes the
model that every channel shares. Per-channel pages cover credentials and platform quirks.

## Concepts

| Term           | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| channel        | A transport (`line`, `slack`, `webhook`, …) with one or more accounts          |
| conversation   | A direct message thread or a group/room on one channel                         |
| session        | The resident's conversation state (`agent:<id>:…`); what `kurahi attach` lists |
| identity       | A sender id on a channel mapped to a role: `owner`, `admin` or `attach`        |
| inbox          | `<KOLO_HOME>/inbox/<channel>/<day>/` where attachments are copied for tools    |
| outbound queue | The per-channel delivery pipe with retry, dedupe and dead letters              |

## Session model

`channels.sessionMode` decides where a conversation lands:

| Mode               | Direct messages                  | Groups and rooms                    |
| ------------------ | -------------------------------- | ----------------------------------- |
| `per-conversation` | `agent:<id>:<channel>:dm:<peer>` | `agent:<id>:<channel>:group:<room>` |
| `shared`           | `agent:<id>:main`                | `agent:<id>:main`                   |

- `per-conversation` keeps every chat separate: one session per conversation per channel.
  Use it when several people talk to the resident.
- `shared` sends everything into the resident's main session, the one open in the terminal.
  Use it when one person uses several apps and wants one thread.
- When the key is absent, `session.dmScope` applies unchanged, so existing configurations keep
  their session keys. A webhook account may set its own `sessionMode`.

```json5
{
  channels: {
    sessionMode: "per-conversation",
    locale: "en",
  },
}
```

Every inbound message appears in attached terminals as it arrives, with the channel and the
sender: `kurahi attach <session>` prints `[line Alice] text`, the TUI shows it as a user line, and
`--json` emits a `channel.inbound` event with `channel`, `sender`, `conversation`, `messageId`
and `attachments`. Replies go back through the same channel. Long replies are split to the
channel's limit (`channels.<id>.textChunkLimit`; LINE 5000, Slack 4000, WhatsApp 4000, Discord
2000 by default). Typing indicators and read receipts follow each channel's capabilities
(see the channel pages).

Attachments are copied to `<KOLO_HOME>/inbox/<channel>/<yyyy-mm-dd>/` and their paths are
appended to what the agent reads, so file tools can open them. Caps:

```json5
{
  channels: {
    inbox: { maxFileBytes: 20971520, maxFilesPerMessage: 8, retentionDays: 30 },
  },
}
```

Files above the cap are skipped and the sender is told; nothing is truncated.

## Identities and roles

Each channel maps sender ids to roles. Roles are ordered `owner` > `admin` > `attach`.

```json5
{
  channels: {
    line: {
      identities: { U1234567890abcdef: "owner", Uabcdef1234567890: "attach" },
      locale: "ja",
    },
    slack: {
      identities: { U0AB12CD34: "admin" },
      accounts: { ops: { identities: { U0EF56GH78: "owner" } } },
    },
  },
}
```

- Keys are matched case-insensitively; a `channel:` prefix is accepted (`"line:U123"`).
- Account-level `identities` extend the channel-level table.
- Without any `identities` on a channel, the channel's own command authorization (allowlist
  or pairing owner) stands in for `owner`, so existing setups keep working.
- A sender with no role gets no commands and no approvals; the message still reaches the
  agent under the channel's normal access policy (`dmPolicy`, `allowFrom`, pairing).

## Conversation commands

Commands work on every channel. Reading commands need `attach`; acting commands need `admin`.

| Command                      | Role            | Reply                                                                             |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `/help`                      | attach          | the command list and your role                                                    |
| `/status`                    | attach          | resident, session, paused or active, running and queued jobs, last job            |
| `/jobs`                      | attach          | the last eight jobs of the resident                                               |
| `/cancel <id>`               | admin           | stops a running or queued job (id or unique prefix)                               |
| `/evidence <jobId>`          | attach          | the REPORT.md summary of a job: status, duration, turns, tools, files, final text |
| `/pause`                     | admin           | stop answering in this conversation; commands still work                          |
| `/resume`                    | admin           | answer again                                                                      |
| `approve <id>` / `deny <id>` | admin or listed | answer a pending approval (`/approve <id> allow-always` is accepted)              |

`/pause` is per conversation and survives a gateway restart (`<KOLO_HOME>/run/channel-pause.json`).
The first dropped message gets a one-time notice; later ones are dropped silently and audited.

System replies (help, approvals, errors) are in the channel locale: `channels.<id>.locale`,
then `channels.<id>.accounts.<acct>.locale`, then `channels.locale`, default `en`. Japanese (`ja`)
and Portuguese (`pt`) are included. Translations live in one table (`src/channels/resident/templates.ts`).

## Approvals

When a tool needs approval (exec approvals today; the M13 `approvals` policy will reuse this
path), the ask is delivered to the conversation that started the job and to the targets in
`channels.approvals.targets`, as a localized message with `approve <id>` / `deny <id>` keywords
and, where the channel renders them, two buttons. The ask expires with the approval timeout;
an expiry notice is sent.

```json5
{
  approvals: { exec: { enabled: true, mode: "session" } },
  channels: {
    approvals: {
      targets: [{ channel: "slack", to: "C0OPSROOM" }],
      identities: ["U0AB12CD34"],
    },
  },
}
```

Who may answer: `owner` and `admin` identities of the channel, plus any sender id listed in
`channels.approvals.identities`. The answer resolves the same approval the terminal would, is
broadcast as `exec.approval.resolved`, and is written to the audit log
(`channel.approval.asked`, `channel.approval.resolved`, `channel.approval.expired`).

## Delivery guarantees

Every reply and every approval ask goes through a per-channel outbound queue:

- in order per channel; one job at a time per channel
- retry with exponential backoff (`maxRetries` 4, `backoffMs` 1000 doubling to `maxBackoffMs`)
- dedupe keys (provider message id + chunk) in a sliding window (`dedupeTtlMs`)
- jobs that exhaust their retries land in `<KOLO_HOME>/channels/dead-letter/<channel>.jsonl`
  with the target, the key, the error and the text, and are audited
  (`channel.outbound.retry`, `channel.outbound.dead_letter`)
- inbound idempotency: a provider message id seen in the last 20 minutes is ignored and audited
  (`channel.inbound.duplicate`)

```json5
{
  channels: {
    delivery: {
      maxRetries: 4,
      backoffMs: 1000,
      maxBackoffMs: 60000,
      dedupeTtlMs: 600000,
      policy: "human-triggered",
    },
  },
}
```

A retry resends the whole payload. The webhook channel skips chunks that were already posted;
a channel whose adapter sends several chunks per payload may repeat chunks after a partial failure.

**Replies and proactive sends.** Every queued job is classified before it is sent:

- **reply-to-inbound**: it answers an inbound message from a sender the channel admitted (the
  channel allowlist, the pairing store, `identities`, or an open DM policy) and is sent within
  `channels.delivery.replyWindowMs` of that message (default 24 hours). A reply is a
  conversation, not an automated send, so the resident may always reply, whatever produced the
  text (the agent run, a slash command, a job that finished later).
- **proactive**: everything else, including a message to someone who has not written, or to a
  conversation that has been silent longer than the reply window.

**Policy.** `channels.delivery.policy` decides proactive sends only:

| Policy                      | Proactive sends delivered                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `human-triggered` (default) | terminal or CLI sends and human-initiated approval asks; anything marked automated is refused |
| `allow-automated`           | all, including daemons and cron lanes                                                         |
| `replies-only`              | none                                                                                          |

A refused send is written to the dead-letter file with reason `policy` and intent `proactive`,
and audited (`channel.outbound.policy_denied`). Set `allow-automated` only where an operator has
decided daemons and cron lanes may message people. The M13 policy (`agents[].channels`, the kill
switch) applies on top of this in the delivery path: a paused or stopped agent sends nothing.

```json5
{
  channels: {
    delivery: { policy: "human-triggered", replyWindowMs: 86400000 },
  },
}
```

## Operations

```bash
kurahi channels status          # accounts, then a Delivery section per channel
kurahi api getChannelsDeliveryStatus
```

The Delivery section prints `queued`, `sent`, `retried`, `dead-letter`, `duplicates`,
`policy-denied`, the age of the last send and the last error, plus every dead-letter file with
its record count. Inspect a dead letter with `jq` and resend with `kurahi message send` once the
cause is fixed.

Audit actions written by this layer: `channel.inbound`, `channel.inbound.duplicate`,
`channel.inbound.paused`, `channel.command`, `channel.approval.*`, `channel.outbound.*`.
They sit in the hash-chained audit log like every other action (`kurahi audit`).

## The generic webhook channel

`channels.webhook` is a built-in channel for custom integrations and for tests: HTTP in,
HTTP out. It uses the same session model, identities, locale, inbox, commands and queue.

```json5
{
  channels: {
    webhook: {
      outboundUrl: "https://integration.example/kolo/outbound",
      identities: { alice: "owner" },
      textChunkLimit: 4000,
      accounts: { ops: { allowFrom: ["ops-bot"], sessionMode: "shared" } },
    },
  },
}
```

Inbound: `POST /api/channels/webhook/{account}/inbound` with a gateway token or pair credential
(`attach` scope) and a body `{ from, name?, text?, messageId?, conversationId?, chatType?, attachments? }`.
Attachments are `{ name, contentType?, dataBase64 }` and are copied to the inbox. The response
carries the session key and the replies. Outbound: one JSON post per chunk to `outboundUrl`
with `{ channel, account, to, text, chunk, chunks, kind, replyToMessageId?, actions?, dedupeKey, sessionKey }`
and an `x-kolo-dedupe-key` header; `outboundToken` is sent as a bearer token.

`pnpm channels:check` runs this channel end to end against a throwaway gateway with the
deterministic provider (CI, Linux).
