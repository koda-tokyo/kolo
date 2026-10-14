---
summary: "CLI reference for `KoLo channels` (accounts, status, login/logout, logs)"
read_when:
  - You want to add/remove channel accounts (WhatsApp/Telegram/Discord/Google Chat/Slack/Mattermost (plugin)/Signal/iMessage)
  - You want to check channel status or tail channel logs
title: "channels"
---

# `KoLo channels`

Manage chat channel accounts and their runtime status on the Gateway.

Related docs:

- Channel guides: [Channels](/channels/index)
- Gateway configuration: [Configuration](/gateway/configuration)

## Common commands

```bash
KoLo channels list
KoLo channels status
KoLo channels capabilities
KoLo channels capabilities --channel discord --target channel:123
KoLo channels resolve --channel slack "#general" "@jane"
KoLo channels logs --channel all
```

## Add / remove accounts

```bash
KoLo channels add --channel telegram --token <bot-token>
KoLo channels remove --channel telegram --delete
```

Tip: `KoLo channels add --help` shows per-channel flags (token, app token, signal-cli paths, etc).

## Login / logout (interactive)

```bash
KoLo channels login --channel whatsapp
KoLo channels logout --channel whatsapp
```

## Troubleshooting

- Run `KoLo status --deep` for a broad probe.
- Use `KoLo doctor` for guided fixes.
- `KoLo channels list` prints `Claude: HTTP 403 ... user:profile` → usage snapshot needs the `user:profile` scope. Use `--no-usage`, or provide a claude.ai session key (`CLAUDE_WEB_SESSION_KEY` / `CLAUDE_WEB_COOKIE`), or re-auth via Claude Code CLI.

## Capabilities probe

Fetch provider capability hints (intents/scopes where available) plus static feature support:

```bash
KoLo channels capabilities
KoLo channels capabilities --channel discord --target channel:123
```

Notes:

- `--channel` is optional; omit it to list every channel (including extensions).
- `--target` accepts `channel:<id>` or a raw numeric channel id and only applies to Discord.
- Probes are provider-specific: Discord intents + optional channel permissions; Slack bot + user scopes; Telegram bot flags + webhook; Signal daemon version; MS Teams app token + Graph roles/scopes (annotated where known). Channels without probes report `Probe: unavailable`.

## Resolve names to IDs

Resolve channel/user names to IDs using the provider directory:

```bash
KoLo channels resolve --channel slack "#general" "@jane"
KoLo channels resolve --channel discord "My Server/#support" "@someone"
KoLo channels resolve --channel matrix "Project Room"
```

Notes:

- Use `--kind user|group|auto` to force the target type.
- Resolution prefers active matches when multiple entries share the same name.

## Delivery status (M14)

`kolo channels status` ends with a Delivery section when any channel has sent something since
the gateway started:

```
Delivery:
- line: queued 0, sent 12, retried 1, dead-letter 0, duplicates 0, last 2m
- dead letters slack: 1 in /home/alice/.kolo/channels/dead-letter/slack.jsonl
```

The same data is available as `kolo api getChannelsDeliveryStatus`. See
[Channel residents](/channels/README) for the queue semantics.
