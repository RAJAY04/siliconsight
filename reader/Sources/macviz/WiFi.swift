import CoreWLAN

// Wi-Fi link quality from CoreWLAN. These fields need no root and no location permission. The network name
// does need location permission, so it is never read.
enum WiFi {
    static func read() -> Any {
        guard let i = CWWiFiClient.shared().interface(), i.powerOn() else { return NSNull() }
        let ch = i.wlanChannel()
        return fields(rssi: i.rssiValue(), noise: i.noiseMeasurement(), txMbps: i.transmitRate(),
                      channel: ch?.channelNumber ?? 0, band: ch?.channelBand ?? .bandUnknown, width: ch?.channelWidth ?? .widthUnknown)
    }

    /// CoreWLAN reports 0 for a reading it doesn't have, and an RSSI of 0 means the radio is on but not joined to a network.
    static func fields(rssi: Int, noise: Int, txMbps: Double, channel: Int, band: CWChannelBand, width: CWChannelWidth) -> Any {
        guard rssi < 0 else { return NSNull() }
        let bandGHz: Any
        switch band {
        case .band2GHz: bandGHz = 2.4
        case .band5GHz: bandGHz = 5.0
        case .band6GHz: bandGHz = 6.0
        default: bandGHz = NSNull()
        }
        let widthMHz: Any
        switch width {
        case .width20MHz: widthMHz = 20
        case .width40MHz: widthMHz = 40
        case .width80MHz: widthMHz = 80
        case .width160MHz: widthMHz = 160
        default: widthMHz = NSNull()
        }
        return [
            "rssiDbm": rssi,
            "noiseDbm": noise < 0 ? noise : NSNull(),
            "txRateMbps": txMbps > 0 ? txMbps : NSNull(),
            "channel": channel > 0 ? channel : NSNull(),
            "bandGHz": bandGHz,
            "widthMHz": widthMHz,
        ] as [String: Any]
    }
}
