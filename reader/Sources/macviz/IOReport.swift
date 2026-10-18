import Foundation
import IOKit

// Private IOReport API, loaded at runtime. Same channels powermetrics uses, but readable without root.
private let lib = dlopen("/usr/lib/libIOReport.dylib", RTLD_NOW)
private func fn<T>(_ name: String, _: T.Type) -> T? {
    guard let lib, let p = dlsym(lib, name) else { return nil }
    return unsafeBitCast(p, to: T.self)
}

private typealias CopyGroup = @convention(c) (CFString, CFString?, UInt64, UInt64, UInt64) -> Unmanaged<CFDictionary>?
private typealias Subscribe = @convention(c) (UnsafeRawPointer?, CFMutableDictionary, UnsafeMutablePointer<Unmanaged<CFMutableDictionary>?>, UInt64, CFTypeRef?) -> OpaquePointer?
private typealias Samples = @convention(c) (OpaquePointer, CFMutableDictionary, CFTypeRef?) -> Unmanaged<CFDictionary>?
private typealias Delta = @convention(c) (CFDictionary, CFDictionary, CFTypeRef?) -> Unmanaged<CFDictionary>?
private typealias GetStr = @convention(c) (CFDictionary) -> Unmanaged<CFString>?
private typealias GetInt = @convention(c) (CFDictionary, Int32) -> Int64
private typealias StateCount = @convention(c) (CFDictionary) -> Int32
private typealias StateName = @convention(c) (CFDictionary, Int32) -> Unmanaged<CFString>?
private typealias StateRes = @convention(c) (CFDictionary, Int32) -> Int64

private let copyGroup = fn("IOReportCopyChannelsInGroup", CopyGroup.self)
private let subscribe = fn("IOReportCreateSubscription", Subscribe.self)
private let createSamples = fn("IOReportCreateSamples", Samples.self)
private let createDelta = fn("IOReportCreateSamplesDelta", Delta.self)
private let getGroup = fn("IOReportChannelGetGroup", GetStr.self)
private let getSubGroup = fn("IOReportChannelGetSubGroup", GetStr.self)
private let getName = fn("IOReportChannelGetChannelName", GetStr.self)
private let getUnit = fn("IOReportChannelGetUnitLabel", GetStr.self)
private let getInt = fn("IOReportSimpleGetIntegerValue", GetInt.self)
private let stateCount = fn("IOReportStateGetCount", StateCount.self)
private let stateName = fn("IOReportStateGetNameForIndex", StateName.self)
private let stateRes = fn("IOReportStateGetResidency", StateRes.self)

struct SocReading {
    var pFreqMHz: Double?
    var eFreqMHz: Double?
    var gpuUsage: Double?
    var gpuFreqMHz: Double?
    var cpuW: Double?, gpuW: Double?, aneW: Double?, dramW: Double?
    var bandwidthGBs: Double?
}

// One IOReport subscription; `delta()` returns the channels changed since the previous call.
private final class Subscription {
    private var sub: OpaquePointer?
    private var channels: CFMutableDictionary?
    private var last: (CFDictionary, Date)?

    init(_ wanted: [(String, String?, Set<String>?)], extra: [Any] = []) {
        guard let copyGroup, let subscribe else { return }
        var list = extra
        var base: NSMutableDictionary?
        for (g, s, names) in wanted {
            guard let d = copyGroup(g as CFString, s as CFString?, 0, 0, 0)?.takeRetainedValue() as NSDictionary?,
                  let chans = d["IOReportChannels"] as? [CFDictionary] else { continue }
            if base == nil { base = d.mutableCopy() as? NSMutableDictionary }
            // Fewer channels means a cheaper sample.
            list += chans.filter { names?.contains(IOReport.str(getName, $0)) ?? true }
        }
        guard let base, !list.isEmpty else { return }
        base["IOReportChannels"] = list
        let mutable = base as CFMutableDictionary
        var subbed: Unmanaged<CFMutableDictionary>?
        sub = subscribe(nil, mutable, &subbed, 0, nil)
        channels = mutable
        subbed?.release()
        _ = delta()
    }

    func delta() -> (items: [CFDictionary], dt: Double)? {
        guard let sub, let channels, let createSamples, let createDelta,
              let now = createSamples(sub, channels, nil)?.takeRetainedValue() else { return nil }
        let t = Date()
        defer { last = (now, t) }
        guard let (prev, pt) = last, let d = createDelta(prev, now, nil)?.takeRetainedValue(),
              let items = (d as NSDictionary)["IOReportChannels"] as? [CFDictionary] else { return nil }
        let dt = t.timeIntervalSince(pt)
        return dt > 0 ? (items, dt) : nil
    }
}

