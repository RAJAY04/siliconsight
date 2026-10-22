import CoreAudio
import CoreGraphics
import CoreMediaIO
import Foundation
import IOKit.hid

// The `sensors` object of each sample, and the `fast` channel (lid angle and trackpad fingers).
// Nothing here opens the camera or microphone, reads keys, or needs a permission prompt.
final class Sensors {
    private let lid = LidSensor()
    private let cameras = builtInCameras()
    private let displayGetBrightness = privateSymbol("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", "DisplayServicesGetBrightness")
        .map { unsafeBitCast($0, to: (@convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32).self) }
    private let keyboard = KeyboardBacklight()
    private(set) var fast: FastChannel?

    /// Starts the lid listener and the trackpad; `emit` gets each encoded `fast` message on `queue`.
    /// Until then (--once, --selftest) the lid is read on demand and the trackpad is never opened.
    func startFast(queue: DispatchQueue, emit: @escaping (Data) -> Void) {
        let fast = FastChannel(queue: queue, emit: emit)
        self.fast = fast
        lid.start(queue: queue) { [weak fast] deg in fast?.lid(deg) }
        fast.lid(lid.angle)
        fast.fingersAvailable = Trackpad.start(fast)
    }

    func read() -> [String: Any] {
        [
            "lidAngleDeg": (fast == nil ? lid.read() : lid.angle) ?? NSNull(),
            "cameraInUse": cameraInUse() ?? NSNull(),
            "micInUse": audioDeviceRunning(kAudioHardwarePropertyDefaultInputDevice) ?? NSNull(),
            "audioPlaying": audioDeviceRunning(kAudioHardwarePropertyDefaultOutputDevice) ?? NSNull(),
            "displayBrightness": displayBrightness() ?? NSNull(),
            "keyboardBacklight": keyboard.read() ?? NSNull(),
        ]
    }

    private func cameraInUse() -> Bool? {
        guard !cameras.isEmpty else { return nil }
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var any = false
        for id in cameras {
            var running: UInt32 = 0, used: UInt32 = 0
            guard CMIOObjectGetPropertyData(id, &addr, 0, nil, 4, &used, &running) == 0 else { return nil }
            any = any || running != 0
        }
        return any
    }

    // Null while the built-in panel is off (lid closed, or a desktop Mac).
    private func displayBrightness() -> Double? {
        guard let get = displayGetBrightness else { return nil }
        var ids = [CGDirectDisplayID](repeating: 0, count: 16), n: UInt32 = 0
        guard CGGetOnlineDisplayList(16, &ids, &n) == .success, let builtIn = ids.prefix(Int(n)).first(where: { CGDisplayIsBuiltin($0) != 0 }) else { return nil }
        var b: Float = 0
        guard get(builtIn, &b) == 0, (0...1).contains(b) else { return nil }
        return (Double(b) * 1000).rounded() / 1000
    }
}

func privateSymbol(_ path: String, _ name: String) -> UnsafeMutableRawPointer? {
    dlopen(path, RTLD_LAZY).flatMap { dlsym($0, name) }
}

// kAudioDevicePropertyDeviceIsRunningSomewhere: some process has the device's IO running. It reads
// state only; no audio is captured.
private func audioDeviceRunning(_ which: AudioObjectPropertySelector) -> Bool? {
    var addr = AudioObjectPropertyAddress(mSelector: which, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var dev = AudioDeviceID(0), size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == noErr, dev != 0 else { return nil }
    addr.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
    var running: UInt32 = 0
    size = 4
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &running) == noErr else { return nil }
    return running != 0
}

// CoreMediaIO devices with the built-in transport: the FaceTime camera and its Desk View twin.
// ponytail: listed once at start; a camera that appears later is not watched.
private func builtInCameras() -> [CMIOObjectID] {
    func address(_ sel: Int) -> CMIOObjectPropertyAddress {
        CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(sel), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                  mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    }
    var addr = address(kCMIOHardwarePropertyDevices)
    var size: UInt32 = 0, used: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, &size) == 0, size > 0 else { return [] }
    var ids = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
    guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, size, &used, &ids) == 0 else { return [] }
    var transport = address(kCMIODevicePropertyTransportType)
    return ids.filter { id in
        var t: UInt32 = 0
        return CMIOObjectGetPropertyData(id, &transport, 0, nil, 4, &used, &t) == 0 && t == kAudioDeviceTransportTypeBuiltIn
    }
}

