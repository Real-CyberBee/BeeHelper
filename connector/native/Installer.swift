import Foundation
import Darwin

struct Installer {
    static let hostName = "io.beehelper.codex"
    static let extensionId = "llkomjgjbldjelaemjcgphogaceejbpi"
    static func paths(_ home: URL) -> (URL, [URL]) {
        let support = home.appendingPathComponent("Library/Application Support")
        return (support.appendingPathComponent("BeeHelper"), ["Google/Chrome", "Google/ChromeForTesting", "Chromium"].map { support.appendingPathComponent("\($0)/NativeMessagingHosts/\(hostName).json") })
    }
    static func json(_ url: URL) throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:] }
    static func install(source: URL, home: URL) throws -> [String: String] {
        let fm = FileManager.default, (root, manifests) = paths(home)
        let metadata = try json(source.appendingPathComponent("distribution.json"))
        let extensionMetadata = try json(source.appendingPathComponent("extension/manifest.json"))
        guard let version = metadata["version"] as? String, version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil,
              metadata["platform"] as? String == "darwin", metadata["engine"] as? String == "system-javascriptcore",
              extensionMetadata["version"] as? String == version else { throw NSError(domain: "BeeHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "安装包元数据或版本不一致"]) }
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x64"
        #endif
        guard metadata["arch"] as? String == architecture else { throw NSError(domain: "BeeHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "安装包 CPU 架构不匹配"]) }
        let components = ["bin", "connector", "extension", "distribution.json", "THIRD_PARTY_NOTICES.txt"]
        for file in ["bin/beehelper", "connector/host.js", "connector/mcp.js", "THIRD_PARTY_NOTICES.txt"] { _ = try Data(contentsOf: source.appendingPathComponent(file)) }
        let release = root.appendingPathComponent("releases/\(version)-\(UUID().uuidString)")
        let current = root.appendingPathComponent("current")
        let temporary = root.appendingPathComponent("current-\(UUID().uuidString)")
        try fm.createDirectory(at: release, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        do {
            for component in components { try fm.copyItem(at: source.appendingPathComponent(component), to: release.appendingPathComponent(component)) }
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: release.appendingPathComponent("bin/beehelper").path)
            try fm.createSymbolicLink(at: temporary, withDestinationURL: release)
            guard Darwin.rename(temporary.path, current.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        } catch { try? fm.removeItem(at: temporary); try? fm.removeItem(at: release); throw error }
        let executable = current.appendingPathComponent("bin/beehelper").path
        for manifest in manifests {
            try fm.createDirectory(at: manifest.deletingLastPathComponent(), withIntermediateDirectories: true)
            let body: [String: Any] = ["name": hostName, "description": "BeeHelper native connector", "path": executable, "type": "stdio", "allowed_origins": ["chrome-extension://\(extensionId)/"]]
            try JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]).write(to: manifest, options: .atomic)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: manifest.path)
        }
        // 原版 Node 安装器的启动脚本已经不再被清单引用。
        try? fm.removeItem(at: root.appendingPathComponent("native-host.sh"))
        return ["version": version, "extension": current.appendingPathComponent("extension").path, "nativeHost": executable]
    }
    static func uninstall(home: URL) throws {
        let fm = FileManager.default, (root, manifests) = paths(home)
        let owned = [root.appendingPathComponent("current/bin/beehelper").path, root.appendingPathComponent("native-host.sh").path]
        for manifest in manifests where fm.fileExists(atPath: manifest.path) {
            let value = try json(manifest)
            if let file = value["path"] as? String, owned.contains(file) { try fm.removeItem(at: manifest) }
        }
        if fm.fileExists(atPath: root.path) { try fm.removeItem(at: root) }
    }
}