final class IOReport {
    private let main: Subscription
    // The PMP bandwidth histogram costs about as much as everything else together (the data comes
    // from a coprocessor), so it is read every 2 s; the histogram delta is an exact 2 s average.
    private let pmp = Subscription([("PMP", "DCS BW", ["AMCC RD+WR"])])
    private var tick = 0
    private var bandwidth: Double?
    private var modelGpuSeen = false
    private let eFreqs: [Double], pFreqs: [Double], gpuFreqs: [Double]

    init() {
        let dvfs = IOReport.dvfsTables()
        eFreqs = dvfs.e; pFreqs = dvfs.p; gpuFreqs = dvfs.gpu
        main = Subscription([
            ("Energy Model", nil, ["CPU Energy", "GPU Energy", "ANE", "DRAM"]),
            ("CPU Stats", "CPU Core Performance States", nil),
            ("GPU Stats", "GPU Performance States", ["GPUPH"]),
        ], extra: IOReport.clpcChannels())
    }

    // On macOS 27 the "Energy Model" mJ channels read 0 for CPU, ANE and DRAM. The live counters are
    // hidden CLPC channels that IOReport does not list, so we name them by report id:
    // (table index << 32) | per-driver key. Indices and keys are copied from macmon by vladkens
    // (MIT, https://github.com/vladkens/macmon, src/clpc.rs), extracted there from macOS 27.0 and
    // 27.0.1 restore images. Only the M5 row is checked on real hardware here; the chip names in the
    // comments are the usual T-number mapping, not taken from macmon.
    private static let clpcIndex: (cpu: UInt64, gpu: UInt64, ane: UInt64) = (16, 25, 24)
    private static let clpcKeys: [String: (cpu: UInt64, gpu: UInt64, ane: UInt64)] = [
        "com.apple.driver.AppleT8103CLPCv3": (0x2cdd_31f2, 0x21be_cf42, 0x0667_fb81), // M1
        "com.apple.driver.AppleT6000CLPCv3": (0x4747_9059, 0x4519_bf1e, 0x9aaa_17f8), // M1 Pro, M1 Max
        "com.apple.driver.AppleT6002CLPC": (0xb501_816b, 0x9e2c_3e8b, 0x14d5_a574),   // M1 Ultra
        "com.apple.driver.AppleT8112CLPC": (0xb543_5137, 0x638d_9d52, 0xea08_9c36),   // M2
        "com.apple.driver.AppleT6020CLPC": (0xe301_cd75, 0x8f34_cc7a, 0x7415_fb0f),   // M2 Pro, M2 Max
        "com.apple.driver.AppleT6022CLPC": (0x76f5_fd21, 0x9062_4499, 0x3c09_7307),   // M2 Ultra
        "com.apple.driver.AppleT8122CLPC": (0x54b5_1c99, 0xce2d_d9dc, 0x960a_fe2f),   // M3
        "com.apple.driver.AppleT6030CLPC": (0xbe03_a01a, 0x472d_6c9c, 0xb899_0c38),   // M3 Pro
        "com.apple.driver.AppleT6031CLPC": (0xd81e_0084, 0x1085_f98b, 0x313a_3be1),   // M3 Max
        "com.apple.driver.AppleT6032CLPC": (0xf4a2_1308, 0x85e8_0513, 0x63dc_8e25),   // M3 Ultra
        "com.apple.driver.AppleT8132CLPC": (0x4a85_4d94, 0x3b3e_3b79, 0x1ff4_a9ec),   // M4
        "com.apple.driver.AppleT6041CLPC": (0x263c_f1f0, 0x22e4_cf59, 0x7849_fb5c),   // M4 Pro, M4 Max
        "com.apple.driver.AppleT8140CLPC": (0x9bf5_4436, 0xef70_589c, 0x569d_941b),   // A18 Pro
        "com.apple.driver.AppleT8142CLPC": (0x4370_8744, 0x6a01_0933, 0xbc5e_fdf0),   // M5 (verified)
        "com.apple.driver.AppleT6050CLPC": (0xd3ab_60bb, 0x27cd_4ce5, 0x8c0f_1c59),   // M5 Pro, M5 Max
        "com.apple.driver.AppleT6050dCLPC": (0x18b3_010e, 0xedec_a11a, 0x188b_d883),  // M5 Pro/Max die variant
        "com.apple.driver.AppleT8152CLPC": (0x485d_4bfc, 0x1178_4654, 0x9380_c6bb),   // M6
    ]

