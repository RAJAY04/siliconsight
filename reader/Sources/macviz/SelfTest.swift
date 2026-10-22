import Foundation

// Round-trips hello and sample through JSON and checks every CONTRACT.md key and its range.
func selfTest(hello: [String: Any], sample: [String: Any]) -> [String] {
    var fails: [String] = []
    func check(_ ok: Bool, _ msg: String) { if !ok { fails.append(msg) } }

    func decode(_ o: [String: Any]) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: encode(o))) as? [String: Any] ?? [:]
    }
    let h = decode(hello), s = decode(sample)

    // Walks "a.b.c"; returns .some(NSNull) for an explicit null and nil for a missing key.
    func at(_ root: Any, _ path: String) -> Any? {
        var cur: Any? = root
        for k in path.split(separator: ".") { cur = (cur as? [String: Any])?[String(k)] }
        return cur
    }
    func num(_ root: Any, _ path: String, _ range: ClosedRange<Double>, nullable: Bool = false) {
        guard let v = at(root, path) else { return check(false, "missing \(path)") }
        if v is NSNull { return check(nullable, "\(path) is null") }
        guard let d = (v as? NSNumber)?.doubleValue else { return check(false, "\(path) not a number") }
        check(range.contains(d), "\(path)=\(d) outside \(range)")
    }
    func str(_ root: Any, _ path: String, _ allowed: [String]? = nil, nullable: Bool = false) {
        guard let v = at(root, path) else { return check(false, "missing \(path)") }
        if v is NSNull { return check(nullable, "\(path) is null") }
        guard let x = v as? String else { return check(false, "\(path) not a string") }
        if let allowed { check(allowed.contains(x), "\(path)=\(x) not in \(allowed)") }
    }
    func bool(_ root: Any, _ path: String, nullable: Bool = false) {
        check(at(root, path) is Bool || (nullable && at(root, path) is NSNull), "\(path) not a bool")
    }

    str(h, "type", ["hello"]); num(h, "version", 1...1)
    for k in ["model", "chip", "macosVersion"] { str(h, "hardware.\(k)") }
    num(h, "hardware.pCores", 1...64); num(h, "hardware.eCores", 0...64)
    num(h, "hardware.gpuCores", 1...256, nullable: true); num(h, "hardware.aneCores", 1...64, nullable: true)
    num(h, "hardware.memBytes", 1e9...1e13); bool(h, "hardware.hasBattery"); num(h, "hardware.fanCount", 0...8)

    str(s, "type", ["sample"]); num(s, "t", 1.6e12...4e12)
    let cores = at(s, "cpu.cores") as? [[String: Any]] ?? []
    let p = (at(h, "hardware.pCores") as? Int) ?? 0, e = (at(h, "hardware.eCores") as? Int) ?? 0
    check(cores.count == p + e, "cpu.cores has \(cores.count) entries, want \(p + e)")
    check(cores.filter { $0["kind"] as? String == "P" }.count == p, "P core count mismatch")
    for (i, c) in cores.enumerated() {
        num(c, "id", Double(i)...Double(i)); str(c, "kind", ["P", "E"]); num(c, "usage", 0...1)
    }
    num(s, "cpu.pFreqMHz", 100...8000, nullable: true); num(s, "cpu.eFreqMHz", 100...8000, nullable: true)
    num(s, "gpu.usage", 0...1, nullable: true); num(s, "gpu.freqMHz", 0...5000, nullable: true)
    for k in ["cpuW", "gpuW", "aneW", "dramW", "systemW"] { num(s, "power.\(k)", 0...1000, nullable: true) }

    let total = (at(s, "memory.totalBytes") as? NSNumber)?.doubleValue ?? 0
    num(s, "memory.totalBytes", 1e9...1e13)
    for k in ["wiredBytes", "activeBytes", "inactiveBytes", "compressedBytes", "freeBytes"] { num(s, "memory.\(k)", 0...total) }
    num(s, "memory.appBytes", 0...total, nullable: true); num(s, "memory.swapUsedBytes", 0...1e13)
    str(s, "memory.pressure", ["normal", "warn", "critical"]); num(s, "memory.bandwidthGBs", 0...2000, nullable: true)

    let topCpu = at(s, "topCpu") as? [[String: Any]], topMem = at(s, "topMem") as? [[String: Any]]
    check(topCpu != nil && topCpu!.count <= 8, "topCpu missing or longer than 8")
    check(topMem != nil && !topMem!.isEmpty && topMem!.count <= 8, "topMem empty or longer than 8")
    for x in topCpu ?? [] { num(x, "pid", 1...1e7); str(x, "name"); num(x, "cpu", 0...10000) }
    for x in topMem ?? [] { num(x, "pid", 1...1e7); str(x, "name"); num(x, "bytes", 0...total) }

    for k in ["disk.readBps", "disk.writeBps", "net.rxBps", "net.txBps"] { num(s, k, 0...1e11) }
    str(s, "net.iface", nullable: true)
    str(s, "thermal.state", ["nominal", "fair", "serious", "critical"])
    for k in ["cpuTempC", "gpuTempC", "batteryTempC"] { num(s, "thermal.\(k)", 1...150, nullable: true) }
    let fans = at(s, "fans") as? [[String: Any]]
    check(fans != nil && fans!.count == (at(h, "hardware.fanCount") as? Int), "fans count does not match hardware.fanCount")
    for f in fans ?? [] { num(f, "rpm", 0...20000); num(f, "minRpm", 0...20000, nullable: true); num(f, "maxRpm", 0...20000, nullable: true) }

    if let b = at(s, "battery"), !(b is NSNull) {
        num(b, "percent", 0...100); bool(b, "charging"); bool(b, "acAttached"); bool(b, "chargeHeld")
        num(b, "watts", -300...300, nullable: true); num(b, "adapterW", 1...300, nullable: true)
        num(b, "cycleCount", 0...10000, nullable: true); num(b, "healthPct", 1...130, nullable: true)
        num(b, "timeRemainingMin", 0...10000, nullable: true)
    } else {
        check(at(h, "hardware.hasBattery") as? Bool == false, "battery null but hasBattery true")
    }
    check(at(s, "llm") != nil, "missing llm")
    if let l = at(s, "llm") as? [String: Any] {
        str(l, "runtime", ["ollama", "lmstudio"]); check(l["models"] is [Any], "llm.models not an array")
        num(l, "tokensPerSec", 0...100000, nullable: true)
    }

    num(s, "sensors.lidAngleDeg", 0...360, nullable: true)
    for k in ["cameraInUse", "micInUse", "audioPlaying"] { bool(s, "sensors.\(k)", nullable: true) }
    for k in ["displayBrightness", "keyboardBacklight"] { num(s, "sensors.\(k)", 0...1, nullable: true) }
    for k in ["decodeGBs", "encodeGBs", "scalerGBs", "ispGBs"] { num(s, "media.\(k)", 0...2000, nullable: true) }
    num(s, "paging.pageBytes", 4096...65536); num(s, "paging.compressorStoredBytes", 0...1e13)
    for k in ["faults", "zeroFills", "pageins", "pageouts", "compressions", "decompressions", "swapins", "swapouts"] { num(s, "paging.\(k)", 0...1e9, nullable: true) }
    if let w = at(s, "wifi"), !(w is NSNull) {
        num(w, "rssiDbm", -120...0); num(w, "noiseDbm", -120...0, nullable: true); num(w, "txRateMbps", 1...100000, nullable: true)
        num(w, "channel", 1...233, nullable: true); num(w, "bandGHz", 2.4...6, nullable: true); num(w, "widthMHz", 20...320, nullable: true)
    }
    // Wi-Fi: CoreWLAN's 0 means "no reading", and RSSI 0 means the radio is on but not joined.
    let joined = WiFi.fields(rssi: -61, noise: 0, txMbps: 0, channel: 36, band: .band5GHz, width: .width80MHz) as? [String: Any]
    check(joined?["rssiDbm"] as? Int == -61 && joined?["noiseDbm"] is NSNull && joined?["txRateMbps"] is NSNull
          && joined?["bandGHz"] as? Double == 5 && joined?["widthMHz"] as? Int == 80, "wifi fields: \(String(describing: joined))")
    check(WiFi.fields(rssi: 0, noise: -95, txMbps: 0, channel: 0, band: .bandUnknown, width: .widthUnknown) is NSNull, "wifi: not joined should be null")
    // Block traffic is averaged over every DRAM window, not just the windows the block was busy in.
    let busy = IOReport.mediaTraffic(["AMCC RD+WR": [("4GB/s", 100)], "AVD RD+WR": [("1GB/s", 10), ("2GB/s", 0), ("3GB/s", 20)]])
    check(busy["decodeGBs"] == 0.55 && busy["encodeGBs"] == nil, "media traffic: \(busy)")
    let sc = at(s, "sched.cores") as? [[String: Any]] ?? []
    check(sc.count == cores.count, "sched.cores has \(sc.count) entries, want \(cores.count)")
    let states = ["E": at(s, "sched.eStatesMHz") as? [Double] ?? [], "P": at(s, "sched.pStatesMHz") as? [Double] ?? []]
    for (i, c) in sc.enumerated() {
        num(c, "id", Double(i)...Double(i)); num(c, "active", 0...1, nullable: true); num(c, "freqMHz", 100...8000, nullable: true)
        num(c, "irqs", 0...1e7, nullable: true); num(c, "ipis", 0...1e7, nullable: true)
        if let res = c["res"] as? [Double], let kind = cores[i]["kind"] as? String {
            check(res.count == states[kind]?.count && res.allSatisfy { (0...1).contains($0) }, "sched.cores[\(i)].res does not match its state table")
            if let a = c["active"] as? Double { check(abs(res.reduce(0, +) - a) < 0.02, "sched.cores[\(i)].res sums to \(res.reduce(0, +)), active is \(a)") }
        }
    }
    let threads = at(s, "sched.threads") as? [[String: Any]]
    check(threads != nil && threads!.count <= 12, "sched.threads missing or longer than 12")
    for t in threads ?? [] {
        num(t, "pid", 1...1e7); str(t, "proc"); str(t, "name"); num(t, "cpu", 0...10000); num(t, "pri", 0...127); num(t, "basePri", 0...127)
        str(t, "state", ["run", "wait", "uninterruptible", "stopped", "halted"]); str(t, "policy", ["timeshare", "rr", "fifo"])
    }
    num(s, "sched.contextSwitches", 0...1e8, nullable: true); num(s, "sched.loadAvg", 0...10000, nullable: true)
    for k in ["runnable", "threadsSeen", "systemThreads", "systemTasks"] { num(s, "sched.\(k)", 0...1e7, nullable: true) }
    fails += fastSelfTest()

    // Net counters: a 32-bit rollover still counts, a counter reset reads 0.
    check(DiskNet.rate(100, UInt32.max - 99, 1) == 200, "net rollover")
    check(DiskNet.rate(5_000, 9_000_000, 1) == 0, "net counter reset")

    // Frame encoder: header length forms at the 125/126 and 65535/65536 boundaries.
    check(Server.frame(Data(count: 125)).count == 127, "ws frame 125")
    check(Server.frame(Data(count: 126)).prefix(4) == Data([0x81, 126, 0, 126]), "ws frame 126")
    check(Server.frame(Data(count: 65536)).count == 65536 + 10, "ws frame 64k")
    return fails
}

