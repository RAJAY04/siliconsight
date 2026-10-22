import Foundation

// Per-core clocks, idle residency and interrupts, plus the busiest threads, for the Core X-ray lab. No root needed.
// macOS does not say which thread is on which core without root, so nothing here links threads to cores.
final class SchedReader {
    private let kinds: [String]
    private var lastStat: [[UInt64]] = []
    private var lastStatTime = DispatchTime.now().uptimeNanoseconds
    private var tick = 0
    private var lastThreadTime: [pid_t: [UInt64: UInt64]] = [:]
    private var lastCsw: [pid_t: Int64] = [:]
    private var lastTaskTime: [pid_t: UInt64] = [:]
    private var lastScan = DispatchTime.now().uptimeNanoseconds
    private var slow: [String: Any] = [:]

    init(kinds: [String]) {
        self.kinds = kinds
        _ = cpuStats()
        _ = scan()
    }

    func read(_ soc: SocReading, eFreqs: [Double], pFreqs: [Double]) -> [String: Any] {
        // The thread scan runs every 5 s, slower than the process scan, to keep the reader near 1% CPU; rates use the real window.
        if tick % 5 == 0 { slow = scan() }
        tick += 1
        let stats = cpuStats()
        // IOReport names cores per kind ("ECPU0", "PCPU0"); the nth of a kind is the nth logical CPU of that kind.
        // ponytail: one cluster per kind, checked on M5; chips with two P clusters may name channels differently.
        var seen: [String: Int] = [:]
        let cores: [[String: Any]] = kinds.enumerated().map { id, kind in
            let n = seen[kind, default: 0]
            seen[kind] = n + 1
            let freqs = kind == "E" ? eFreqs : pFreqs
            var core: [String: Any] = ["id": id, "active": NSNull(), "freqMHz": NSNull(), "res": NSNull(), "irqs": NSNull(), "ipis": NSNull()]
            if let states = soc.coreStates["\(kind)CPU\(n)"], !freqs.isEmpty {
                let total = states.reduce(0) { $0 + $1.1 }
                let (f, active) = IOReport.avgFreq(states, freqs)
                if total > 0 {
                    let offset = states.firstIndex { !["IDLE", "OFF", "DOWN"].contains($0.0) } ?? states.count
                    core["active"] = r3(Double(active) / Double(total))
                    core["freqMHz"] = (active > 0 ? f : freqs[0]).rounded()
                    core["res"] = freqs.indices.map { i in offset + i < states.count ? r3(Double(states[offset + i].1) / Double(total)) : 0 }
                }
            }
            if let s = stats, id < s.irqs.count { core["irqs"] = s.irqs[id]; core["ipis"] = s.ipis[id] }
            return core
        }
        var out = slow
        out["cores"] = cores
        out["eStatesMHz"] = eFreqs.map { $0.rounded() }
        out["pStatesMHz"] = pFreqs.map { $0.rounded() }
        return out
    }

    // PROCESSOR_CPU_STAT64 counts interrupts and inter-processor interrupts per core since boot.
    private func cpuStats() -> (irqs: [Int], ipis: [Int])? {
        var count: natural_t = 0, info: processor_info_array_t?, n: mach_msg_type_number_t = 0
        guard host_processor_info(mach_host_self(), PROCESSOR_CPU_STAT64, &count, &info, &n) == KERN_SUCCESS, let info else { return nil }
        defer { vm_deallocate(mach_task_self_, vm_address_t(bitPattern: info), vm_size_t(n) * vm_size_t(MemoryLayout<integer_t>.stride)) }
        let per = Int(n) / max(1, Int(count))
        guard per >= 4 else { return nil }
        // Fields are packed uint64 pairs of integer_t: irq_ex_cnt, then ipi_cnt.
        let u64 = { (i: Int, f: Int) in UInt64(UInt32(bitPattern: info[i * per + f * 2])) | UInt64(UInt32(bitPattern: info[i * per + f * 2 + 1])) << 32 }
        let now = (0..<Int(count)).map { [u64($0, 0), u64($0, 1)] }
        let t = DispatchTime.now().uptimeNanoseconds
        defer { lastStat = now; lastStatTime = t }
        let dt = Double(t - lastStatTime) / 1e9
        guard lastStat.count == now.count, dt > 0 else { return nil }
        let rate = { (i: Int, f: Int) in Int((Double(now[i][f] &- self.lastStat[i][f]) / dt).rounded()) }
        return ((0..<now.count).map { rate($0, 0) }, (0..<now.count).map { rate($0, 1) })
    }