    // The ids are only known for macOS 27; older systems use the "Energy Model" channels.
    private static func clpcChannels() -> [Any] {
        guard sysctlString("kern.osproductversion")?.hasPrefix("27.") == true else { return [] }
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleCLPC"), &it) == KERN_SUCCESS else { return [] }
        defer { IOObjectRelease(it) }
        // The keys name aggregate counters (both dies on Ultra), so the first known driver is enough.
        while case let svc = IOIteratorNext(it), svc != 0 {
            defer { IOObjectRelease(svc) }
            var driver: UInt64 = 0
            guard IORegistryEntryGetRegistryEntryID(svc, &driver) == KERN_SUCCESS,
                  let bundle = IORegistryEntryCreateCFProperty(svc, "CFBundleIdentifier" as CFString, nil, 0)?.takeRetainedValue() as? String,
                  let k = clpcKeys[bundle] else { continue }
            // IOReportTypes.h: simple integer format, power category, one element; unit is nJ.
            let channelType: Int64 = 1 | (2 << 16) | (1 << 32)
            let unit: Int64 = (3 << 56) | (118 << 32)
            let i = clpcIndex
            return [(i.cpu << 32 | k.cpu, "CPU Energy"), (i.gpu << 32 | k.gpu, "GPU Energy"), (i.ane << 32 | k.ane, "ANE")].map { id, name in
                NSMutableDictionary(dictionary: [
                    "DriverID": NSNumber(value: Int64(bitPattern: driver)),
                    "DriverName": "AppleCLPC",
                    "IOReportGroupName": "CLPC",
                    "IOReportSubGroupName": "Energy Counters",
                    "IOReportChannelInfo": ["IOReportChannelUnit": NSNumber(value: unit)],
                    "LegendChannel": [NSNumber(value: Int64(bitPattern: id)), NSNumber(value: channelType), name],
                ])
            }
        }
        return []
    }

    func read() -> SocReading {
        var r = SocReading()
        if tick % 2 == 0, let (items, _) = pmp.delta(), let item = items.first {
            bandwidth = IOReport.histogramMean(IOReport.states(item))
        }
        tick += 1
        r.bandwidthGBs = bandwidth
        guard let (items, dt) = main.delta() else { return r }

        var eStates: [[(String, Int64)]] = [], pStates: [[(String, Int64)]] = []
        var model: [String: Double] = [:], clpc: [String: Double] = [:]
        for item in items {
            let group = IOReport.str(getGroup, item), name = IOReport.str(getName, item)
            switch group {
            case "Energy Model": model[name] = IOReport.watts(item, dt)
            case "CLPC": clpc[name] = IOReport.watts(item, dt)
            case "CPU Stats":
                if name.hasPrefix("ECPU") { eStates.append(IOReport.states(item)) }
                if name.hasPrefix("PCPU") { pStates.append(IOReport.states(item)) }
            case "GPU Stats":
                let s = IOReport.states(item)
                let total = s.reduce(0) { $0 + $1.1 }
                if total > 0, gpuFreqs.count > 1 {
                    // gpuFreqs[0] is the 0 MHz "off" entry; state 0 is OFF.
                    let (freq, active) = IOReport.avgFreq(s, Array(gpuFreqs.dropFirst()))
                    r.gpuUsage = Double(active) / Double(total)
                    r.gpuFreqMHz = freq
                }
            default: break
            }
        }
        // A dead source reports exact zeros, so 0 W would really mean "unknown". CPU power is never
        // exactly 0 over a second, so a source counts as live when its CPU channel (or, for the Energy
        // Model, DRAM) is non-zero. Prefer CLPC, then the Energy Model, else null.
        let clpcAlive = (clpc["CPU Energy"] ?? 0) > 0
        let modelAlive = ["CPU Energy", "DRAM"].contains { (model[$0] ?? 0) > 0 }
        // macOS 27 keeps GPU Energy alive in the otherwise dead Energy Model; once it has moved it is trusted at 0.
        if (model["GPU Energy"] ?? 0) > 0 { modelGpuSeen = true }
        func pick(_ name: String) -> Double? { clpcAlive ? clpc[name] : modelAlive ? model[name] : nil }
        r.cpuW = pick("CPU Energy")
        r.aneW = pick("ANE")
        r.gpuW = pick("GPU Energy") ?? (modelGpuSeen ? model["GPU Energy"] : nil)
        r.dramW = modelAlive ? model["DRAM"] : nil
        r.eFreqMHz = IOReport.clusterFreq(eStates, eFreqs)
        r.pFreqMHz = IOReport.clusterFreq(pStates, pFreqs)
        return r
    }

    // PMP "DCS BW" is a histogram: bins named "4GB/s", "8GB/s", ... count how often DRAM traffic
    // fell in each 4 GB/s band. The mean of bin midpoints gives bandwidth to about 2 GB/s.
    private static func histogramMean(_ bins: [(String, Int64)]) -> Double? {
        var sum = 0.0, n: Int64 = 0, lower = 0.0
        for (label, count) in bins {
            guard let upper = Double(label.trimmingCharacters(in: .whitespaces).prefix { $0.isNumber || $0 == "." }) else { return nil }
            sum += Double(count) * (lower + upper) / 2; n += count; lower = upper
        }
        return n > 0 ? sum / Double(n) : nil
    }

