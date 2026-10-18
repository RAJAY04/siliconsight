import Foundation
import IOKit

func batteryProperties() -> [String: Any]? {
    let svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
    guard svc != 0 else { return nil }
    defer { IOObjectRelease(svc) }
    var props: Unmanaged<CFMutableDictionary>?
    guard IORegistryEntryCreateCFProperties(svc, &props, nil, 0) == KERN_SUCCESS else { return nil }
    return props?.takeRetainedValue() as? [String: Any]
}

// Returns (battery JSON or nil, battery temperature in C).
func readBattery() -> (battery: Any, tempC: Double?) {
    guard let p = batteryProperties(), let percent = p["CurrentCapacity"] as? Int else { return (NSNull(), nil) }
    let charging = p["IsCharging"] as? Bool ?? false
    let ac = p["ExternalConnected"] as? Bool ?? false
    // macOS 27 moved pack details (temperature, raw capacity) to the AppleSmartBatteryPack child.
    let data = (registryProperty("AppleSmartBatteryPack", "BatteryData") ?? p["BatteryData"]) as? [String: Any]

    // Amperage is a signed mA value stored as a 64-bit two's complement number; Voltage is mV.
    var watts: Any = NSNull()
    if let a = (p["InstantAmperage"] ?? p["Amperage"]) as? Int, let v = p["Voltage"] as? Int {
        watts = (Double(Int64(truncatingIfNeeded: a)) * Double(v) / 1e6 * 10).rounded() / 10
    }
    var health: Any = NSNull()
    let full = (p["AppleRawMaxCapacity"] ?? data?["AppleRawMaxCapacity"] ?? data?["FullChargeCapacity"]) as? Int
    let design = (p["DesignCapacity"] ?? data?["DesignCapacity"]) as? Int
    if let full, let design, design > 0 { health = (Double(full) / Double(design) * 1000).rounded() / 10 }

    // 65535 means "still calculating"; 0 on AC means nothing to estimate.
    var remaining: Any = NSNull()
    if let t = p["TimeRemaining"] as? Int, t > 0, t < 65535 { remaining = t }

    let adapter = (p["AdapterDetails"] as? [String: Any])?["Watts"] as? Int
    let temp = ((p["Temperature"] ?? data?["Temperature"]) as? Int).map { Double($0) / 100 }
    let battery: [String: Any] = [
        "percent": percent,
        "charging": charging,
        "acAttached": ac,
        "watts": watts,
        "adapterW": ac ? (adapter ?? NSNull()) as Any : NSNull(),
        "cycleCount": ((p["CycleCount"] ?? data?["CycleCount"]) as? Int) ?? NSNull(),
        "healthPct": health,
        "timeRemainingMin": remaining,
        "chargeHeld": ac && !charging && percent < 100,
    ]
    return (battery, temp)
}