// Lid and finger decoding, and FastChannel coalescing: at most 30 a second, one [] on lift, then quiet.
private func fastSelfTest() -> [String] {
    var fails: [String] = []
    func check(_ ok: Bool, _ msg: String) { if !ok { fails.append(msg) } }

    check([UInt8]([1, 0x2c, 0x01]).withUnsafeBufferPointer { LidSensor.decode($0.baseAddress!, 3) } == 300, "lid decode 300")
    check([UInt8]([2, 0x2c, 0x01]).withUnsafeBufferPointer { LidSensor.decode($0.baseAddress!, 3) } == nil, "lid decode ignores other reports")

    var touches = [UInt8](repeating: 0, count: 192)
    touches.withUnsafeMutableBytes { b in
        b.storeBytes(of: Int32(7), toByteOffset: 16, as: Int32.self); b.storeBytes(of: Int32(4), toByteOffset: 20, as: Int32.self)
        b.storeBytes(of: Float(0.25), toByteOffset: 32, as: Float.self); b.storeBytes(of: Float(1.4), toByteOffset: 36, as: Float.self)
        b.storeBytes(of: Int32(2), toByteOffset: 96 + 20, as: Int32.self)  // hovering, not touching
    }
    let decoded = touches.withUnsafeBytes { Trackpad.decode($0.baseAddress!, 2) }
    check(decoded.count == 1 && decoded[0]["id"] as? Int == 7 && decoded[0]["x"] as? Double == 0.25 && decoded[0]["y"] as? Double == 1,
          "trackpad decode: \(decoded)")

    let q = DispatchQueue(label: "selftest.fast")
    var got: [[String: Any]] = []
    let fast = FastChannel(queue: q) { d in got.append((try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]) }
    fast.fingersAvailable = true
    let count = { q.sync { got.count } }
    q.sync { fast.lid(10); fast.lid(10.3) }
    Thread.sleep(forTimeInterval: 0.1)
    check(count() == 0, "fast: lid seed or a 0.3 degree change sent a message")
    q.sync { fast.lid(11) }
    Thread.sleep(forTimeInterval: 0.1)
    check(count() == 1 && got.first?["lidAngleDeg"] as? Double == 11, "fast: 1 degree lid change not sent")

    let start = count()
    let t0 = Date()
    for i in 0..<60 {  // 120 Hz frames for 0.5 s, from another thread like the trackpad
        fast.fingers([["id": 1, "x": Double(i) / 100, "y": 0.5, "size": 0.1]])
        Thread.sleep(forTimeInterval: 1.0 / 120)
    }
    Thread.sleep(forTimeInterval: 0.1)
    let sent = count() - start, secs = Date().timeIntervalSince(t0)
    check(sent >= 5 && Double(sent) <= secs * 30 + 1, "fast: \(sent) messages in \(secs) s, want at most 30/s")
    check(((q.sync { got.last?["fingers"] } as? [[String: Any]])?.first?["x"] as? Double) == 0.59, "fast: last frame not delivered")

    let beforeLift = count()
    for _ in 0..<5 { fast.fingers([]) }
    Thread.sleep(forTimeInterval: 0.15)
    check(count() == beforeLift + 1 && (q.sync { got.last?["fingers"] } as? [Any])?.isEmpty == true, "fast: lift did not send exactly one []")
    for _ in 0..<5 { fast.fingers([]) }
    Thread.sleep(forTimeInterval: 0.15)
    check(count() == beforeLift + 1, "fast: idle frames sent messages")
    return fails
}
