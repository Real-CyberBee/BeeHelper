import Foundation
import JavaScriptCore
import CryptoKit
import Darwin

// 系统框架承担 IO 与 JS 执行；不实现通用 Node，也不下载运行时。
final class Bridge {
    let context = JSContext()!
    let fm = FileManager.default
    let root: URL
    var children: [Int: Process] = [:]
    var inputs: [Int: FileHandle] = [:]
    var sources: [Int: DispatchSourceRead] = [:]
    var servers: [Int: Int32] = [:]
    var sockets: [Int: Int32] = [:]
    var streamBuffers: [String: Data] = [:]
    var timers: [Int: DispatchWorkItem] = [:]
    var files = Set<Int32>()
    var hashers: [Int: SHA256] = [:]
    var signalSources: [DispatchSourceSignal] = []
    var serial = 1_000_000
    init(root: URL) {
        self.root = root
        context.exceptionHandler = { _, exception in
            FileHandle.standardError.write(Data(("JavaScriptCore: \(exception?.toString() ?? "未知错误")\n").utf8))
        }
        let call: @convention(block) (String) -> String = { [unowned self] json in
            do {
                let args = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
                let result = try self.call(args)
                let data = try JSONSerialization.data(withJSONObject: ["ok": true, "data": result], options: [.fragmentsAllowed, .sortedKeys])
                return String(decoding: data, as: UTF8.self)
            } catch {
                let ns = error as NSError
                let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError
                let number = underlying?.code ?? ns.code
                let code = number == Int(ENOENT) || ns.code == NSFileReadNoSuchFileError ? "ENOENT" : number == Int(EEXIST) ? "EEXIST" : "EIO"
                let data = try! JSONSerialization.data(withJSONObject: ["ok": false, "error": ns.localizedDescription, "code": code])
                return String(decoding: data, as: UTF8.self)
            }
        }
        context.setObject(call, forKeyedSubscript: "__beeNative" as NSString)
        context.setObject(root.path, forKeyedSubscript: "__beeRoot" as NSString)
    }
    func event(_ id: Any, _ type: String, _ data: Any = NSNull()) {
        context.objectForKeyedSubscript("__beeEvent")?.call(withArguments: [id, type, data])
    }
    func error(_ text: String) -> NSError { NSError(domain: "BeeHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    func posix() -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    func bytes(_ value: Any?) -> Data { Data((value as? [NSNumber] ?? []).map { $0.uint8Value }) }
    func readText(_ id: Int, _ type: String, _ data: Data) {
        let key = "\(id):\(type)"
        var pending = streamBuffers[key] ?? Data(); pending.append(data)
        for tail in 0...min(3, pending.count) {
            let prefix = pending.prefix(pending.count - tail)
            if let text = String(data: prefix, encoding: .utf8) {
                streamBuffers[key] = pending.suffix(tail)
                if !text.isEmpty { event(id, type, text) }
                return
            }
        }
        streamBuffers[key] = Data(); event(id, type, String(decoding: pending, as: UTF8.self))
    }
    func pipe(_ handle: FileHandle, id: Int, type: String) {
        handle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.readText(id, type, data) }
        }
    }
    func writeAll(_ fd: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count-offset)
                if count < 0 { if errno == EINTR { continue }; throw posix() }
                if count == 0 { throw error("无法继续写入通道") }
                offset += count
            }
        }
    }
    func address(_ file: String) throws -> sockaddr_un {
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let value = Array(file.utf8) + [0]
        guard value.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw error("本地套接字路径过长") }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: value) }
        return address
    }
    func socketClose(_ id: Int) {
        sources.removeValue(forKey: id)?.cancel()
        if let fd = sockets.removeValue(forKey: id) { Darwin.close(fd); event(id, "end"); event(id, "close") }
    }
    func watchSocket(_ id: Int, fd: Int32) {
        sockets[id] = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            var buffer = [UInt8](repeating: 0, count: 65536)
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count > 0 { self.readText(id, "data", Data(buffer.prefix(count))) }
            else if count == 0 || (errno != EINTR && errno != EAGAIN) { self.socketClose(id) }
        }
        sources[id] = source; source.resume()
    }
    func call(_ args: [String: Any]) throws -> Any {
        let method = args["method"] as? String ?? ""
        let file = args["file"] as? String ?? ""
        let id = args["id"] as? Int ?? 0
        switch method {
        case "info":
            let mcp = CommandLine.arguments.dropFirst().contains("--mcp")
            let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = (env["PATH"] ?? "/usr/bin:/bin") + ":/opt/homebrew/bin:/usr/local/bin"
            return ["env": env, "argv": [executable, root.appendingPathComponent(mcp ? "connector/mcp.mjs" : "connector/host.mjs").path] + (mcp ? [] : Array(CommandLine.arguments.dropFirst())), "execPath": executable, "platform": "darwin", "home": fm.homeDirectoryForCurrentUser.path, "tmp": NSTemporaryDirectory(), "cwd": fm.currentDirectoryPath]
        case "url":
            guard let url = URL(string: args["value"] as? String ?? "", relativeTo: (args["base"] as? String).flatMap { URL(string: $0) })?.absoluteURL, let scheme = url.scheme else { throw error("URL 无效") }
            return ["href": url.absoluteString, "protocol": scheme+":", "hostname": url.host ?? "", "pathname": url.path, "search": url.query.map { "?"+$0 } ?? ""]
        case "filePath": guard let url = URL(string: args["value"] as? String ?? ""), url.isFileURL else { throw error("文件 URL 无效") }; return url.path
        case "fileURL": return URL(fileURLWithPath: file).absoluteString
        case "uuid": return UUID().uuidString.lowercased()
        case "random":
            let length = args["length"] as? Int ?? 0
            guard length >= 0 && length <= 1_000_000 else { throw error("随机数长度无效") }
            var data = [UInt8](repeating: 0, count: length)
            guard SecRandomCopyBytes(kSecRandomDefault, length, &data) == errSecSuccess else { throw error("无法生成安全随机数") }
            return data
        case "hashStart":
            guard args["algorithm"] as? String == "sha256" else { throw error("仅支持 SHA256") }
            serial += 1; hashers[serial] = SHA256(); return serial
        case "hashUpdate":
            guard var hash = hashers[id] else { throw error("哈希状态已失效") }
            hash.update(data: bytes(args["bytes"])); hashers[id] = hash; return true
        case "hashEnd":
            guard let hash = hashers.removeValue(forKey: id) else { throw error("哈希状态已失效") }
            return Array(hash.finalize())
        case "equal":
            let a = bytes(args["a"]), b = bytes(args["b"])
            guard a.count == b.count else { return false }
            var difference: UInt8 = 0
            for (left, right) in zip(a,b) { difference |= left ^ right }
            return difference == 0
        case "encode":
            let value = args["value"] as? String ?? "", encoding = args["encoding"] as? String ?? "utf8"
            if encoding == "base64" { guard let result = Data(base64Encoded: value) else { throw error("Base64 编码无效") }; return Array(result) }
            if encoding == "hex" { var result = [UInt8](); var index = value.startIndex; while index < value.endIndex { let end = value.index(index, offsetBy: 2, limitedBy: value.endIndex) ?? value.endIndex; guard let byte = UInt8(value[index..<end], radix: 16) else { throw error("Hex 编码无效") }; result.append(byte); index = end }; return result }
            return Array(value.utf8)
        case "decode":
            let data = bytes(args["bytes"]), encoding = args["encoding"] as? String ?? "utf8"
            if encoding == "base64" { return data.base64EncodedString() }
            if encoding == "hex" { return data.map { String(format: "%02x", $0) }.joined() }
            if args["fatal"] as? Bool == true { guard let result = String(data: data, encoding: .utf8) else { throw error("UTF-8 编码无效") }; return result }
            return String(decoding: data, as: UTF8.self)
        case "stdout": try writeAll(STDOUT_FILENO, bytes(args["bytes"])); return true
        case "stderr": FileHandle.standardError.write(Data((args["text"] as? String ?? "").utf8)); return true
        case "exit": shutdown(); Darwin.exit(Int32(args["code"] as? Int ?? 0))
        case "timer":
            let item = DispatchWorkItem { [weak self] in self?.timers.removeValue(forKey: id); self?.event(id, "timer") }
            timers[id] = item; DispatchQueue.main.asyncAfter(deadline: .now() + Double(args["delay"] as? Int ?? 0)/1000, execute: item); return true
        case "clearTimer": timers.removeValue(forKey: id)?.cancel(); return true
        case "access": guard fm.fileExists(atPath: file) else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOENT)) }; return true
        case "readdir": return try fm.contentsOfDirectory(atPath: file)
        case "realpath": return URL(fileURLWithPath: file).resolvingSymlinksInPath().path
        case "mkdir": try fm.createDirectory(atPath: file, withIntermediateDirectories: args["recursive"] as? Bool ?? false, attributes: [.posixPermissions: args["mode"] as? Int ?? 0o700]); return true
        case "mkdtemp":
            var value = Array(((args["prefix"] as? String ?? "")+"XXXXXX").utf8CString)
            guard mkdtemp(&value) != nil else { throw posix() }; return String(cString: value)
        case "chmod": guard Darwin.chmod(file, mode_t(args["mode"] as? Int ?? 0o600)) == 0 else { throw posix() }; return true
        case "rename": guard Darwin.rename(file, args["target"] as? String ?? "") == 0 else { throw posix() }; return true
        case "rm": if fm.fileExists(atPath: file) { try fm.removeItem(atPath: file) } else if args["force"] as? Bool != true { throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOENT)) }; return true
        case "readFile": return Array(try Data(contentsOf: URL(fileURLWithPath: file)))
        case "stat": let attrs = try fm.attributesOfItem(atPath: file); return ["size": attrs[.size] ?? 0, "file": attrs[.type] as? FileAttributeType == .typeRegular]
        case "fileOpen":
            let flags = args["flags"] as? String ?? "r"
            let fd = Darwin.open(file, flags == "r" ? O_RDONLY : O_RDWR | O_CREAT | O_EXCL, mode_t(args["mode"] as? Int ?? 0o600))
            guard fd >= 0 else { throw posix() }; files.insert(fd); return Int(fd)
        case "fileRead":
            let fd = Int32(args["fd"] as? Int ?? -1); guard files.contains(fd) else { throw error("文件已关闭") }
            let length = args["length"] as? Int ?? 0
            guard length >= 0 && length <= 1_000_000 else { throw error("读取长度无效") }
            var data = [UInt8](repeating: 0, count: length)
            let count = pread(fd, &data, length, off_t(args["position"] as? Int ?? 0))
            guard count >= 0 else { throw posix() }; return Array(data.prefix(count))
        case "fileWrite":
            let fd = Int32(args["fd"] as? Int ?? -1); guard files.contains(fd) else { throw error("文件已关闭") }
            let data = bytes(args["bytes"])
            let count = data.withUnsafeBytes { pwrite(fd, $0.baseAddress, $0.count, off_t(args["position"] as? Int ?? 0)) }
            guard count >= 0 else { throw posix() }; return count
        case "fileSync": guard fsync(Int32(args["fd"] as? Int ?? -1)) == 0 else { throw posix() }; return true
        case "fileClose": let fd = Int32(args["fd"] as? Int ?? -1); if files.remove(fd) != nil { Darwin.close(fd) }; return true
        case "spawn":
            let child = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
            child.executableURL = URL(fileURLWithPath: args["command"] as? String ?? ""); child.arguments = args["args"] as? [String] ?? []
            child.environment = args["env"] as? [String: String] ?? ProcessInfo.processInfo.environment
            if let cwd = args["cwd"] as? String { child.currentDirectoryURL = URL(fileURLWithPath: cwd) }
            child.standardInput = input; child.standardOutput = output; child.standardError = errors
            pipe(output.fileHandleForReading, id: id, type: "stdout"); pipe(errors.fileHandleForReading, id: id, type: "stderr")
            child.terminationHandler = { [weak self] process in
                DispatchQueue.main.asyncAfter(deadline: .now()+0.02) { self?.children.removeValue(forKey: id); self?.inputs.removeValue(forKey: id); self?.event(id, "exit", Int(process.terminationStatus)) }
            }
            try child.run(); children[id] = child; inputs[id] = input.fileHandleForWriting; return true
        case "childWrite": guard let input = inputs[id] else { throw error("Agent 输入已关闭") }; try input.write(contentsOf: Data((args["text"] as? String ?? "").utf8)); return true
        case "childEnd": try inputs.removeValue(forKey: id)?.close(); return true
        case "childKill": if let child = children[id], child.isRunning { kill(child.processIdentifier, args["signal"] as? String == "SIGKILL" ? SIGKILL : SIGTERM) }; return true
        case "execSync":
            let child = Process(), output = Pipe(); child.executableURL = URL(fileURLWithPath: args["command"] as? String ?? ""); child.arguments = args["args"] as? [String] ?? []
            child.standardOutput = output; child.standardError = FileHandle.nullDevice
            try child.run()
            let deadline = DispatchWorkItem { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
            DispatchQueue.global().asyncAfter(deadline: .now()+Double(args["timeout"] as? Int ?? 5000)/1000, execute: deadline)
            let data = output.fileHandleForReading.readDataToEndOfFile(); child.waitUntilExit(); deadline.cancel()
            guard child.terminationStatus == 0 else { throw error("客户端版本检查失败") }; return String(decoding: data, as: UTF8.self)
        case "listen", "connect":
            let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0); guard fd >= 0 else { throw posix() }
            var addr = try address(file)
            let result = withUnsafePointer(to: &addr) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { method == "listen" ? Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) : Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
            guard result == 0 else { Darwin.close(fd); throw posix() }
            var noSignal: Int32 = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
            if method == "connect" { watchSocket(id, fd: fd); DispatchQueue.main.async { [weak self] in self?.event(id, "connect") }; return true }
            guard Darwin.listen(fd, 16) == 0 else { Darwin.close(fd); throw posix() }
            servers[id] = fd
            let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
            source.setEventHandler { [weak self] in
                guard let self = self else { return }
                let client = Darwin.accept(fd, nil, nil)
                if client < 0 { return }
                self.serial += 1; let clientId = self.serial
                var value: Int32 = 1; setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &value, socklen_t(MemoryLayout<Int32>.size))
                self.watchSocket(clientId, fd: client); self.event(id, "connection", clientId)
            }
            sources[id] = source; source.resume(); return true
        case "socketWrite": guard let fd = sockets[id] else { throw error("本地连接已关闭") }; try writeAll(fd, Data((args["text"] as? String ?? "").utf8)); return true
        case "socketEnd": socketClose(id); return true
        case "serverClose": sources.removeValue(forKey: id)?.cancel(); if let fd = servers.removeValue(forKey: id) { Darwin.close(fd) }; return true
        default: throw error("未支持的宿主能力：\(method)")
        }
    }
    func start(_ script: String) throws {
        context.evaluateScript(try String(contentsOf: root.appendingPathComponent("connector/\(script).js"), encoding: .utf8))
        guard context.exception == nil else { throw error("连接器脚本初始化失败") }
        for (number, name) in [(SIGTERM, "SIGTERM"), (SIGINT, "SIGINT")] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { [weak self] in self?.event("process", name) }
            signalSources.append(source); source.resume()
        }
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async { self?.event("stdin", data.isEmpty ? "end" : "data", data.base64EncodedString()) }
        }
    }
    func shutdown() {
        FileHandle.standardInput.readabilityHandler = nil
        for child in children.values where child.isRunning { kill(child.processIdentifier, SIGTERM) }
        for fd in files { Darwin.close(fd) }
        for fd in sockets.values { Darwin.close(fd) }
        for fd in servers.values { Darwin.close(fd) }
    }
}
