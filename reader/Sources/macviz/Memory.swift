import Foundation

private func vmStats() -> vm_statistics64? {
    var stats = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
    let ok = withUnsafeMutablePointer(to: &stats) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) == KERN_SUCCESS
        }
    }
    return ok ? stats : nil
}

// The lifetime counters behind the "paging" rates in CONTRACT.md, in this order.
private let pagingKeys = ["faults", "zeroFills", "pageins", "pageouts", "compressions", "decompressions", "swapins", "swapouts"]
private func counters(_ s: vm_statistics64) -> [UInt64] {
    [s.faults, s.zero_fill_count, s.pageins, s.pageouts, s.compressions, s.decompressions, s.swapins, s.swapouts]
}

/// Memory totals, plus paging rates as deltas of the kernel's lifetime counters since the previous read.
final class MemoryReader {
    private var prev: (t: TimeInterval, c: [UInt64])?

    func read(totalBytes: Int) -> (memory: [String: Any], paging: Any) {
        let stats = vmStats()
        let page = Int(vm_kernel_page_size)
        func b(_ pages: UInt32) -> Int { stats != nil ? Int(pages) * page : 0 }

        var swap = xsw_usage(), size = MemoryLayout<xsw_usage>.size
        let swapUsed = sysctlbyname("vm.swapusage", &swap, &size, nil, 0) == 0 ? Int(swap.xsu_used) : 0

        let pressure: String
        switch sysctlInt("kern.memorystatus_vm_pressure_level") {
        case 4: pressure = "critical"
        case 2: pressure = "warn"
        default: pressure = "normal"
        }

        // "App memory" as Activity Monitor shows it: anonymous pages minus purgeable ones.
        let app: Any = stats.map { max(0, Int($0.internal_page_count) * page - Int($0.purgeable_count) * page) } ?? NSNull()
        let memory: [String: Any] = [
            "totalBytes": totalBytes,
            "wiredBytes": b(stats?.wire_count ?? 0),
            "activeBytes": b(stats?.active_count ?? 0),
            "inactiveBytes": b(stats?.inactive_count ?? 0),
            "compressedBytes": b(stats?.compressor_page_count ?? 0),
            "freeBytes": b(stats?.free_count ?? 0),
            "appBytes": app,
            "swapUsedBytes": swapUsed,
            "pressure": pressure,
        ]

        guard let stats else { return (memory, NSNull()) }
        let now = ProcessInfo.processInfo.systemUptime, c = counters(stats)
        var paging: [String: Any] = [
            "pageBytes": page,
            "compressorStoredBytes": Int(stats.total_uncompressed_pages_in_compressor) * page,
        ]
        for (i, k) in pagingKeys.enumerated() {
            // The first read has nothing to compare with; a counter that went backwards (it shouldn't) reads null.
            if let prev, now > prev.t, c[i] >= prev.c[i] {
                paging[k] = (Double(c[i] - prev.c[i]) / (now - prev.t)).rounded()
            } else {
                paging[k] = NSNull()
            }
        }
        prev = (now, c)
        return (memory, paging)
    }
}
