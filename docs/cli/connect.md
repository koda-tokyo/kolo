---
summary: "CLI reference for `kurahi connect` (connect your phone: WhatsApp, Telegram, LINE, phone browser; owner binding)"
read_when:
  - You want the resident to answer you on your phone
  - You are scripting channel setup without prompts
  - You need to remove or replace a channel owner
title: "connect"
---

# `kurahi connect`

Connects a phone to the resident. The same flows run as the last step of `kurahi init`
(`--phone`). Walkthrough: [Connect your phone](/start/phone).

```bash
kurahi connect telegram
kurahi connect whatsapp
printf '%s\n%s\n' "$LINE_SECRET" "$LINE_TOKEN" | kurahi connect line --stdin --no-wait
kurahi connect web
kurahi connect --unbind telegram
kurahi connect --list --json
```

## Channels

| Channel    | What it does                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp` | Linked-device login with the pairing QR rendered in the terminal; the linked number becomes the owner; the first message gets a one-line welcome                                                |
| `telegram` | Bot token to the secrets store (validated with the Bot API), QR of `https://t.me/<bot>?start=<code>`; the first `/start` with the code binds the owner                                          |
| `line`     | Channel secret and access token to the secrets store, webhook guidance (public HTTPS required; no tunnel is created), QR of the add-friend URL; the first message with the code binds the owner |
| `web`      | One-shot pairing invitation (attach, 10 minutes) as a QR of `<dashboard>#pair=<code>`; only on `lan`, `tailnet` or `custom` binds with `gateway.tls` enabled                                    |

## Options

- `--account <id>`: channel account (default: the default account).
- `--stdin`: read the secrets from stdin, one per line (Telegram: the bot token; LINE: the channel
  secret, then the access token). Without it the secrets come from `TELEGRAM_BOT_TOKEN`,
  `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, a hidden prompt, or the secrets store.
  Never from a flag value.
- `--wait` / `--no-wait`: wait for the first message that binds the owner (default: wait when
  interactive and the gateway is running; never past the code's expiry).
- `--force`: WhatsApp, link again even when a session exists.
- `--unbind <channel>`: remove the owner bindings on a channel (identities keys and allowlist entries
  that bindings added) and withdraw pending codes. Audited as `channel.owner_unbound`.
- `--list`: owner bindings per channel and account.
- `--non-interactive`: no prompts.
- `--json`: one JSON document on stdout (`ok`, `channel`, `link`, `code`, `expiresAt`, `owner`,
  `message`); the QR and guidance go to stderr.

Exit codes: 0 ok, 1 failed (token rejected, link not completed, web not reachable from a phone),
2 usage (unknown channel, missing secret without a prompt), 3 the gateway could not create the web
invitation.

## Owner codes

One-time codes look like `KOLO-7F3K9Q2M`, are valid for 10 minutes and once, and only their hash is
stored. Issuing a new code withdraws the previous unused one for that channel. Audit actions:
`channel.owner_code.issued`, `channel.owner_code.claim`, `channel.owner_bound`,
`channel.owner_unbound`.
