import Foundation

/// Native copy of the game save (JSON produced by Game/js/save.js).
///
/// Stored in Application Support (backed up by iCloud/iTunes, never purged by the
/// system). Writes are atomic and happen on a serial background queue. Uses only
/// FileManager/Data APIs — no "required reason" APIs (see PrivacyInfo.xcprivacy).
final class SaveStore {
    static let shared = SaveStore()
    private static let maxBytes = 2 * 1024 * 1024
    private let queue = DispatchQueue(label: "antarktika.save", qos: .utility)
    private let fileURL: URL
    private var latest: String?
    private let lock = NSLock()

    private init() {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let folder = base.appendingPathComponent("Antarktika", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("save-v1.json")
        latest = try? String(contentsOf: fileURL, encoding: .utf8)
    }

    func load() -> String? {
        lock.lock(); defer { lock.unlock() }
        return latest
    }

    func store(_ json: String) {
        guard json.utf8.count <= Self.maxBytes, json.hasPrefix("{"),
              let data = json.data(using: .utf8), (try? JSONSerialization.jsonObject(with: data)) != nil else { return }
        lock.lock(); latest = json; lock.unlock()
        let url = fileURL
        queue.async { try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }

    func clear() {
        lock.lock(); latest = nil; lock.unlock()
        let url = fileURL
        queue.async { try? FileManager.default.removeItem(at: url) }
    }

    /// Encodes a string as a JavaScript string literal (JSON string syntax).
    static func javaScriptStringLiteral(_ value: String) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
