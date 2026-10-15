---
summary: "Zalo Personal plugin: QR login + messaging via zca-cli (plugin install + channel config + CLI + tool)"
read_when:
  - You want Zalo Personal (unofficial) support in Kurahi
  - You are configuring or developing the zalouser plugin
title: "Zalo Personal Plugin"
---

# Zalo Personal (plugin)

Zalo Personal support for Kurahi via a plugin, using `zca-cli` to automate a normal Zalo user account.

> **Warning:** Unofficial automation may lead to account suspension/ban. Use at your own risk.

## Naming

Channel id is `zalouser` to make it explicit this automates a **personal Zalo user account** (unofficial). We keep `zalo` reserved for a potential future official Zalo API integration.

## Where it runs

This plugin runs **inside the Gateway process**.

If you use a remote Gateway, install/configure it on the **machine running the Gateway**, then restart the Gateway.

## Install

### Option A: install from npm

```bash
kurahi plugins install @Kurahi/zalouser
```

Restart the Gateway afterwards.

### Option B: install from a local folder (dev)

```bash
kurahi plugins install ./extensions/zalouser
cd ./extensions/zalouser && pnpm install
```

Restart the Gateway afterwards.

## Prerequisite: zca-cli

The Gateway machine must have `zca` on `PATH`:

```bash
zca --version
```

## Config

Channel config lives under `channels.zalouser` (not `plugins.entries.*`):

```json5
{
  channels: {
    zalouser: {
      enabled: true,
      dmPolicy: "pairing",
    },
  },
}
```

## CLI

```bash
Kurahi channels login --channel zalouser
Kurahi channels logout --channel zalouser
Kurahi channels status --probe
Kurahi message send --channel zalouser --target <threadId> --message "Hello from Kurahi"
Kurahi directory peers list --channel zalouser --query "name"
```

## Agent tool

Tool name: `zalouser`

Actions: `send`, `image`, `link`, `friends`, `groups`, `me`, `status`