// KeyboardBrightnessClient from the private CoreBrightness framework, the class Control Center uses.
private final class KeyboardBacklight {
    private typealias Get = @convention(c) (AnyObject, Selector, UInt64) -> Float
    private let client: NSObject?
    private let get: Get?
    private let ids: [UInt64]
    private let sel = NSSelectorFromString("brightnessForKeyboard:")

    init() {
        guard dlopen("/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness", RTLD_LAZY) != nil,
              let cls = NSClassFromString("KeyboardBrightnessClient") as? NSObject.Type,
              let m = class_getInstanceMethod(cls, sel) else { client = nil; get = nil; ids = []; return }
        let c = cls.init()
        client = c
        get = unsafeBitCast(method_getImplementation(m), to: Get.self)
        let idsSel = NSSelectorFromString("copyKeyboardBacklightIDs")
        ids = (c.responds(to: idsSel) ? c.perform(idsSel)?.takeRetainedValue() as? [NSNumber] : nil)?.map(\.uint64Value) ?? []
    }

    func read() -> Double? {
        guard let client, let get, let id = ids.first else { return nil }
        let v = get(client, sel, id)
        return (0...1).contains(v) ? (Double(v) * 1000).rounded() / 1000 : nil
    }
}

// Lid angle: the "las" HID sensor (Apple vendor 0x05AC, product 0x8104, sensor usage page 0x20,
// orientation usage 0x8A). Report 1 is [id, lo, hi] with a 9-bit angle in degrees. How to find and
// decode it comes from LidAngleSensor by Sam Henri Gold (Apache 2.0,
// https://github.com/samhenrigold/LidAngleSensor); that app polls a feature report at 30 Hz, this
// code takes the device's own input reports instead (about one a second at rest), so idle costs
// nothing. Opening this sensor device does not ask for Input Monitoring.
final class LidSensor {
    private let device: IOHIDDevice?
    private let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 8)
    private var onChange: ((Double) -> Void)?
    private(set) var angle: Double?

    init() {
        let match = IOServiceMatching(kIOHIDDeviceKey) as NSMutableDictionary
        match.addEntries(from: [kIOHIDVendorIDKey: 0x05AC, kIOHIDProductIDKey: 0x8104, kIOHIDPrimaryUsagePageKey: 0x20, kIOHIDPrimaryUsageKey: 0x8A])
        let svc = IOServiceGetMatchingService(kIOMainPortDefault, match)
        defer { if svc != 0 { IOObjectRelease(svc) } }
        guard svc != 0, let d = IOHIDDeviceCreate(kCFAllocatorDefault, svc), IOHIDDeviceOpen(d, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess else { device = nil; return }
        device = d
        angle = read()
    }

    static func decode(_ r: UnsafePointer<UInt8>, _ length: Int) -> Double? {
        guard length >= 3, r[0] == 1 else { return nil }
        return Double((Int(r[2]) << 8 | Int(r[1])) & 0x1FF)
    }

    func read() -> Double? {
        guard let device else { return nil }
        var len = CFIndex(8)
        guard IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, buffer, &len) == kIOReturnSuccess else { return nil }
        return LidSensor.decode(buffer, len)
    }

    func start(queue: DispatchQueue, onChange: @escaping (Double) -> Void) {
        guard let device else { return }
        self.onChange = onChange
        IOHIDDeviceSetDispatchQueue(device, queue)
        IOHIDDeviceRegisterInputReportCallback(device, buffer, 8, { ctx, result, _, _, _, report, length in
            guard result == kIOReturnSuccess, let ctx else { return }
            let me = Unmanaged<LidSensor>.fromOpaque(ctx).takeUnretainedValue()
            guard let deg = LidSensor.decode(report, length) else { return }
            me.angle = deg
            me.onChange?(deg)
        }, Unmanaged.passUnretained(self).toOpaque())
        IOHIDDeviceActivate(device)
    }
}

// Trackpad contacts from the private MultitouchSupport framework (the default device: the built-in
// trackpad on a MacBook). Each contact frame arrives on the framework's own thread. Reading
// contacts does not ask for Input Monitoring.
enum Trackpad {
    private typealias Callback = @convention(c) (UnsafeMutableRawPointer?, UnsafeMutableRawPointer?, Int32, Double, Int32) -> Int32
    private static var sink: FastChannel?

