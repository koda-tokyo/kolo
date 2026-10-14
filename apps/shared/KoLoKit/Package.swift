// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "KoLoKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "KoLoProtocol", targets: ["KoLoProtocol"]),
        .library(name: "KoLoKit", targets: ["KoLoKit"]),
        .library(name: "KoLoChatUI", targets: ["KoLoChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "KoLoProtocol",
            path: "Sources/KoLoProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "KoLoKit",
            dependencies: [
                "KoLoProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/KoLoKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "KoLoChatUI",
            dependencies: [
                "KoLoKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/KoLoChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "KoLoKitTests",
            dependencies: ["KoLoKit", "KoLoChatUI"],
            path: "Tests/KoLoKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
