---
summary: "One page: install, first run, pair a device, attach, uninstall"
read_when:
  - You have one page of time to try KoLo
title: "Quickstart"
---

# KoLo quickstart (one page)

日本語版: [クイックスタート](/ja/QUICKSTART)

Requirements: Linux, macOS, or Windows 10/11 (the installer ships its own Node.js runtime; the npm package needs Node.js 22.12 or newer); a model provider token (the Sakura AI Engine free tier works, see [Sakura AI Engine](/providers/sakura)).

## 1. Install (2 minutes)

Linux or macOS:

```bash
curl -fsSL https://kodasoken.com/kolo/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://kodasoken.com/kolo/install.ps1 | iex
```

The installer verifies the download against the published SHA-256, installs the `kolo` command, runs `kolo init`, registers the gateway as a user service and prints a pairing invitation. Air-gapped: download the bundle and `SHA256SUMS.txt` and run `install.sh --bundle <file> --sums SHA256SUMS.txt`.

## 2. First run

If the installer did not run it, or to change answers:

```bash
kolo init                      # identity name, bind policy, provider profile (Sakura first)
kolo service install           # gateway under systemd / launchd / Task Scheduler
kolo health                    # "gateway ok · 1 agent · … "
kolo tui --message "Say hello in one line"
```

Japanese messages: `kolo init --lang ja` (or `KOLO_LANG=ja`).

Without prompts: `SAKURA_API_KEY=<token> kolo init --non-interactive --name alice --provider sakura`.

### Connect your phone (five minutes)

The last question of `kolo init` connects your phone and ends with a QR code: scan it, send one
message, and the resident answers you on WhatsApp, Telegram, LINE or in the phone browser. Any
time later: `kolo connect telegram` (or `whatsapp`, `line`, `web`). Walkthrough:
[Connect your phone](/start/phone).

## 3. Pair a second device or terminal

On the machine running the gateway:

```bash
kolo pair invite --scope attach        # prints a one-use code; scopes: observe < attach < admin < owner
```

On the other device (same network or over a tunnel), redeem the code with the KoLo app or `kolo pair redeem <code> --url http://<host>:<port>`. The credential is bound to that device's key, expires on its own and can be revoked with `kolo pair revoke <id>`.

## 4. Attach to a live session

```bash
kolo attach --list                     # sessions you may attach to
kolo attach alice                      # the agent's main session, several terminals at once
echo "status?" | kolo attach alice     # send one line, print the reply, leave
```

## 5. Check and support

```bash
kolo doctor                            # checks and repairs
kolo audit verify                      # the hash-chained audit log
kolo support                           # facts + a redacted diagnostics bundle for a ticket
```

## 6. Uninstall

```bash
kolo uninstall --all --yes --dry-run   # shows: service unit, state directory, workspace
kolo uninstall --all --yes
rm -rf ~/.local/share/kolo ~/.local/bin/kolo        # the program (Windows: %LOCALAPPDATA%\KoLo)
```

Everything KoLo wrote lives under `KOLO_HOME` (`~/.kolo`, Windows `%LOCALAPPDATA%\KoLo`) and the install prefix; nothing else is touched.

Exit codes everywhere: 0 ok, 1 error, 2 usage, 3 gateway unreachable, 4 authentication.
