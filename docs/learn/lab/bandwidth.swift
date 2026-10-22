// Memory bandwidth lab for the SiliconSight course.
// Streams a large buffer through the GPU (or one CPU core) and prints GB/s once a second.
//
//   swift docs/learn/lab/bandwidth.swift            GPU, 20 seconds, 1024 MB buffers
//   swift docs/learn/lab/bandwidth.swift cpu        one CPU core doing memcpy
//   swift docs/learn/lab/bandwidth.swift gpu 30 512 GPU for 30 s with 512 MB buffers
//
// Ctrl-C stops it at any time. It allocates two buffers of the given size and frees them on exit.

import Foundation
import Metal

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "gpu"
let seconds = args.count > 2 ? Double(args[2]) ?? 20 : 20
let mb = args.count > 3 ? Int(args[3]) ?? 1024 : 1024
let bytes = mb << 20

func report(_ moved: Double, _ dt: Double) {
    print(String(format: "%6.1f GB/s", moved / dt / 1e9))
}

if mode == "cpu" {
    let a = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 16384)
    let b = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 16384)
    memset(a, 1, bytes); memset(b, 2, bytes)
    print("One CPU core copying \(mb) MB back and forth for \(Int(seconds)) s")
    let end = Date().addingTimeInterval(seconds)
    var t0 = Date(), moved = 0.0
    while Date() < end {
        memcpy(b, a, bytes)
        moved += Double(2 * bytes) // one read and one write per byte
        let dt = Date().timeIntervalSince(t0)
        if dt >= 1 { report(moved, dt); t0 = Date(); moved = 0 }
    }
    a.deallocate(); b.deallocate()
    exit(0)
}

let source = """
#include <metal_stdlib>
using namespace metal;
kernel void copy4(device const float4 *src [[buffer(0)]], device float4 *dst [[buffer(1)]], uint i [[thread_position_in_grid]]) {
    dst[i] = src[i];
}
"""

guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
    print("No Metal device found."); exit(1)
}
let library = try device.makeLibrary(source: source, options: nil)
let pipeline = try device.makeComputePipelineState(function: library.makeFunction(name: "copy4")!)
guard let src = device.makeBuffer(length: bytes, options: .storageModeShared),
      let dst = device.makeBuffer(length: bytes, options: .storageModeShared) else {
    print("Could not allocate 2 x \(mb) MB."); exit(1)
}
memset(src.contents(), 1, bytes)
let count = bytes / 16
print("GPU (\(device.name)) copying \(mb) MB back and forth for \(Int(seconds)) s")

let end = Date().addingTimeInterval(seconds)
var t0 = Date(), moved = 0.0
while Date() < end {
    let cmd = queue.makeCommandBuffer()!
    let enc = cmd.makeComputeCommandEncoder()!
    enc.setComputePipelineState(pipeline)
    enc.setBuffer(src, offset: 0, index: 0)
    enc.setBuffer(dst, offset: 0, index: 1)
    enc.dispatchThreads(MTLSize(width: count, height: 1, depth: 1),
                        threadsPerThreadgroup: MTLSize(width: pipeline.maxTotalThreadsPerThreadgroup, height: 1, depth: 1))
    enc.endEncoding()
    cmd.commit()
    cmd.waitUntilCompleted()
    moved += Double(2 * bytes)
    let dt = Date().timeIntervalSince(t0)
    if dt >= 1 { report(moved, dt); t0 = Date(); moved = 0 }
}
