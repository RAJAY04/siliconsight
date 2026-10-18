import Foundation
import IOKit

func sysctlString(_ name: String) -> String? {
    var size = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
    var buf = [CChar](repeating: 0, count: size)
    guard sysctlbyname(name, &buf, &size, nil, 0) == 0 else { return nil }
    return String(cString: buf)
}

func sysctlInt(_ name: String) -> Int? {
    var v: Int64 = 0, size = MemoryLayout<Int64>.size
    guard sysctlbyname(name, &v, &size, nil, 0) == 0 else { return nil }
    // Some keys are 32-bit; sysctl fills only the low bytes.
    return size == 4 ? Int(Int32(truncatingIfNeeded: v)) : Int(v)
}

func registryProperty(_ cls: String, _ key: String) -> Any? {
    let svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching(cls))
    guard svc != 0 else { return nil }
    defer { IOObjectRelease(svc) }
    return IORegistryEntrySearchCFProperty(svc, kIOServicePlane, key as CFString, nil, IOOptionBits(kIORegistryIterateRecursively))
}

struct Hardware {
    let model = sysctlString("hw.model") ?? "unknown"
    let chip = sysctlString("machdep.cpu.brand_string") ?? "unknown"
    // perflevel0 is the fastest tier and counts as P; every slower tier (hw.nperflevels can be 3) is E.
    // Without perflevels (a VM) every core is P.
    let pCores = sysctlInt("hw.perflevel0.physicalcpu") ?? ProcessInfo.processInfo.processorCount
    let eCores = (1..<max(1, sysctlInt("hw.nperflevels") ?? 1)).reduce(0) { $0 + (sysctlInt("hw.perflevel\($1).physicalcpu") ?? 0) }
    let gpuCores = registryProperty("AGXAccelerator", "gpu-core-count") as? Int
    let memBytes = sysctlInt("hw.memsize") ?? 0
    let macosVersion: String = {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }()
}

final class CPUUsage {
    private var last: [UInt32] = []
    let kinds: [String]

    init(hw: Hardware) {
        let n = max(hw.eCores + hw.pCores, ProcessInfo.processInfo.processorCount)
        if let r = CPUUsage.registryKinds(n), r.filter({ $0 == "P" }).count == hw.pCores {
            kinds = r
        } else {
            // Fallback: E cores first, then P, as on the M5 with a background-QoS load (see README).
            kinds = (0..<n).map { $0 < hw.eCores ? "E" : "P" }
        }
        _ = read()
    }

    // Each "cpuN" device has "logical-cpu-id" (the host_processor_info index) and "cluster-type"
    // ("E", "P", or "M" for a middle tier). "P" is the fastest tier; "E" and "M" both count as E.
    // nil unless every logical CPU has a type.
    static func registryKinds(_ n: Int) -> [String]? {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOPlatformDevice"), &it) == KERN_SUCCESS else { return nil }
        defer { IOObjectRelease(it) }
        var kinds = [String?](repeating: nil, count: n)
        while case let entry = IOIteratorNext(it), entry != 0 {
            defer { IOObjectRelease(entry) }
            func prop(_ key: String) -> Any? { IORegistryEntryCreateCFProperty(entry, key as CFString, nil, 0)?.takeRetainedValue() }
            guard let id = prop("logical-cpu-id") as? Int, id >= 0, id < n,
                  let type = (prop("cluster-type") as? Data).map({ String(decoding: $0, as: UTF8.self).trimmingCharacters(in: .controlCharacters) }),
                  !type.isEmpty else { continue }
            kinds[id] = type == "P" ? "P" : "E"
        }
        return kinds.contains(nil) ? nil : kinds.compactMap { $0 }
    }

    func read() -> [[String: Any]] {
        var count: natural_t = 0, info: processor_info_array_t?, infoCount: mach_msg_type_number_t = 0
        guard host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &count, &info, &infoCount) == KERN_SUCCESS,
              let info else { return [] }
        defer { vm_deallocate(mach_task_self_, vm_address_t(bitPattern: info), vm_size_t(infoCount) * vm_size_t(MemoryLayout<integer_t>.stride)) }
        let ticks = (0..<Int(infoCount)).map { UInt32(bitPattern: info[$0]) }
        defer { last = ticks }
        let states = Int(CPU_STATE_MAX)
        return (0..<Int(count)).map { i in
            var usage = 0.0
            if last.count == ticks.count {
                let d = (0..<states).map { ticks[i * states + $0] &- last[i * states + $0] }
                let busy = Double(d[Int(CPU_STATE_USER)]) + Double(d[Int(CPU_STATE_SYSTEM)]) + Double(d[Int(CPU_STATE_NICE)])
                let all = busy + Double(d[Int(CPU_STATE_IDLE)])
                usage = all > 0 ? busy / all : 0
            }
            return ["id": i, "kind": i < kinds.count ? kinds[i] : "P", "usage": (usage * 1000).rounded() / 1000]
        }
    }
}
