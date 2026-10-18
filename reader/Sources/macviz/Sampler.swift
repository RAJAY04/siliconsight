import Foundation

// Builds the hello and sample messages from CONTRACT.md. Not thread safe: call from one queue.
final class Sampler {
    let hw = Hardware()
    private let cpu: CPUUsage
    private let ioreport = IOReport()
    private let smc = SMC()
    private let procs = Processes()
    private let diskNet = DiskNet()
    let llm: LLMPoller
    private var tick = 0
    private var slow: (topCpu: [[String: Any]], topMem: [[String: Any]], battery: Any, batteryTemp: Double?, cpuTemp: Double?, gpuTemp: Double?) = ([], [], NSNull(), nil, nil, nil)

    init(queue: DispatchQueue) {
        cpu = CPUUsage(hw: hw)
        llm = LLMPoller(queue: queue)
    }

    func hello() -> [String: Any] {
        [
            "type": "hello",
            "version": 1,
            "hardware": [
                "model": hw.model,
                "chip": hw.chip,
                "pCores": hw.pCores,
                "eCores": hw.eCores,
                "gpuCores": hw.gpuCores ?? NSNull(),
                "aneCores": NSNull(),
                "memBytes": hw.memBytes,
                "hasBattery": batteryProperties() != nil,
                "fanCount": smc.fanCount,
                "macosVersion": hw.macosVersion,
            ] as [String: Any],
        ]
    }

    func sample() -> [String: Any] {
        let soc = ioreport.read()
        // SMC temperature reads (about 40 slow kernel calls) and the process scan cost the most
        // after IOReport. Refreshing them every 2 s keeps the reader near 1% CPU; process CPU% is
        // still exact because it is a delta over the 2 s window.
        if tick % 2 == 0 {
            let (topCpu, topMem) = procs.read()
            let (battery, batteryTemp) = readBattery()
            slow = (topCpu, topMem, battery, batteryTemp, smc.average(smc.cpuKeys), smc.average(smc.gpuKeys))
        }
        tick += 1
        let (disk, net) = diskNet.read()
        var memory = readMemory(totalBytes: hw.memBytes)
        memory["bandwidthGBs"] = round2(soc.bandwidthGBs)

        // PSTR is the SMC's whole-system power reading in watts.
        let systemW = smc.float("PSTR").flatMap { $0 > 0 ? $0 : nil }

        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        default: thermal = "nominal"
        }

        return [
            "type": "sample",
            "t": Int(Date().timeIntervalSince1970 * 1000),
            "cpu": [
                "cores": cpu.read(),
                "pFreqMHz": round0(soc.pFreqMHz),
                "eFreqMHz": round0(soc.eFreqMHz),
            ] as [String: Any],
            "gpu": ["usage": round3(soc.gpuUsage), "freqMHz": round0(soc.gpuFreqMHz)],
            "power": [
                "cpuW": round2(soc.cpuW), "gpuW": round2(soc.gpuW), "aneW": round2(soc.aneW),
                "dramW": round2(soc.dramW), "systemW": round2(systemW),
            ],
            "memory": memory,
            "topCpu": slow.topCpu,
            "topMem": slow.topMem,
            "disk": disk,
            "net": net,
            "thermal": [
                "state": thermal,
                "cpuTempC": slow.cpuTemp ?? NSNull(),
                "gpuTempC": slow.gpuTemp ?? NSNull(),
                "batteryTempC": slow.batteryTemp ?? NSNull(),
            ] as [String: Any],
            "fans": smc.fans(),
            "battery": slow.battery,
            "llm": llm.current,
        ]
    }
}

private func rounded(_ v: Double?, _ places: Double) -> Any {
    guard let v, v.isFinite else { return NSNull() }
    let m = pow(10, places)
    return (v * m).rounded() / m
}
private func round0(_ v: Double?) -> Any { rounded(v, 0) }
private func round2(_ v: Double?) -> Any { rounded(v, 2) }
private func round3(_ v: Double?) -> Any { rounded(v, 3) }

func encode(_ obj: [String: Any], pretty: Bool = false) -> Data {
    (try? JSONSerialization.data(withJSONObject: shortDoubles(obj), options: pretty ? [.prettyPrinted, .sortedKeys] : [])) ?? Data("{}".utf8)
}

// JSONSerialization prints 100.9 as 100.90000000000001. A decimal built from Swift's shortest
// round-trip text prints as written.
private func shortDoubles(_ v: Any) -> Any {
    switch v {
    case let d as [String: Any]: return d.mapValues(shortDoubles)
    case let a as [Any]: return a.map(shortDoubles)
    case is Int, is Bool: return v
    case let x as Double where x.isFinite: return NSDecimalNumber(string: "\(x)")
    default: return v
    }
}
