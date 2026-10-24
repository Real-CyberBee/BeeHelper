import Foundation
import Darwin

signal(SIGPIPE, SIG_IGN)
let args = Array(CommandLine.arguments.dropFirst())
let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
let root = executable.deletingLastPathComponent().deletingLastPathComponent()
func option(_ name: String) -> String? { guard let index = args.firstIndex(of: name), index+1 < args.count else { return nil }; return args[index+1] }
do {
    if args.contains("--install") || args.contains("--uninstall") {
        let home = option("--home").map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser
        if args.contains("--uninstall") { try Installer.uninstall(home: home); print("BeeHelper 连接器已卸载，浏览器与 Agent 数据仍保留。") }
        else {
            let result = try Installer.install(source: option("--source").map { URL(fileURLWithPath: $0) } ?? root, home: home)
            if args.contains("--gui") { print(result["extension"]!) }
            else { print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self)) }
        }
    } else {
        guard args.isEmpty || args == ["--mcp"] || args[0] == "chrome-extension://\(Installer.extensionId)/" else { throw NSError(domain: "BeeHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "不受信任的连接来源或参数"]) }
        let bridge = Bridge(root: root)
        try bridge.start(args.contains("--mcp") ? "mcp" : "host")
        RunLoop.current.run()
        bridge.shutdown()
    }
} catch {
    FileHandle.standardError.write(Data(("BeeHelper: \(error.localizedDescription)\n").utf8)); exit(1)
}
