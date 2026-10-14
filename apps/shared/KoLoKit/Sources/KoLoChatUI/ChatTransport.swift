import Foundation

public enum KoLoChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(KoLoChatEventPayload)
    case agent(KoLoAgentEventPayload)
    case seqGap
}

public protocol KoLoChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> KoLoChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [KoLoChatAttachmentPayload]) async throws -> KoLoChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> KoLoChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<KoLoChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension KoLoChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "KoLoChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> KoLoChatSessionsListResponse {
        throw NSError(
            domain: "KoLoChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