    // Per-core residencies summed across the cluster, then weighted against the DVFS table.
    // An idle cluster reports its lowest table frequency.
    private static func clusterFreq(_ cores: [[(String, Int64)]], _ freqs: [Double]) -> Double? {
        guard !cores.isEmpty, !freqs.isEmpty else { return nil }
        var sum = 0.0, active: Int64 = 0
        for states in cores {
            let (f, a) = avgFreq(states, freqs)
            sum += f * Double(a); active += a
        }
        return active > 0 ? sum / Double(active) : freqs.first
    }

    // State lists look like [IDLE, f0, f1, ...] or [OFF, f0, ...]; the first non-idle state is freqs[0].
    private static func avgFreq(_ states: [(String, Int64)], _ freqs: [Double]) -> (Double, Int64) {
        guard let offset = states.firstIndex(where: { !["IDLE", "OFF", "DOWN"].contains($0.0) }) else { return (0, 0) }
        var weighted = 0.0, active: Int64 = 0
        for (i, f) in freqs.enumerated() where offset + i < states.count {
            let res = states[offset + i].1
            weighted += Double(res) * f; active += res
        }
        return (active > 0 ? weighted / Double(active) : 0, active)
    }

    static func states(_ item: CFDictionary) -> [(String, Int64)] {
        guard let stateCount, let stateName, let stateRes else { return [] }
        return (0..<max(0, stateCount(item))).map { i in
            ((stateName(item, i)?.takeUnretainedValue() as String?) ?? "", stateRes(item, i))
        }
    }

    private static func watts(_ item: CFDictionary, _ dt: Double) -> Double? {
        guard let v = getInt?(item, 0) else { return nil }
        let scale: Double
        switch str(getUnit, item) {
        case "mJ": scale = 1e-3
        case "uJ": scale = 1e-6
        case "nJ": scale = 1e-9
        default: return nil
        }
        return Double(v) * scale / dt
    }

    fileprivate static func str(_ f: GetStr?, _ item: CFDictionary) -> String {
        (f?(item)?.takeUnretainedValue() as String?) ?? ""
    }

    // DVFS tables live on the "pmgr" node (M6 moves them to "pmgr-child") as (freq, voltage) u32 pairs.
    // CPU tables are kHz on M4 and later, Hz on M1 to M3 and A-series; GPU is always Hz.
    // When the usual keys are missing, "acc-clusters" names them: 8-byte entries of (voltage-states
    // index, cluster type), the highest type is P and the next one E. Same lookup as macmon.
    static func dvfsTables() -> (e: [Double], p: [Double], gpu: [Double]) {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleARMIODevice"), &it) == KERN_SUCCESS else { return ([], [], []) }
        defer { IOObjectRelease(it) }
        let brand = sysctlString("machdep.cpu.brand_string") ?? ""
        let cpuScale = ["M1", "M2", "M3", "A1"].contains { brand.contains($0) } ? 1e6 : 1e3
        var e: [Double] = [], p: [Double] = [], gpu: [Double] = []
        while case let entry = IOIteratorNext(it), entry != 0 {
            defer { IOObjectRelease(entry) }
            var name = [CChar](repeating: 0, count: 128)
            IORegistryEntryGetName(entry, &name)
            guard ["pmgr", "pmgr-child"].contains(String(cString: name)) else { continue }
            func data(_ key: String) -> Data? {
                IORegistryEntryCreateCFProperty(entry, key as CFString, nil, 0)?.takeRetainedValue() as? Data
            }
            func table(_ key: String, _ scale: Double) -> [Double] {
                guard let d = data(key) else { return [] }
                return stride(from: 0, to: d.count - 7, by: 8).map { i in
                    Double(d[i..<i + 4].withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }) / scale
                }
            }
            var eKey = "voltage-states1-sram", pKey = "voltage-states5-sram"
            if data(eKey) == nil || data(pKey) == nil, let acc = data("acc-clusters") {
                let clusters = stride(from: 0, to: acc.count - 7, by: 8).map { (type: acc[$0 + 1], key: "voltage-states\(acc[$0])-sram") }
                    .sorted { $0.type < $1.type }
                if clusters.count >= 2 { eKey = clusters[clusters.count - 2].key; pKey = clusters[clusters.count - 1].key }
            }
            // First node with a table wins, so a stub node cannot clobber real values.
            if e.isEmpty { e = table(eKey, cpuScale) }
            if p.isEmpty { p = table(pKey, cpuScale) }
            if gpu.isEmpty { gpu = table("voltage-states9", 1e6) }
        }
        return (e, p, gpu)
    }
}
