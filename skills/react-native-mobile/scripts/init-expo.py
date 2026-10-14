#!/usr/bin/env python3
"""
init-expo.py — Scaffold a React Native project with Expo SDK 52+, Expo Router v4,
NativeWind v4, TypeScript, and EAS Build.

Usage:
    python3 init-expo.py my-app
    python3 init-expo.py my-app --skip-install
    python3 init-expo.py my-app --blank  # minimal template, no tabs
    python3 init-expo.py my-app --name "My App" --bundle com.example.myapp

Requirements: Node.js 18+, npm 9+ (or bun)
"""

import argparse
import os
import subprocess
import sys
import json
from pathlib import Path


TEMPLATE_FILES = {
    # ── Root layouts ──
    "app/_layout.tsx": r"""import { Stack } from 'expo-router';
import '../global.css';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{ presentation: 'modal', title: 'Modal' }}
      />
    </Stack>
  );
}
""",

    "app/+not-found.tsx": r"""import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950 p-8">
        <Text className="text-6xl font-bold text-gray-300 dark:text-gray-700">
          404
        </Text>
        <Text className="mt-4 text-lg text-gray-600 dark:text-gray-400 text-center">
          This screen doesn't exist.
        </Text>
        <Link href="/" className="mt-8">
          <Text className="text-blue-500 text-base font-semibold">
            Go to home screen
          </Text>
        </Link>
      </View>
    </>
  );
}
""",

    # ── Tab layout group ──
    "app/(tabs)/_layout.tsx": r"""import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { backgroundColor: '#ffffff' },
        headerStyle: { backgroundColor: '#ffffff' },
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
""",

    "app/(tabs)/index.tsx": r"""import { View, Text, ScrollView, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome 👋
        </Text>
        <Text className="mt-2 text-base text-gray-500 dark:text-gray-400">
          Your Expo SDK 52+ app is ready with Router v4 and NativeWind v4.
        </Text>

        <View className="mt-8 gap-4">
          <Link href="/modal" asChild>
            <Pressable className="bg-blue-500 rounded-xl p-4 active:opacity-80">
              <Text className="text-white text-center font-semibold text-base">
                Open Modal
              </Text>
            </Pressable>
          </Link>

          <Link href="/explore" asChild>
            <Pressable className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4 active:opacity-80">
              <Text className="text-gray-900 dark:text-white text-center font-semibold text-base">
                Explore Screen
              </Text>
            </Pressable>
          </Link>
        </View>

        <View className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
          <Text className="text-sm font-mono text-gray-500 dark:text-gray-400">
            Built with Expo SDK 52+{'\n'}
            Expo Router v4 (file-based routing){'\n'}
            NativeWind v4 (Tailwind CSS){'\n'}
            TypeScript strict mode
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
""",

    "app/(tabs)/explore.tsx": r"""import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ExploreScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white">
          Explore
        </Text>
        <Text className="mt-2 text-base text-gray-500 dark:text-gray-400">
          Discover features and content.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
""",

    "app/(tabs)/settings.tsx": r"""import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </Text>

        <View className="mt-6 gap-1">
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-base text-gray-900 dark:text-white">
              Push Notifications
            </Text>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            />
          </View>

          <View className="flex-row items-center justify-between py-3 border-t border-gray-100 dark:border-gray-800">
            <Text className="text-base text-gray-900 dark:text-white">
              Dark Mode
            </Text>
            <Switch
              value={darkMode}
              onValueChange={setDarkMode}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            />
          </View>

          <Pressable className="py-3 border-t border-gray-100 dark:border-gray-800">
            <Text className="text-base text-gray-900 dark:text-white">
              Account
            </Text>
          </Pressable>

          <Pressable className="py-3 border-t border-gray-100 dark:border-gray-800">
            <Text className="text-base text-gray-900 dark:text-white">
              About
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
""",

    # ── Modal ──
    "app/modal.tsx": r"""import { View, Text, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function ModalScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950 p-8">
      <StatusBar style="auto" />
      <Stack.Screen options={{ title: 'Modal' }} />
      <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Modal Screen
      </Text>
      <Text className="text-base text-gray-500 dark:text-gray-400 text-center mb-8">
        This is a modal presented over the tab navigator.
      </Text>
      <Pressable
        onPress={() => router.back()}
        className="bg-gray-900 dark:bg-white rounded-xl px-8 py-4 active:opacity-80"
      >
        <Text className="text-white dark:text-gray-900 font-semibold text-base">
          Dismiss
        </Text>
      </Pressable>
    </View>
  );
}
""",

    # ── Config files ──
    "global.css": r"""@tailwind base;
@tailwind components;
@tailwind utilities;
""",

    "tailwind.config.ts": r"""import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Add custom brand colors here
      },
    },
  },
  plugins: [],
};

export default config;
""",

    "nativewind-env.d.ts": r"""/// <reference types="nativewind/types" />
""",

    # ── Component stubs ──
    "components/.gitkeep": "",

    "lib/.gitkeep": "",
    "lib/api.ts": r"""// API client — configure your base URL and auth interceptors here

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function apiClient<T = unknown>(
  endpoint: string,
  options: ApiOptions = {},
): Promise<T> {
  const { body, headers, ...rest } = options;

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (error as { message?: string }).message || res.statusText);
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
""",

    "hooks/.gitkeep": "",
    "hooks/useColorScheme.ts": r"""import { useColorScheme as useNativeColorScheme } from 'react-native';

export function useColorScheme() {
  return useNativeColorScheme() ?? 'light';
}
""",

    "stores/.gitkeep": "",

    "assets/.gitkeep": "",
}


