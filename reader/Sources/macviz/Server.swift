import CryptoKit
import Foundation
import Network

// Minimal HTTP/1.1 static file server plus a hand-rolled WebSocket upgrade, on one port.
// Everything runs on `queue`, the same serial queue the sampler uses, so no locks.
final class Server {
    private let queue: DispatchQueue
    private let webRoot: URL
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]
    private var open: Set<ObjectIdentifier> = []          // every live connection, HTTP or WebSocket
    private var inFlight: [ObjectIdentifier: Int] = [:]   // unfinished sends per WebSocket client
    private var headDone: Set<ObjectIdentifier> = []      // connections whose request head arrived
    private var port: UInt16 = 0
    var onConnect: ((NWConnection) -> Void)?

    init(queue: DispatchQueue, webRoot: URL) {
        self.queue = queue
        self.webRoot = webRoot.resolvingSymlinksInPath().standardizedFileURL
    }

    /// `ready` runs once the port is bound. A bind failure prints a message and exits 1.
    func start(port: NWEndpoint.Port, ready: @escaping () -> Void) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
        params.allowLocalEndpointReuse = true
        self.port = port.rawValue
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { state in
            switch state {
            case .ready: ready()
            case .failed(.posix(.EADDRINUSE)), .waiting(.posix(.EADDRINUSE)):
                print("port \(port) is already in use, maybe by another macviz. Stop it or pick another port with --port <n>.")
                exit(1)
            case .failed(let e), .waiting(let e):
                print("cannot listen on 127.0.0.1:\(port): \(e)")
                exit(1)
            default: break
            }
        }
        l.start(queue: queue)
        listener = l
    }

    func broadcast(_ text: Data) {
        let frame = Server.frame(text)
        for c in clients.values { sendFrame(frame, to: c) }
    }

    func send(_ text: Data, to c: NWConnection) { sendFrame(Server.frame(text), to: c) }

    // A client that stops reading would grow its send queue forever; drop it after 30 unsent samples.
    private func sendFrame(_ frame: Data, to c: NWConnection) {
        let id = ObjectIdentifier(c)
        let n = (inFlight[id] ?? 0) + 1
        guard n <= 30 else { return c.cancel() }
        inFlight[id] = n
        c.send(content: frame, completion: .contentProcessed { [weak self] _ in
            if let self, let k = self.inFlight[id] { self.inFlight[id] = k - 1 }
        })
    }

    private func accept(_ c: NWConnection) {
        let id = ObjectIdentifier(c)
        // Local only, so 64 is far more than one person needs; it bounds file descriptors.
        guard open.count < 64 else { return c.cancel() }
        open.insert(id)
        c.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.clients[id] = nil; self?.inFlight[id] = nil; self?.open.remove(id); self?.headDone.remove(id)
            default: break
            }
        }
        c.start(queue: queue)
        // A request head that has not arrived in 10 s is a stuck or idle socket.
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in
            if let self, self.open.contains(id), !self.headDone.contains(id) { c.cancel() }
        }
        readHead(c, Data())
    }

    private func readHead(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, done, err in
            guard let self, err == nil, let data else { c.cancel(); return }
            let buf = buf + data
            guard let end = buf.range(of: Data("\r\n\r\n".utf8)) else {
                if done || buf.count > 16384 { c.cancel() } else { self.readHead(c, buf) }
                return
            }
            self.headDone.insert(ObjectIdentifier(c))
            self.handle(c, String(decoding: buf[..<end.lowerBound], as: UTF8.self))
        }
    }

    private func handle(_ c: NWConnection, _ head: String) {
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        guard parts.count >= 2, parts[0] == "GET" else { return respond(c, 405, "text/plain", Data("method not allowed".utf8)) }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let i = line.firstIndex(of: ":") else { continue }
            headers[line[..<i].lowercased()] = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
        }
        let path = String(parts[1].split(separator: "?", maxSplits: 1).first ?? "/")

        // Only this machine's own names: blocks DNS rebinding. Browsers always send Host.
        let local = ["127.0.0.1:\(port)", "localhost:\(port)"]
        guard let host = headers["host"]?.lowercased(), local.contains(host) else { return respond(c, 403, "text/plain", Data("forbidden host".utf8)) }

        if headers["upgrade"]?.lowercased() == "websocket", path == "/ws" || path == "/", let key = headers["sec-websocket-key"] {
            // Any website can open a WebSocket to localhost, so only the page itself and the Vite dev
            // server may. No Origin means a non-browser client (Node, curl), which is allowed.
            if let origin = headers["origin"]?.lowercased(),
               !(local + ["localhost:5173", "127.0.0.1:5173"]).contains(where: { origin == "http://" + $0 }) {
                return respond(c, 403, "text/plain", Data("forbidden origin".utf8))
            }
            let accept = Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
            let reply = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
            c.send(content: Data(reply.utf8), completion: .contentProcessed { _ in })
            clients[ObjectIdentifier(c)] = c
            onConnect?(c)
            readFrames(c)
            return
        }
        serveFile(c, path)
    }

    // We never need client data; only watch for a close frame or EOF.
    // ponytail: checks the first byte of each read, not a full frame parser; fine for browsers that only send close.
    private func readFrames(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, err in
            if err != nil || done || (data?.first.map { $0 & 0x0f == 0x8 } ?? false) {
                self?.clients[ObjectIdentifier(c)] = nil
                // Echo a close frame so browsers see a clean close, not an error.
                c.send(content: Data([0x88, 0x00]), completion: .contentProcessed { _ in c.cancel() })
                return
            }
            self?.readFrames(c)
        }
    }

    private func serveFile(_ c: NWConnection, _ rawPath: String) {
        let decoded = rawPath.removingPercentEncoding ?? rawPath
        let rel = decoded == "/" ? "index.html" : String(decoded.drop { $0 == "/" })
        var file = webRoot.appendingPathComponent(rel)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), isDir.boolValue {
            file = file.appendingPathComponent("index.html")
        }
        // Refuse anything that resolves outside the web root: ../ (encoded or not) or a symlink.
        file = file.resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(webRoot.path + "/") else { return respond(c, 403, "text/plain", Data("forbidden".utf8)) }
        guard let body = try? Data(contentsOf: file) else {
            let msg = FileManager.default.fileExists(atPath: webRoot.path) ? "not found" : "web build not found at \(webRoot.path); run the web build or pass --web <dir>"
            return respond(c, 404, "text/plain", Data(msg.utf8))
        }
        respond(c, 200, Server.contentType(file.pathExtension), body)
    }

    private func respond(_ c: NWConnection, _ status: Int, _ type: String, _ body: Data) {
        let reason = [200: "OK", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"][status] ?? ""
        let head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
        c.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
    }

    private static func contentType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "txt": return "text/plain; charset=utf-8"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    // Server-to-client text frame: FIN + opcode 1, unmasked.
    static func frame(_ payload: Data) -> Data {
        var f = Data([0x81])
        let n = payload.count
        if n < 126 {
            f.append(UInt8(n))
        } else if n < 65536 {
            f.append(126); f.append(UInt8(n >> 8)); f.append(UInt8(n & 0xff))
        } else {
            f.append(127)
            for s in stride(from: 56, through: 0, by: -8) { f.append(UInt8((n >> s) & 0xff)) }
        }
        return f + payload
    }
}
