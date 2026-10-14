import Testing
@testable import KoLoDiscovery

@Suite
struct WideAreaGatewayDiscoveryTests {
    @Test func discoversBeaconFromTailnetDnsSdFallback() {
        setenv("KOLO_WIDE_AREA_DOMAIN", "kolo.internal", 1)
        let statusJson = """
        {
          "Self": { "TailscaleIPs": ["100.69.232.64"] },
          "Peer": {
            "peer-1": { "TailscaleIPs": ["100.123.224.76"] }
          }
        }
        """

        let context = WideAreaGatewayDiscovery.DiscoveryContext(
            tailscaleStatus: { statusJson },
            dig: { args, _ in
                let recordType = args.last ?? ""
                let nameserver = args.first(where: { $0.hasPrefix("@") }) ?? ""
                if recordType == "PTR" {
                    if nameserver == "@100.123.224.76" {
                        return "steipetacstudio-gateway._kolo-gw._tcp.kolo.internal.\n"
                    }
                    return ""
                }
                if recordType == "SRV" {
                    return "0 0 18789 steipetacstudio.kolo.internal."
                }
                if recordType == "TXT" {
                    return "\"displayName=Dev\\226\\128\\153s Mac Studio (KoLo)\" \"gatewayPort=18789\" \"tailnetDns=dev-mac-studio-1.example.ts.net\" \"cliPath=/Users/dev/kolo/src/entry.ts\""
                }
                return ""
            })

        let beacons = WideAreaGatewayDiscovery.discover(
            timeoutSeconds: 2.0,
            context: context)

        #expect(beacons.count == 1)
        let beacon = beacons[0]
        let expectedDisplay = "Dev\u{2019}s Mac Studio (KoLo)"
        #expect(beacon.displayName == expectedDisplay)
        #expect(beacon.port == 18789)
        #expect(beacon.gatewayPort == 18789)
        #expect(beacon.tailnetDns == "dev-mac-studio-1.example.ts.net")
        #expect(beacon.cliPath == "/Users/dev/kolo/src/entry.ts")
    }
}