    // One contact is 96 bytes: frame i32 @0, timestamp f64 @8, path id i32 @16, state i32 @20,
    // normalized x f32 @32 and y f32 @36 (0..1, origin at the front-left corner), size f32 @48.
    static func decode(_ p: UnsafeRawPointer, _ n: Int) -> [[String: Any]] {
        (0..<n).compactMap { i in
            let t = p + i * 96
            // States 3 (make touch) and 4 (touching) are on the surface; hover and lift are not.
            guard (3...4).contains(t.loadUnaligned(fromByteOffset: 20, as: Int32.self)) else { return nil }
            func unit(_ off: Int) -> Double { (Double(min(max(t.loadUnaligned(fromByteOffset: off, as: Float.self), 0), 1)) * 1000).rounded() / 1000 }
            return ["id": Int(t.loadUnaligned(fromByteOffset: 16, as: Int32.self)), "x": unit(32), "y": unit(36), "size": unit(48)]
        }
    }

    /// Returns false when the framework or a trackpad is missing.
    static func start(_ fast: FastChannel) -> Bool {
        let fw = "/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport"
        guard let create = privateSymbol(fw, "MTDeviceCreateDefault"), let register = privateSymbol(fw, "MTRegisterContactFrameCallback"),
              let startSym = privateSymbol(fw, "MTDeviceStart") else { return false }
        sink = fast
        // The framework prints "*** Recognized ... family ***" to stdout on create; keep it out of the log.
        let saved = dup(1), null = open("/dev/null", O_WRONLY)
        dup2(null, 1)
        defer { fflush(stdout); dup2(saved, 1); close(saved); close(null) }
        guard let dev = unsafeBitCast(create, to: (@convention(c) () -> UnsafeMutableRawPointer?).self)() else { return false }
        let cb: Callback = { _, touches, n, _, _ in
            guard let touches, let sink = Trackpad.sink else { return 0 }
            sink.fingers(Trackpad.decode(touches, Int(n)))
            return 0
        }
        unsafeBitCast(register, to: (@convention(c) (UnsafeMutableRawPointer, Callback) -> Void).self)(dev, cb)
        return unsafeBitCast(startSym, to: (@convention(c) (UnsafeMutableRawPointer, Int32) -> Int32).self)(dev, 0) == 0
    }
}

// Coalesces lid and finger changes into `fast` messages, at most 30 a second. Every message carries
// the current lid angle and fingers. Fingers that lift send one `[]`; nothing is sent while idle.
final class FastChannel {
    private let queue: DispatchQueue
    private let emit: (Data) -> Void
    private var lidDeg: Double?
    private var sentLid: Double?
    private var current: [[String: Any]] = []
    private var dirty = false
    private var scheduled = false
    private var lastEmit = DispatchTime(uptimeNanoseconds: 0)
    var fingersAvailable = false

    init(queue: DispatchQueue, emit: @escaping (Data) -> Void) {
        self.queue = queue
        self.emit = emit
    }

    /// Call on `queue`. The first reading only seeds the value.
    func lid(_ deg: Double?) {
        lidDeg = deg
        guard let deg else { return }
        guard let s = sentLid else { sentLid = deg; return }
        if abs(deg - s) >= 0.5 { markDirty() }
    }

    /// Call from any thread.
    func fingers(_ f: [[String: Any]]) {
        queue.async {
            if f.isEmpty && self.current.isEmpty { return }
            self.current = f
            self.markDirty()
        }
    }

    private func markDirty() {
        dirty = true
        guard !scheduled else { return }
        scheduled = true
        let next = lastEmit + .nanoseconds(1_000_000_000 / 30)
        queue.asyncAfter(deadline: max(next, .now())) { [weak self] in self?.flush() }
    }

    private func flush() {
        scheduled = false
        guard dirty else { return }
        dirty = false
        lastEmit = .now()
        sentLid = lidDeg ?? sentLid
        emit(encode([
            "type": "fast",
            "t": Int(Date().timeIntervalSince1970 * 1000),
            "lidAngleDeg": lidDeg ?? NSNull(),
            "fingers": fingersAvailable ? current : NSNull(),
        ]))
    }
}
