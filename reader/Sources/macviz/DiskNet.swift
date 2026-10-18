import Foundation
import IOKit

final class DiskNet {
    private var lastDisk: (read: UInt64, write: UInt64)?
    private var lastNet: [String: (rx: UInt32, tx: UInt32)] = [:]
    private var lastTime = Date()
    private var primary: String?

    init() { _ = read() }

    // An interface recreated under the same name restarts its counters, which wraps to ~4 GB.
    // No link here moves 1 GB in one interval, so a delta that large reads as 0.
    static func rate(_ now: UInt32, _ last: UInt32, _ dt: Double) -> Double {
        let d = now &- last
        return d > 1_000_000_000 ? 0 : Double(d) / dt
    }

    func read() -> (disk: [String: Any], net: [String: Any]) {
        let now = Date()
        let dt = max(now.timeIntervalSince(lastTime), 0.001)
        lastTime = now

        let d = DiskNet.diskBytes()
        var readBps = 0.0, writeBps = 0.0
        if let l = lastDisk, d.read >= l.read, d.write >= l.write {
            readBps = Double(d.read - l.read) / dt
            writeBps = Double(d.write - l.write) / dt
        }
        lastDisk = d

        let ifs = DiskNet.interfaces()
        // if_data counters are 32-bit; wrapping subtraction handles one rollover per interval.
        // macOS rounds them to 1 KiB for ordinary processes, so low rates move in 1 KiB/s steps.
        // Primary = the physical interface with the most traffic this interval; it sticks while idle.
        // VPN tunnels (utun) are skipped so traffic is not counted twice.
        let skip = ["lo", "utun", "awdl", "llw", "bridge", "gif", "stf", "anpi", "ap"]
        var rates: [String: (rx: Double, tx: Double)] = [:]
        for (name, c) in ifs where !skip.contains(where: { name.hasPrefix($0) }) {
            guard let l = lastNet[name] else { continue }
            rates[name] = (DiskNet.rate(c.rx, l.rx, dt), DiskNet.rate(c.tx, l.tx, dt))
        }
        if let busiest = rates.max(by: { $0.value.rx + $0.value.tx < $1.value.rx + $1.value.tx }),
           busiest.value.rx + busiest.value.tx > 0 {
            primary = busiest.key
        } else if primary == nil {
            // First read or all idle: start with the interface that has moved the most bytes.
            primary = ifs.filter { i in !skip.contains { i.key.hasPrefix($0) } }
                .max { UInt64($0.value.rx) + UInt64($0.value.tx) < UInt64($1.value.rx) + UInt64($1.value.tx) }?.key
        }
        let rxBps = primary.flatMap { rates[$0]?.rx } ?? 0
        let txBps = primary.flatMap { rates[$0]?.tx } ?? 0
        lastNet = ifs
        return (["readBps": readBps.rounded(), "writeBps": writeBps.rounded()],
                ["rxBps": rxBps.rounded(), "txBps": txBps.rounded(), "iface": primary ?? NSNull()])
    }

    private static func diskBytes() -> (read: UInt64, write: UInt64) {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOBlockStorageDriver"), &it) == KERN_SUCCESS else { return (0, 0) }
        defer { IOObjectRelease(it) }
        var r: UInt64 = 0, w: UInt64 = 0
        while case let s = IOIteratorNext(it), s != 0 {
            defer { IOObjectRelease(s) }
            guard let stats = IORegistryEntryCreateCFProperty(s, "Statistics" as CFString, nil, 0)?.takeRetainedValue() as? [String: Any] else { continue }
            r += (stats["Bytes (Read)"] as? UInt64) ?? 0
            w += (stats["Bytes (Write)"] as? UInt64) ?? 0
        }
        return (r, w)
    }

    private static func interfaces() -> [String: (rx: UInt32, tx: UInt32)] {
        var out: [String: (rx: UInt32, tx: UInt32)] = [:]
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return out }
        defer { freeifaddrs(head) }
        var p = head
        while let ifa = p?.pointee {
            defer { p = ifa.ifa_next }
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_LINK),
                  ifa.ifa_flags & UInt32(IFF_UP) != 0, let data = ifa.ifa_data else { continue }
            let d = data.assumingMemoryBound(to: if_data.self).pointee
            out[String(cString: ifa.ifa_name)] = (d.ifi_ibytes, d.ifi_obytes)
        }
        return out
    }
}