BLANK_TEMPLATE_FILES = {
    "app/_layout.tsx": r"""import { Stack } from 'expo-router';
import '../global.css';

export default function RootLayout() {
  return <Stack />;
}
""",

    "app/index.tsx": r"""import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-white dark:bg-gray-950">
      <Text className="text-2xl font-bold text-gray-900 dark:text-white">
        Hello, Expo! 👋
      </Text>
    </SafeAreaView>
  );
}
""",

    "app/+not-found.tsx": TEMPLATE_FILES["app/+not-found.tsx"],
    "global.css": TEMPLATE_FILES["global.css"],
    "tailwind.config.ts": TEMPLATE_FILES["tailwind.config.ts"],
    "nativewind-env.d.ts": TEMPLATE_FILES["nativewind-env.d.ts"],
    "components/.gitkeep": "",
    "lib/.gitkeep": "",
    "lib/api.ts": TEMPLATE_FILES["lib/api.ts"],
    "hooks/.gitkeep": "",
    "hooks/useColorScheme.ts": TEMPLATE_FILES["hooks/useColorScheme.ts"],
    "stores/.gitkeep": "",
    "assets/.gitkeep": "",
}


def run(cmd: str, cwd: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """Run a shell command and return the result."""
    print(f"  → {cmd}")
    return subprocess.run(cmd, shell=True, cwd=cwd, check=check, text=True)


def run_quiet(cmd: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a command, raising on failure but not printing output."""
    return subprocess.run(
        cmd, shell=True, cwd=cwd, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


def check_node() -> None:
    """Verify Node.js and npm are available."""
    try:
        node_v = run_quiet("node --version").stdout.strip()
        npm_v = run_quiet("npm --version").stdout.strip()
        print(f"[OK] Node {node_v}, npm {npm_v}")
    except FileNotFoundError:
        print("[ERROR] Node.js is not installed. Install from https://nodejs.org (v18+ required)")
        sys.exit(1)
    except subprocess.CalledProcessError:
        print("[ERROR] Node.js check failed. Ensure Node.js v18+ is installed.")
        sys.exit(1)


def create_expo_app(project_name: str, skip_install: bool, blank: bool) -> None:
    """Scaffold the Expo project using create-expo-app."""
    project_path = Path.cwd() / project_name
    if project_path.exists():
        print(f"[WARN] Directory '{project_name}' already exists. Using it.")
    else:
        print(f"\n── Creating Expo project: {project_name} ──")
        template_flag = "--template blank-typescript" if blank else "--template tabs@54"
        cmd = f"npx create-expo-app@latest {project_name} {template_flag} --no-install"
        run(cmd)

    if not skip_install:
        print(f"\n── Installing dependencies ──")
        run("npm install", cwd=str(project_path))
    else:
        print(f"\n[SKIP] Dependency installation (use --skip-install).")
        print(f"  Run `cd {project_name} && npm install` to install later.")
        return


def install_nativewind(project_path: Path, skip_install: bool) -> None:
    """Install and configure NativeWind v4."""
    print(f"\n── Setting up NativeWind v4 ──")

    deps = "nativewind tailwindcss"
    dev_deps = "@types/react-native"

    if not skip_install:
        run(f"npm install {deps}", cwd=str(project_path))
        run(f"npm install -D {dev_deps}", cwd=str(project_path))
    else:
        print(f"  [SKIP] npm install nativewind tailwindcss")
        print(f"  [SKIP] npm install -D {dev_deps}")


def install_router_deps(project_path: Path, skip_install: bool) -> None:
    """Install Expo Router and related dependencies."""
    print(f"\n── Installing Expo Router helpers ──")

    deps = (
        "@expo/vector-icons "
        "react-native-safe-area-context "
        "react-native-screens "
        "expo-linking "
        "expo-constants "
        "expo-status-bar"
    )

    if not skip_install:
        run(f"npx expo install {deps}", cwd=str(project_path))
    else:
        print(f"  [SKIP] npx expo install {deps}")


def write_template_files(project_path: Path, blank: bool) -> None:
    """Write all template files to the project."""
    files = BLANK_TEMPLATE_FILES if blank else TEMPLATE_FILES

    print(f"\n── Writing template files ──")
    for rel_path, content in files.items():
        full_path = project_path / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # For blank template, don't overwrite if the create-expo-app already created them
        if blank and full_path.exists() and rel_path in ("app/_layout.tsx", "app/index.tsx"):
            print(f"  skip (exists): {rel_path}")
            continue

        full_path.write_text(content)
        print(f"  write: {rel_path}")


def configure_expo_config(project_path: Path, app_name: str | None, bundle_id: str | None) -> None:
    """Update app.json with user-provided name and bundle ID."""
    app_json_path = project_path / "app.json"
    if not app_json_path.exists():
        print("[WARN] No app.json found. Skipping Expo config update.")
        return

    try:
        config = json.loads(app_json_path.read_text())

        if app_name:
            config.setdefault("expo", {})["name"] = app_name
            print(f"  Set app name: {app_name}")

        if bundle_id:
            # Update iOS bundle identifier
            config.setdefault("expo", {}).setdefault("ios", {})["bundleIdentifier"] = bundle_id
            # Update Android package
            config.setdefault("expo", {}).setdefault("android", {})["package"] = bundle_id
            print(f"  Set bundle ID: {bundle_id}")

        app_json_path.write_text(json.dumps(config, indent=2) + "\n")
        print(f"  Updated app.json")
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[WARN] Could not update app.json: {e}")


def init_eas(project_path: Path) -> None:
    """Create eas.json if it doesn't exist."""
    eas_json_path = project_path / "eas.json"
    if eas_json_path.exists():
        print(f"  eas.json already exists — skipping.")
        return

    eas_config = {
        "cli": {"version": ">= 12.0.0"},
        "build": {
            "development": {
                "developmentClient": True,
                "distribution": "internal",
                "env": {"APP_VARIANT": "development"},
            },
            "preview": {
                "distribution": "internal",
                "env": {"APP_VARIANT": "preview"},
            },
            "production": {
                "autoIncrement": True,
                "env": {"APP_VARIANT": "production"},
            },
        },
        "submit": {
            "production": {
                "ios": {"appleId": "your@email.com", "ascAppId": "1234567890", "appleTeamId": "ABCDEF1234"},
                "android": {"track": "internal", "releaseStatus": "draft"},
            }
        },
    }
    eas_json_path.write_text(json.dumps(eas_config, indent=2) + "\n")
    print(f"  Created eas.json (update submit credentials before deploying)")


def print_next_steps(project_name: str) -> None:
    """Print final instructions."""
    print(f"""
{'=' * 60}
✅  Project '{project_name}' is ready!

Next steps:
  cd {project_name}

  # Start dev server
  npx expo start

  # iOS simulator (macOS only)
  npx expo start --ios

  # Android emulator
  npx expo start --android

  # Run on physical device
  npx expo start --tunnel
    → Scan QR code with Expo Go app

  # Build for production
  npx eas build --platform ios --profile production
  npx eas build --platform android --profile production

  # Submit to stores
  npx eas submit --platform ios
  npx eas submit --platform android

Stack:
  • Expo SDK 52+      • TypeScript (strict)
  • Expo Router v4    • NativeWind v4 (Tailwind)
  • EAS Build/Submit  • react-native-safe-area-context

References:
  skills/react-native-mobile/references/
{'=' * 60}
""")


def main():
    parser = argparse.ArgumentParser(
        description="Scaffold an Expo SDK 52+ project with Router, NativeWind, and EAS.",
    )
    parser.add_argument("name", help="Project name / directory")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install steps")
    parser.add_argument("--blank", action="store_true", help="Minimal template (no tabs)")
    parser.add_argument("--app-name", help="Display name for the app (app.json)")
    parser.add_argument("--bundle", help="Bundle ID / package name (e.g., com.example.myapp)")
    args = parser.parse_args()

    project_name = args.name
    project_path = Path.cwd() / project_name

    print(f"\n{'=' * 60}")
    print(f"  Expo SDK 52+ Project Scaffolder")
    print(f"  Project: {project_name}")
    print(f"  Path: {project_path}")
    print(f"  Template: {'blank' if args.blank else 'tabs'}")
    print(f"{'=' * 60}")

    check_node()
    create_expo_app(project_name, args.skip_install, args.blank)
    install_router_deps(project_path, args.skip_install)
    install_nativewind(project_path, args.skip_install)
    write_template_files(project_path, args.blank)
    configure_expo_config(project_path, args.app_name, args.bundle)
    init_eas(project_path)
    print_next_steps(project_name)


if __name__ == "__main__":
    main()
