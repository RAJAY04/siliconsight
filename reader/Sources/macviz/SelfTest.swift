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
    func bool(_ root: Any, _ path: String) { check(at(root, path) is Bool, "\(path) not a bool") }

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

    // Net counters: a 32-bit rollover still counts, a counter reset reads 0.
    check(DiskNet.rate(100, UInt32.max - 99, 1) == 200, "net rollover")
    check(DiskNet.rate(5_000, 9_000_000, 1) == 0, "net counter reset")

    // Frame encoder: header length forms at the 125/126 and 65535/65536 boundaries.
    check(Server.frame(Data(count: 125)).count == 127, "ws frame 125")
    check(Server.frame(Data(count: 126)).prefix(4) == Data([0x81, 126, 0, 126]), "ws frame 126")
    check(Server.frame(Data(count: 65536)).count == 65536 + 10, "ws frame 64k")
    return fails
}
