import Foundation
import Testing
@testable import KoLo

@Suite(.serialized)
struct KoLoConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("kolo-config-\(UUID().uuidString)")
            .appendingPathComponent("kolo.json")
            .path

        await TestIsolation.withEnvValues(["KOLO_CONFIG_PATH": override]) {
            #expect(KoLoConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("kolo-config-\(UUID().uuidString)")
            .appendingPathComponent("kolo.json")
            .path

        await TestIsolation.withEnvValues(["KOLO_CONFIG_PATH": override]) {
            KoLoConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(KoLoConfigFile.remoteGatewayPort() == 19999)
            #expect(KoLoConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(KoLoConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(KoLoConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("kolo-config-\(UUID().uuidString)")
            .appendingPathComponent("kolo.json")
            .path

        await TestIsolation.withEnvValues(["KOLO_CONFIG_PATH": override]) {
            KoLoConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            KoLoConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = KoLoConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("kolo-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "KOLO_CONFIG_PATH": nil,
            "KOLO_STATE_DIR": dir,
        ]) {
            #expect(KoLoConfigFile.stateDirURL().path == dir)
            #expect(KoLoConfigFile.url().path == "\(dir)/kolo.json")
        }
    }
}
