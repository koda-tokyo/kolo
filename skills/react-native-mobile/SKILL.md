---
name: react-native-mobile
description: >-
  Build cross-platform mobile apps for iOS and Android using React Native with
  Expo SDK 52+ and TypeScript. This skill covers project scaffolding (Expo Router,
  NativeWind, EAS), navigation patterns, offline-first data, push notifications,
  deployment to App Store / Google Play, and monorepo code-sharing strategies with
  web. Use this skill when the user asks to build a mobile app, create an Expo
  project, set up React Native, add mobile navigation, deploy to app stores,
  share code between web and mobile, implement offline support, or configure
  push notifications. Triggers: React Native, Expo, mobile app, iOS, Android,
  cross-platform, NativeWind, Expo Router, EAS, mobile deployment, app store.
---

# React Native Mobile — Expo SDK 52+

Build iOS/Android apps with **React Native + Expo SDK 52+**. 2026 stack: Expo Router (file-based routing), NativeWind (Tailwind for RN), TypeScript strict.

## Quick Start

```bash
npx create-expo-app@latest my-app
# Or scaffold with the skill script:
python3 scripts/init-expo.py my-app
```

The scaffold sets up Expo Router v4, NativeWind v4, TypeScript strict, EAS config, and organized folders (`components/`, `lib/`, `hooks/`, `stores/`, `assets/`).

## Reference Table — Load What You Need

| Domain | Reference | When to Load |
|--------|-----------|--------------|
| File-based routing | `references/expo-router.md` | Setting up routes, deep links, typed navigation, modals |
| Styling | `references/nativewind.md` | Tailwind utility classes, dark mode, theme tokens |
| Navigation patterns | `references/navigation-patterns.md` | Stack/tab/drawer/modal, auth flows, onboarding, gestures |
| Offline-first data | `references/offline-first.md` | expo-sqlite, WatermelonDB, sync strategies, conflict resolution |
| Push notifications | `references/push-notifications.md` | Expo Notifications, push tokens, rich notifications, channels |
| Deployment | `references/deployment.md` | EAS Build, store submission (App Store / Google Play), OTA updates |
| Code sharing with web | `references/code-sharing.md` | Monorepo patterns, shared packages, platform-specific files |

## Architecture Decisions (Expo SDK 52+)

- **Expo managed workflow** — No local Xcode/Android Studio needed for dev. Faster iteration. OTA updates via EAS.
- **File-based routing** (Expo Router v4) — Routes map to `app/` directory structure. Layout routes, groups `(tabs)`/`(auth)`, modals via `presentation: 'modal'`.
- **NativeWind v4** — Tailwind utility classes in React Native. Shares design tokens if paired with a web project.
- **EAS Build** — Cloud CI for native builds. `eas build`, `eas submit`, `eas update` for OTA.
- **TypeScript strict** — From day one. No escape hatches.

## When to Use Which Reference (Quick Decision Tree)

| You want to... | Load this |
|---------------|-----------|
| Set up routing / deep links | `expo-router.md` |
| Build tab/stack/modal navigation | `navigation-patterns.md` |
| Style components with Tailwind | `nativewind.md` |
| Add push notifications | `push-notifications.md` |
| Add offline support | `offline-first.md` |
| Deploy to App Store / Google Play | `deployment.md` |
| Share code with a web project | `code-sharing.md` |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-expo.py` | Scaffold a complete Expo SDK 52+ project |

```bash
python3 scripts/init-expo.py <name> [--skip-install] [--blank]
```

## EAS Quick Reference

```bash
eas login
eas build:configure
eas build --platform ios --profile production      # iOS build (cloud)
eas build --platform android --profile production   # Android build (cloud)
eas submit --platform ios                           # Submit to App Store
eas submit --platform android                       # Submit to Google Play
eas update --branch production --message "Fixes"    # OTA update
```

## Architecture: React Native vs Alternatives

| Choose... | When... |
|-----------|---------|
| **React Native (Expo)** | JS/TS team. Web+app code sharing. OTA updates. Fast iteration. |
| **Native (Swift/Kotlin)** | Max performance (games, AR). Deep platform APIs. Team is native-only. |
| **Flutter** | Dart team. High-performance rendering. Web sharing not needed. |
