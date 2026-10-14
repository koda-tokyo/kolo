import Foundation

public enum KoLoCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum KoLoCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum KoLoCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum KoLoCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct KoLoCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: KoLoCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: KoLoCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: KoLoCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: KoLoCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct KoLoCameraClipParams: Codable, Sendable, Equatable {
    public var facing: KoLoCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: KoLoCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: KoLoCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: KoLoCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
