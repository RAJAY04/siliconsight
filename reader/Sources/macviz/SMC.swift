import Foundation
import IOKit

// AppleSMC user client. Struct layout matches the kernel's SMCParamStruct (80 bytes).
private struct SMCVers { var major: UInt8 = 0, minor: UInt8 = 0, build: UInt8 = 0, reserved: UInt8 = 0; var release: UInt16 = 0 }
private struct SMCPLimit { var version: UInt16 = 0, length: UInt16 = 0; var cpu: UInt32 = 0, gpu: UInt32 = 0, mem: UInt32 = 0 }
// Explicit tail padding: Swift places the next field after size, C after sizeof (12).
private struct SMCKeyInfo { var size: UInt32 = 0, type: UInt32 = 0; var attributes: UInt8 = 0; var pad: (UInt8, UInt8, UInt8) = (0, 0, 0) }
private struct SMCParam {
    var key: UInt32 = 0
    var vers = SMCVers()
    var pLimit = SMCPLimit()
    var info = SMCKeyInfo()
    var result: UInt8 = 0, status: UInt8 = 0, data8: UInt8 = 0
    var data32: UInt32 = 0
    var bytes: (UInt64, UInt64, UInt64, UInt64) = (0, 0, 0, 0)
}

private func fourCC(_ s: String) -> UInt32 { s.utf8.reduce(0) { $0 << 8 | UInt32($1) } }
private func fromFourCC(_ v: UInt32) -> String {
    String(bytes: [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: v >> $0) }, encoding: .ascii) ?? ""
}

final class SMC {
    private var conn: io_connect_t = 0
    private(set) var cpuKeys: [String] = [], gpuKeys: [String] = []
    private(set) var fanCount = 0
    private var infoCache: [String: SMCKeyInfo] = [:]  // halves the calls per read

    init() {
        precondition(MemoryLayout<SMCParam>.stride == 80 && MemoryLayout<SMCParam>.offset(of: \SMCParam.result) == 40)
        let svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"))
        guard svc != 0 else { return }
        defer { IOObjectRelease(svc) }
        guard IOServiceOpen(svc, mach_task_self_, 0, &conn) == KERN_SUCCESS else { conn = 0; return }

        // Pick temperature keys once: Tp*/Te* are CPU die sensors, Tg* GPU. Keep only floats that read sane now.
        for key in allKeys() where key.hasPrefix("T") {
            guard let v = float(key), v > 0, v <= 150 else { continue }
            if key.hasPrefix("Tp") || key.hasPrefix("Te") { cpuKeys.append(key) }
            if key.hasPrefix("Tg") { gpuKeys.append(key) }
        }
        fanCount = Int(raw("FNum")?.bytes.first ?? 0)
    }

    func average(_ keys: [String]) -> Double? {
        let vals = keys.compactMap(float).filter { $0 > 0 && $0 <= 150 }
        return vals.isEmpty ? nil : (vals.reduce(0, +) / Double(vals.count) * 10).rounded() / 10
    }

    func fans() -> [[String: Any]] {
        (0..<fanCount).compactMap { i in
            guard let rpm = float("F\(i)Ac") else { return nil }
            func opt(_ k: String) -> Any { float(k).map { $0.rounded() } ?? NSNull() }
            return ["rpm": rpm.rounded(), "minRpm": opt("F\(i)Mn"), "maxRpm": opt("F\(i)Mx")]
        }
    }

    func float(_ key: String) -> Double? {
        guard let (type, bytes) = raw(key) else { return nil }
        switch type {
        case "flt " where bytes.count >= 4:
            return Double(bytes.withUnsafeBytes { $0.loadUnaligned(as: Float32.self) })
        case "ui8 ", "ui16", "ui32":
            return Double(bytes.reduce(0) { $0 << 8 | UInt64($1) })
        default:
            return nil
        }
    }

    private func call(_ input: inout SMCParam) -> SMCParam? {
        var output = SMCParam(), size = MemoryLayout<SMCParam>.stride
        let rc = IOConnectCallStructMethod(conn, 2, &input, size, &output, &size)
        return rc == KERN_SUCCESS && output.result == 0 ? output : nil
    }

    private func raw(_ key: String) -> (type: String, bytes: [UInt8])? {
        guard conn != 0 else { return nil }
        var q = SMCParam(); q.key = fourCC(key); q.data8 = 9
        guard let info = infoCache[key] ?? call(&q)?.info, info.size > 0, info.size <= 32 else { return nil }
        infoCache[key] = info
        q.info = info; q.data8 = 5
        guard var out = call(&q) else { return nil }
        let bytes = withUnsafeBytes(of: &out.bytes) { Array($0.prefix(Int(info.size))) }
        return (fromFourCC(info.type), bytes)
    }

    private func allKeys() -> [String] {
        guard let (_, b) = raw("#KEY"), b.count == 4 else { return [] }
        let n = b.reduce(0) { $0 << 8 | UInt32($1) }
        return (0..<n).compactMap { i in
            var q = SMCParam(); q.data8 = 8; q.data32 = i
            return call(&q).map { fromFourCC($0.key) }
        }
    }
}
