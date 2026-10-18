import Foundation

final class Processes {
    private var lastCPU: [pid_t: UInt64] = [:]
    private var lastTime = DispatchTime.now().uptimeNanoseconds
    private let ticksToNs: Double = {
        var tb = mach_timebase_info()
        mach_timebase_info(&tb)
        return Double(tb.numer) / Double(tb.denom)
    }()

    init() { _ = read() }

    // Processes we may not inspect (other users, root) fail proc_pid_rusage and are skipped.
    func read() -> (topCpu: [[String: Any]], topMem: [[String: Any]]) {
        let now = DispatchTime.now().uptimeNanoseconds
        let dtNs = Double(now - lastTime)
        lastTime = now

        let n = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
        var pids = [pid_t](repeating: 0, count: Int(n) / MemoryLayout<pid_t>.size + 32)
        let got = proc_listpids(UInt32(PROC_ALL_PIDS), 0, &pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        pids = Array(pids.prefix(Int(got) / MemoryLayout<pid_t>.size)).filter { $0 > 0 }

        var cpu: [(pid_t, Double)] = [], mem: [(pid_t, UInt64)] = []
        var seen: [pid_t: UInt64] = [:]
        for pid in pids {
            var info = rusage_info_v4()
            let rc = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
                    proc_pid_rusage(pid, RUSAGE_INFO_V4, $0)
                }
            }
            guard rc == 0 else { continue }
            let t = info.ri_user_time + info.ri_system_time
            seen[pid] = t
            mem.append((pid, info.ri_phys_footprint))
            if let prev = lastCPU[pid], t >= prev, dtNs > 0 {
                cpu.append((pid, Double(t - prev) * ticksToNs / dtNs * 100))
            }
        }
        lastCPU = seen

        let topCpu = cpu.sorted { $0.1 > $1.1 }.prefix(8).map { ["pid": Int($0.0), "name": name($0.0), "cpu": ($0.1 * 10).rounded() / 10] }
        let topMem = mem.sorted { $0.1 > $1.1 }.prefix(8).map { ["pid": Int($0.0), "name": name($0.0), "bytes": Int($0.1)] }
        return (topCpu.map { $0 as [String: Any] }, topMem.map { $0 as [String: Any] })
    }

    private func name(_ pid: pid_t) -> String {
        var buf = [CChar](repeating: 0, count: 256)
        return proc_name(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : "pid \(pid)"
    }
}
