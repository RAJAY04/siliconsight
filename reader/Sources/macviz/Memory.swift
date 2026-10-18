import Foundation

func readMemory(totalBytes: Int) -> [String: Any] {
    var stats = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
    let ok = withUnsafeMutablePointer(to: &stats) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) == KERN_SUCCESS
        }
    }
    let page = Int(vm_kernel_page_size)
    func b(_ pages: UInt32) -> Int { ok ? Int(pages) * page : 0 }

    var swap = xsw_usage(), size = MemoryLayout<xsw_usage>.size
    let swapUsed = sysctlbyname("vm.swapusage", &swap, &size, nil, 0) == 0 ? Int(swap.xsu_used) : 0

    let pressure: String
    switch sysctlInt("kern.memorystatus_vm_pressure_level") {
    case 4: pressure = "critical"
    case 2: pressure = "warn"
    default: pressure = "normal"
    }

    // "App memory" as Activity Monitor shows it: anonymous pages minus purgeable ones.
    let app: Any = ok ? max(0, b(stats.internal_page_count) - b(stats.purgeable_count)) : NSNull()
    return [
        "totalBytes": totalBytes,
        "wiredBytes": b(stats.wire_count),
        "activeBytes": b(stats.active_count),
        "inactiveBytes": b(stats.inactive_count),
        "compressedBytes": b(stats.compressor_page_count),
        "freeBytes": b(stats.free_count),
        "appBytes": app,
        "swapUsedBytes": swapUsed,
        "pressure": pressure,
    ]
}
