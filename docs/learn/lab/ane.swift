// Neural Engine lab for the SiliconSight course.
// Runs Apple's built-in Vision image classifier on a generated picture, over and over,
// so the ANE power reading has something to show. Nothing is downloaded and no camera is used.
//
//   swift docs/learn/lab/ane.swift          20 seconds, let Core ML pick the hardware
//   swift docs/learn/lab/ane.swift 30 cpu   30 seconds, forced onto the CPU for comparison
//
// Ctrl-C stops it.

import CoreGraphics
import Foundation
import Vision

let args = CommandLine.arguments
let seconds = args.count > 1 ? Double(args[1]) ?? 20 : 20
let cpuOnly = args.count > 2 && args[2] == "cpu"

// A 512 x 512 test card: coloured stripes, enough structure for the classifier to chew on.
let size = 512
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
for i in 0..<16 {
    ctx.setFillColor(red: CGFloat(i % 4) / 3, green: CGFloat(i / 4) / 3, blue: 0.5, alpha: 1)
    ctx.fill(CGRect(x: i * 32, y: 0, width: 32, height: size))
}
let image = ctx.makeImage()!

let request = VNClassifyImageRequest()
if cpuOnly, let cpu = MLComputeDevice.allComputeDevices.first(where: { if case .cpu = $0 { return true } else { return false } }) {
    request.setComputeDevice(cpu, for: .main)
}
print("Classifying a test image for \(Int(seconds)) s\(cpuOnly ? " on the CPU only" : ""). Watch ANE power.")

let end = Date().addingTimeInterval(seconds)
var t0 = Date(), n = 0
while Date() < end {
    try VNImageRequestHandler(cgImage: image).perform([request])
    n += 1
    let dt = Date().timeIntervalSince(t0)
    if dt >= 1 { print(String(format: "%5.0f images/s", Double(n) / dt)); t0 = Date(); n = 0 }
}
