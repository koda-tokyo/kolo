---
summary: "Platform support overview (Gateway + companion apps)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

Kurahi core is written in TypeScript. **Node is the recommended runtime**.

Companion apps exist for macOS (menu bar app) and mobile nodes (iOS/Android). Windows and
Linux companion apps are planned, but the Gateway is fully supported today.
Native companion apps for Windows are also planned; the Gateway is recommended via WSL2.

## Choose your OS

- macOS: [macOS](/platforms/macos)
- iOS: [iOS](/platforms/ios)
- Android: [Android](/platforms/android)
- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/platforms/fly)
- Hetzner (Docker): [Hetzner](/platforms/hetzner)
- GCP (Compute Engine): [GCP](/platforms/gcp)
- exe.dev (VM + HTTPS proxy): [exe.dev](/platforms/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `Kurahi gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `Kurahi onboard --install-daemon`
- Direct: `Kurahi gateway install`
- Configure flow: `Kurahi configure` → select **Gateway service**
- Repair/migrate: `Kurahi doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`com.kodasoken.kolo.default` or `com.kodasoken.kolo.<id>`; legacy `com.kolo.*`)
- Linux/WSL2: systemd user service (`kolo-gateway[-<profile>].service`)
