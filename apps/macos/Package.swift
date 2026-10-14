// swift-tools-version: 6.2
// Package manifest for the KoLo macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "KoLo",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "KoLoIPC", targets: ["KoLoIPC"]),
        .library(name: "KoLoDiscovery", targets: ["KoLoDiscovery"]),
        .executable(name: "KoLo", targets: ["KoLo"]),
        .executable(name: "kolo-mac", targets: ["KoLoMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/KoLoKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "KoLoIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "KoLoDiscovery",
            dependencies: [
                .product(name: "KoLoKit", package: "KoLoKit"),
            ],
            path: "Sources/KoLoDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "KoLo",
            dependencies: [
                "KoLoIPC",
                "KoLoDiscovery",
                .product(name: "KoLoKit", package: "KoLoKit"),
                .product(name: "KoLoChatUI", package: "KoLoKit"),
                .product(name: "KoLoProtocol", package: "KoLoKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/KoLo.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "KoLoMacCLI",
            dependencies: [
                "KoLoDiscovery",
                .product(name: "KoLoKit", package: "KoLoKit"),
                .product(name: "KoLoProtocol", package: "KoLoKit"),
            ],
            path: "Sources/KoLoMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "KoLoIPCTests",
            dependencies: [
                "KoLoIPC",
                "KoLo",
                "KoLoDiscovery",
                .product(name: "KoLoProtocol", package: "KoLoKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