    // Every process this user may inspect (root's are refused). Only processes that used CPU since the last scan get
    // their threads listed, which keeps the scan to a few hundred kernel calls.
    private func scan() -> [String: Any] {
        let now = DispatchTime.now().uptimeNanoseconds
        let dt = Double(now - lastScan)
        lastScan = now
        let n = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
        var pids = [pid_t](repeating: 0, count: Int(n) / MemoryLayout<pid_t>.size + 32)
        let got = proc_listpids(UInt32(PROC_ALL_PIDS), 0, &pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        pids = Array(pids.prefix(Int(got) / MemoryLayout<pid_t>.size)).filter { $0 > 0 }

        var times: [pid_t: [UInt64: UInt64]] = [:], csw: [pid_t: Int64] = [:], taskTime: [pid_t: UInt64] = [:]
        var busy: [(cpu: Double, pid: pid_t, info: proc_threadinfo)] = []
        var cswDelta: Int64 = 0, seen = 0, runnable = 0
        var handles = [UInt64](repeating: 0, count: 1024)
        for pid in pids {
            var task = proc_taskinfo()
            guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &task, Int32(MemoryLayout<proc_taskinfo>.size)) == MemoryLayout<proc_taskinfo>.size else { continue }
            csw[pid] = Int64(task.pti_csw)
            if let prev = lastCsw[pid], Int64(task.pti_csw) >= prev { cswDelta += Int64(task.pti_csw) - prev }
            seen += Int(task.pti_threadnum)
            runnable += Int(task.pti_numrunning)
            let used = task.pti_total_user + task.pti_total_system
            taskTime[pid] = used
            if lastTaskTime[pid] == used, let prev = lastThreadTime[pid] {
                times[pid] = prev
                continue
            }
            if Int(task.pti_threadnum) > handles.count { handles = [UInt64](repeating: 0, count: Int(task.pti_threadnum) + 64) }
            let bytes = proc_pidinfo(pid, PROC_PIDLISTTHREADS, 0, &handles, Int32(handles.count * 8))
            guard bytes > 0 else { continue }
            var mine: [UInt64: UInt64] = [:]
            let prev = lastThreadTime[pid]
            for h in handles.prefix(Int(bytes) / 8) {
                var th = proc_threadinfo()
                guard proc_pidinfo(pid, PROC_PIDTHREADINFO, h, &th, Int32(MemoryLayout<proc_threadinfo>.size)) > 0 else { continue }
                let t = th.pth_user_time + th.pth_system_time  // nanoseconds
                mine[h] = t
                if let p = prev?[h], t > p, dt > 0 { busy.append((Double(t - p) / dt * 100, pid, th)) }
            }
            times[pid] = mine
        }
        let hadPrev = !lastCsw.isEmpty
        lastThreadTime = times
        lastCsw = csw
        lastTaskTime = taskTime

        var load = [Double](repeating: 0, count: 1)
        var pset: processor_set_name_t = 0, info = processor_set_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<processor_set_load_info>.size / MemoryLayout<integer_t>.size)
        let psetOK = processor_set_default(mach_host_self(), &pset) == KERN_SUCCESS && withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { processor_set_statistics(pset, PROCESSOR_SET_LOAD_INFO, $0, &count) }
        } == KERN_SUCCESS

        let top = busy.sorted { $0.cpu > $1.cpu }.prefix(12).map { b -> [String: Any] in
            let th = b.info
            let name = withUnsafeBytes(of: th.pth_name) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
            return [
                "pid": Int(b.pid), "proc": procName(b.pid), "name": name, "cpu": (b.cpu * 10).rounded() / 10,
                "pri": Int(th.pth_curpri), "basePri": Int(th.pth_priority),
                "state": [1: "run", 2: "stopped", 3: "wait", 4: "uninterruptible", 5: "halted"][th.pth_run_state] ?? "wait",
                "policy": [2: "rr", 4: "fifo"][th.pth_policy] ?? "timeshare",
            ]
        }
        return [
            "threads": top,
            "contextSwitches": hadPrev && dt > 0 ? Int((Double(cswDelta) / (dt / 1e9)).rounded()) : NSNull(),
            "runnable": runnable,
            "threadsSeen": seen,
            "systemThreads": psetOK ? Int(info.thread_count) : NSNull(),
            "systemTasks": psetOK ? Int(info.task_count) : NSNull(),
            "loadAvg": getloadavg(&load, 1) == 1 ? r3(load[0]) : NSNull(),
        ]
    }

    private func procName(_ pid: pid_t) -> String {
        var buf = [CChar](repeating: 0, count: 256)
        return proc_name(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : "pid \(pid)"
    }
}

private func r3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }
