import Foundation
import Network

setvbuf(stdout, nil, _IOLBF, 0)  // line-buffer so logs show up when piped

// Every counter read here is Apple Silicon only. An arm64 build cannot run on Intel or under Rosetta,
// so an x86_64 build is the only way to get here on the wrong hardware.
#if !arch(arm64)
print("macviz needs Apple Silicon")
exit(1)
#endif

// "--port=N" is split into "--port", "N".
let args = CommandLine.arguments.flatMap { a -> [String] in
    guard a.hasPrefix("--"), let eq = a.firstIndex(of: "=") else { return [a] }
    return [String(a[..<eq]), String(a[a.index(after: eq)...])]
}
func flag(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let usage = """
    usage: macviz [--port 7878] [--web <dir>] [--once] [--selftest]
      --port      port on 127.0.0.1 (default 7878)
      --web       directory with the built web app (default: the first web/dist above the executable)
      --once      print one sample as JSON and exit
      --selftest  check that a sample has every contract key and sane values
    """
// Reject anything unknown, so a typo cannot silently fall back to a default.
var rest = args.dropFirst()
while let a = rest.popFirst() {
    switch a {
    case "--help", "-h": print(usage); exit(0)
    case "--once", "--selftest": continue
    case "--port", "--web":
        if let v = rest.popFirst(), !v.hasPrefix("--") { continue }
        fallthrough
    default: print("macviz: unknown or incomplete argument \(a)\n\(usage)"); exit(1)
    }
}

let queue = DispatchQueue(label: "macviz")
let sampler = queue.sync { Sampler(queue: queue) }

// Deltas need two readings; the Sampler took the first in init, so wait one interval.
func firstSample() -> [String: Any] {
    queue.sync { sampler.llm.poll() }
    Thread.sleep(forTimeInterval: 1)
    return queue.sync { sampler.sample() }
}

if args.contains("--once") {
    let s = firstSample()
    let out = ["hello": queue.sync { sampler.hello() }, "sample": s] as [String: Any]
    FileHandle.standardOutput.write(encode(out, pretty: true))
    print()
    exit(0)
}

if args.contains("--selftest") {
    let hello = queue.sync { sampler.hello() }
    let failures = selfTest(hello: hello, sample: firstSample())
    if failures.isEmpty { print("selftest: ok"); exit(0) }
    failures.forEach { print("selftest FAIL: \($0)") }
    exit(1)
}

guard let port = NWEndpoint.Port(flag("--port") ?? "7878"), port.rawValue > 0 else {
    print("--port needs a number from 1 to 65535"); exit(1)
}
let webDir = flag("--web").map { URL(fileURLWithPath: $0) } ?? defaultWebDir()
let server = Server(queue: queue, webRoot: webDir)
var lastSample: Data?
server.onConnect = { c in
    server.send(encode(sampler.hello()), to: c)
    if let s = lastSample { server.send(s, to: c) }
}
do {
    try server.start(port: port) {
        print("macviz listening on http://127.0.0.1:\(port)/  (WebSocket ws://127.0.0.1:\(port)/ws, web root \(webDir.standardizedFileURL.path))")
    }
} catch { print("cannot listen on 127.0.0.1:\(port): \(error)"); exit(1) }

// Ctrl-C exits at once, even when started from a script that left SIGINT ignored. The kernel
// closes the socket.
for sig in [SIGINT, SIGTERM] { signal(sig) { _ in _exit(0) } }

var tick = 0
let timer = DispatchSource.makeTimerSource(queue: queue)
timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(50))
timer.setEventHandler {
    if tick % 2 == 0 { sampler.llm.poll() }
    tick += 1
    let s = encode(sampler.sample())
    lastSample = s
    server.broadcast(s)
}
timer.resume()
dispatchMain()

// The first web/dist found above the executable (it sits somewhere under reader/.build), so the
// release binary works from any cwd. Falls back to the source checkout it was built from.
func defaultWebDir() -> URL {
    let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let fallback = packageDir.deletingLastPathComponent().appendingPathComponent("web/dist")
    var dir = Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent()
    while let d = dir, d.path != "/" {
        let candidate = d.appendingPathComponent("web/dist")
        if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("index.html").path) { return candidate }
        dir = d.deletingLastPathComponent()
    }
    return fallback
}
