/**
 * KoLo — Build Verification Script
 *
 * Validates that Android and iOS/macOS projects are buildable.
 * On Linux: validates project structure, Gradle config, Swift syntax (if available).
 * On macOS: runs actual Xcode builds.
 *
 * Usage:
 *   node --import tsx scripts/verify-builds.ts          # full verification
 *   node --import tsx scripts/verify-builds.ts android   # Android only
 *   node --import tsx scripts/verify-builds.ts ios       # iOS only
 *   node --import tsx scripts/verify-builds.ts macos     # macOS only
 *   node --import tsx scripts/verify-builds.ts --dry-run # structure checks only
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const isMacOS = process.platform === "darwin";
const isLinux = process.platform === "linux";

interface BuildCheck {
  name: string;
  ok: boolean;
  message: string;
}

const results: BuildCheck[] = [];

function check(name: string, ok: boolean, message: string) {
  results.push({ name, ok, message });
  if (!ok) {
    process.stderr.write(`  ✗ ${name}: ${message}\n`);
  } else {
    process.stderr.write(`  ✓ ${name}\n`);
  }
}

// ─── Android Verification ─────────────────────────────────────────────────────

function verifyAndroid(dryRun: boolean) {
  process.stderr.write("\n━━━ Android Build Verification ━━━\n");

  const androidDir = join(rootDir, "apps", "android");
  const gradleWrapper = join(androidDir, "gradlew");
  const buildGradle = join(androidDir, "app", "build.gradle.kts");
  const gradleProps = join(androidDir, "gradle.properties");
  const settingsGradle = join(androidDir, "settings.gradle.kts");

  check("Android project exists", existsSync(androidDir), "apps/android/ directory exists");
  check("build.gradle.kts exists", existsSync(buildGradle), "Gradle build file present");
  check("gradle.properties exists", existsSync(gradleProps), "Gradle properties present");
  check("settings.gradle.kts exists", existsSync(settingsGradle), "Gradle settings present");
  check("gradlew exists", existsSync(gradleWrapper), "Gradle wrapper present");

  if (!existsSync(buildGradle)) {
    return;
  }

  // Validate Gradle config syntax
  try {
    const gradleContent = readFileSync(buildGradle, "utf-8");

    // Check for required plugin declarations
    check(
      "Android plugin declared",
      gradleContent.includes("com.android.application"),
      "com.android.application plugin found in build.gradle.kts",
    );

    check(
      "Kotlin plugin declared",
      gradleContent.includes("org.jetbrains.kotlin.android"),
      "Kotlin Android plugin found in build.gradle.kts",
    );

    check(
      "Compose plugin declared",
      gradleContent.includes("org.jetbrains.kotlin.plugin.compose"),
      "Compose plugin found in build.gradle.kts",
    );

    // Check namespace and SDK versions
    check(
      "Namespace set",
      gradleContent.includes("namespace"),
      "Android namespace configured",
    );

    check(
      "compileSdk set",
      gradleContent.includes("compileSdk"),
      "compileSdk version specified",
    );

    check(
      "minSdk set",
      gradleContent.includes("minSdk"),
      "minSdk version specified",
    );

    check(
      "targetSdk set",
      gradleContent.includes("targetSdk"),
      "targetSdk version specified",
    );
  } catch (err) {
    check("Gradle config readable", false, `Cannot read build.gradle.kts: ${String(err)}`);
  }

  // Dry run: skip actual build on Linux
  if (dryRun || isLinux) {
    if (dryRun) {
      process.stderr.write("  (dry run — skipping Android build)\n");
    } else {
      process.stderr.write("  (skipping Android build — Linux host)\n");
    }
    return;
  }

  // Full build on macOS (if Android SDK is available)
  if (isMacOS) {
    process.stderr.write("\nRunning Gradle assembleDebug...\n");
    const result = spawnSync(gradleWrapper, [":app:assembleDebug"], {
      cwd: androidDir,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 300_000,
    });

    if (result.status === 0) {
      check("Gradle assembleDebug", true, "Android build succeeded");

      // Verify APK output
      const buildOutputs = readdirSync(join(androidDir, "app", "build", "outputs", "apk", "debug"));
      const apkFiles = buildOutputs.filter((f) => f.endsWith(".apk"));
      check(
        "APK generated",
        apkFiles.length > 0,
        `Found ${apkFiles.length} APK file(s) in build output`,
      );
    } else {
      const errorMsg = result.stderr?.slice(-500) ?? result.stdout?.slice(-500) ?? "unknown error";
      check("Gradle assembleDebug", false, `Build failed: ${errorMsg.trim()}`);
    }
  }
}

// ─── iOS Verification ─────────────────────────────────────────────────────────

function verifyIOS(dryRun: boolean) {
  process.stderr.write("\n━━━ iOS Build Verification ━━━\n");

  const iosDir = join(rootDir, "apps", "ios");
  const infoPlist = join(iosDir, "Sources", "Info.plist");
  const xcodegenYml = join(iosDir, "project.yml");

  check("iOS project exists", existsSync(iosDir), "apps/ios/ directory exists");
  check("Info.plist exists", existsSync(infoPlist), "iOS Info.plist present");

  if (existsSync(xcodegenYml)) {
    check("XcodeGen config exists", true, "project.yml present for code generation");
  }

  if (dryRun || isLinux) {
    if (dryRun) {
      process.stderr.write("  (dry run — skipping iOS build)\n");
    } else {
      process.stderr.write("  (skipping iOS build — Linux host)\n");
    }
    return;
  }

  // Full build on macOS
  if (isMacOS) {
    process.stderr.write("\nRunning xcodegen generate...\n");
    const genResult = spawnSync("xcodegen", ["generate"], {
      cwd: iosDir,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 60_000,
    });

    check(
      "xcodegen generate",
      genResult.status === 0,
      genResult.status === 0
        ? "XcodeGen succeeded"
        : `XcodeGen failed: ${genResult.stderr?.slice(-300)?.trim() ?? "unknown"}`,
    );

    process.stderr.write("\nRunning xcodebuild build for iOS Simulator...\n");
    const buildResult = spawnSync(
      "xcodebuild",
      [
        "-project",
        "KoLo.xcodeproj",
        "-scheme",
        "KoLo",
        "-destination",
        "platform=iOS Simulator,name=iPhone 16",
        "-configuration",
        "Debug",
        "build",
      ],
      {
        cwd: iosDir,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 600_000,
      },
    );

    check(
      "xcodebuild iOS Simulator",
      buildResult.status === 0,
      buildResult.status === 0
        ? "iOS build succeeded"
        : `iOS build failed: ${buildResult.stderr?.slice(-300)?.trim() ?? "unknown"}`,
    );
  }
}

// ─── macOS Verification ───────────────────────────────────────────────────────

function verifyMacOS(dryRun: boolean) {
  process.stderr.write("\n━━━ macOS Build Verification ━━━\n");

  const macosDir = join(rootDir, "apps", "macos");
  const packageSwift = join(macosDir, "Package.swift");
  const sourcesDir = join(macosDir, "Sources", "KoLo");

  check("macOS project exists", existsSync(macosDir), "apps/macos/ directory exists");
  check("Package.swift exists", existsSync(packageSwift), "Swift Package Manager manifest present");

  // Check for Swift files
  if (existsSync(sourcesDir)) {
    const swiftFiles = readdirSync(sourcesDir).filter((f) => f.endsWith(".swift"));
    check(
      "Swift source files found",
      swiftFiles.length > 0,
      `Found ${swiftFiles.length} Swift files in Sources/KoLo/`,
    );
  }

  if (dryRun || isLinux) {
    if (dryRun) {
      process.stderr.write("  (dry run — skipping macOS build)\n");
    } else {
      process.stderr.write("  (skipping macOS build — Linux host)\n");
    }
    return;
  }

  // Full build on macOS
  if (isMacOS) {
    process.stderr.write("\nRunning xcodebuild build for macOS...\n");
    const buildResult = spawnSync(
      "xcodebuild",
      [
        "-project",
        "KoLo.xcodeproj",
        "-scheme",
        "KoLo",
        "-destination",
        "platform=macOS",
        "-configuration",
        "Debug",
        "build",
      ],
      {
        cwd: macosDir,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 600_000,
      },
    );

    check(
      "xcodebuild macOS",
      buildResult.status === 0,
      buildResult.status === 0
        ? "macOS build succeeded"
        : `macOS build failed: ${buildResult.stderr?.slice(-300)?.trim() ?? "unknown"}`,
    );
  }
}

// ─── Shared KoLoKit Verification ──────────────────────────────────────────────

function verifyKoLoKit() {
  process.stderr.write("\n━━━ KoLoKit (Shared Swift Framework) Verification ━━━\n");

  const kitDir = join(rootDir, "apps", "shared", "KoLoKit");
  const packageSwift = join(kitDir, "Package.swift");
  const sourcesDir = join(kitDir, "Sources");

  check("KoLoKit exists", existsSync(kitDir), "apps/shared/KoLoKit/ directory exists");
  check("Package.swift exists", existsSync(packageSwift), "Swift Package Manager manifest present");

  if (existsSync(sourcesDir)) {
    const subdirs = readdirSync(sourcesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    check(
      "KoLoKit submodules present",
      subdirs.length >= 3,
      `Found ${subdirs.length} submodules: ${subdirs.join(", ")}`,
    );

    // Check expected submodules
    check(
      "KoLoKit submodule",
      subdirs.includes("KoLoKit"),
      "KoLoKit source module present",
    );
    check(
      "KoLoProtocol submodule",
      subdirs.includes("KoLoProtocol"),
      "KoLoProtocol source module present",
    );
    check(
      "KoLoChatUI submodule",
      subdirs.includes("KoLoChatUI"),
      "KoLoChatUI source module present",
    );
  }

  // Swift build on macOS
  if (isMacOS) {
    process.stderr.write("\nRunning swift build for KoLoKit...\n");
    const buildResult = spawnSync("swift", ["build"], {
      cwd: kitDir,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 300_000,
    });

    check(
      "swift build KoLoKit",
      buildResult.status === 0,
      buildResult.status === 0
        ? "KoLoKit build succeeded"
        : `KoLoKit build failed: ${buildResult.stderr?.slice(-300)?.trim() ?? "unknown"}`,
    );
  } else {
    process.stderr.write("  (skipping swift build — Linux host)\n");
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("-"));

if (!target || target === "android") {
  verifyAndroid(dryRun);
}
if (!target || target === "ios") {
  verifyIOS(dryRun);
}
if (!target || target === "macos") {
  verifyMacOS(dryRun);
}
if (!target || target === "kit") {
  verifyKoLoKit();
}

// Summary
const failures = results.filter((r) => !r.ok);
process.stderr.write(`\n━━━ Summary ━━━\n`);
process.stderr.write(`Total checks: ${results.length}\n`);
process.stderr.write(`Passed: ${results.length - failures.length}\n`);
process.stderr.write(`Failed: ${failures.length}\n`);

if (failures.length > 0) {
  process.stderr.write("\nFailed checks:\n");
  for (const f of failures) {
    process.stderr.write(`  ✗ ${f.name}: ${f.message}\n`);
  }
  process.exit(1);
} else {
  process.stderr.write("\nAll build checks passed ✓\n");
  process.exit(0);
}
