---
id: 06-gpu-and-display
title: The GPU, tile-based rendering and the display
minutes: 30
focus: gpu
live: [gpu.usage, gpu.freqMHz, power.gpuW, thermal.gpuTempC, memory.bandwidthGBs, hardware.gpuCores, sensors.displayBrightness]
---
## In plain words

The GPU is a big team of painters. Each painter is simple, but there are thousands of them working at once, which is perfect for colouring millions of pixels on your screen, editing photos, or the maths behind AI.

Apple's painters work cleverly: they split the screen into small squares and, for each square, work out what will actually be visible before painting it, so they never paint something that ends up hidden. They keep each square on a small easel next to them and only put the finished square on the wall once. That saves a lot of trips along the Highway to memory.

In the app: the GPU block lights up when you open Mission Control, scroll, or play a game. If its clock is high but its power is low, it's waiting on the Highway, not working hard.

## The idea

A CPU core is built to run one complicated instruction stream as fast as possible. A GPU is built for the opposite case: the same simple program run on millions of pieces of data at once, like computing the colour of every pixel on the screen. It has many more arithmetic units than a CPU, each one simpler, and it hides memory delays by keeping thousands of threads in flight and switching to another when one stalls.

Your Mac's GPU has between 7 and 80 cores depending on the chip (7 or 8 on an M1, 8 or 10 on base M2 to M5, up to 40 on M5 Max, 80 on M3 Ultra). Each GPU core contains many arithmetic lanes. Graphics is the obvious job, but the same hardware runs any data-parallel work: image filters, video effects, physics, and the matrix maths behind machine learning. On the M5, Apple added a Neural Accelerator inside each GPU core, dedicated matrix-multiply hardware that apps reach through Metal 4's tensor operations.

### Metal

Apps talk to the GPU through Metal, Apple's graphics and compute API. A Metal app builds command buffers, lists of draws and compute dispatches, and hands them to the GPU. Higher-level frameworks (Core Animation, SwiftUI, Core Image, Safari's WebGL and WebGPU, games, MLX and llama.cpp's Metal backend) all end up as Metal commands.

### Tile-based deferred rendering, in plain words

Apple GPUs descend from PowerVR designs, and like them they render in tiles. Apple's Metal documentation describes it this way, paraphrased:

1. The GPU first processes all the geometry for a frame (where every triangle lands on screen) and sorts it into a grid of small tiles.
2. Then, one tile at a time, many tiles in parallel across the GPU cores, it works out which triangles are actually visible in that tile and throws away the hidden ones before shading any pixels.
3. It shades only the visible pixels, keeping the tile in tile memory: fast, on-GPU storage that Apple says has many times the bandwidth and many times lower latency of device memory, at much lower energy.
4. When the tile is finished, it writes the final colours to memory once.

A traditional desktop GPU (immediate mode) shades triangles as they arrive and reads and writes the frame in main memory over and over as later triangles cover earlier ones. Tiling saves both work (no shading of hidden pixels) and memory traffic (each tile is written out once). Since memory traffic is one of the most energy-hungry things a chip does, this is a big reason Apple GPUs are efficient.

Metal exposes this to developers. A texture can be "memoryless", existing only in tile memory and never in DRAM at all, which is perfect for a depth buffer that's only needed while drawing a frame.

### Dynamic Caching

From the M3 on, Apple's GPU allocates its on-chip memory (registers, threadgroup and tile memory) dynamically in hardware, giving each running program only what it needs at that moment instead of reserving the worst case up front. Apple calls it Dynamic Caching. The effect is that more work fits on the GPU at once, so it's busy more of the time.

### From GPU to pixels

Your app doesn't draw straight to the screen. On macOS each window draws into its own buffer. A system process, WindowServer, composites all the window buffers, the menu bar and the cursor into one frame, using the GPU. Then a separate block, the display engine, reads that frame out of memory and sends it to the panel, line by line, every refresh. The Asahi Linux project found the display engine is driven by its own coprocessor, the DCP (display coprocessor), running Apple firmware.

That scanout is constant memory traffic even when nothing changes. A 2560 × 1664 panel at 4 bytes per pixel and 60 frames a second is about 1 GB/s just to keep the picture on screen, before any frame compression the hardware may apply, which Apple doesn't document. (The Air's refresh rate isn't on its spec page; 60 Hz is the usual value for non-ProMotion Mac displays, so treat the figure as an estimate.)

### What the GPU is not good at

Branchy code where every thread takes a different path, small jobs where launching the work costs more than doing it, and anything that needs one long chain of dependent steps. Those belong on the CPU. And because the GPU shares memory bandwidth with everything else on the chip, a GPU job that streams a lot of data can be limited by memory rather than by its own cores. You'll measure exactly that below.

### An analogy

An immediate-mode GPU is a painter who paints every layer of a mural on the wall as instructions arrive, including the parts later covered up. A tile-based GPU first sketches the whole design, cuts the wall into postcards, and for each postcard works out what will actually show, paints only that, on a small easel next to them, and then sticks the finished postcard on the wall once. The easel is tile memory. Walking to the wall is memory traffic.

## Watch it live

Open the chip panel and find the GPU block. Its usage and clock come from macOS's GPU performance-state residency counters. A GPU at 0 MHz is powered off, and that's real. The power panel shows GPU watts separately from CPU.

Then do ordinary things and watch. Open Mission Control (swipe up with three fingers, or press F3): the GPU wakes for the animation and goes back to sleep. Resize a window quickly: GPU up, P cluster up. Play a video in Safari: the GPU barely moves, because decoding happens in the media engine, a separate fixed-function block. The app doesn't have a counter for the media engine, so you'll see its effect only as low GPU and CPU load during playback and a little extra in "rest of system".

## Try it

### 1. Make the GPU wait for memory (uses battery, warms the machine a little)

The course ships a small Metal program that copies a 1 GB buffer back and forth on the GPU. From the repository root:

```bash
swift docs/learn/lab/bandwidth.swift gpu 20
```

It compiles for a few seconds, then prints GB/s once a second for 20 seconds. Ctrl-C stops it early. On this M5 Air it reported about 125 GB/s, the reader's bandwidth reading agreed at about 123 GB/s, the GPU showed 100% busy, and yet the GPU clock sat at about 1090 MHz, well under its 1578 MHz top step. GPU power was only about 1.7 W.

Read that carefully. The GPU is "100% busy", but it isn't working hard. It's waiting on memory, and macOS sees no point in clocking it higher. This is what "memory-bound" looks like, and it's the whole story of lesson 10.

### 2. Make the GPU work for real

Open a 3D-heavy web page, a game, or Photo Booth's effects, and compare: now GPU usage, clock and watts climb together. Close it and watch the GPU drop to 0 MHz within a second or two.

### 3. Compare scrolling and video

Scroll a long page for 10 seconds, then play a video for 10 seconds. Note GPU watts and P-cluster load for each and decide which costs more. It depends on the page and the video, which is the point: guess first, then look.

## Check yourself

Q: What does tile-based deferred rendering avoid that an immediate-mode GPU does?
A: Shading pixels that end up hidden, and repeatedly reading and writing the frame in main memory.

Q: The GPU shows 100% busy at a low clock while copying memory. Why doesn't macOS raise the clock?
A: The GPU is limited by memory bandwidth; a higher clock would only make it wait faster and cost more power.

Q: Why does video playback barely touch the GPU?
A: Decoding runs in the media engine, separate fixed-function hardware.

Q: What sends the finished frame to the panel?
A: The display engine, driven by its own coprocessor (the DCP), after WindowServer composites the windows with the GPU.

## Go deeper

- [Apple Metal docs, tailor your apps for Apple GPUs and tile-based deferred rendering](https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering): Apple's own description of TBDR and tile memory.
- [Apple Metal docs, choosing a resource storage mode for Apple GPUs](https://developer.apple.com/documentation/metal/choosing-a-resource-storage-mode-for-apple-gpus): shared, private and memoryless memory.
- [Apple tech talk, Explore GPU advancements in M3 and A17 Pro](https://developer.apple.com/videos/play/tech-talks/111375): Dynamic Caching, ray tracing and mesh shading.
- [Apple Machine Learning Research, LLMs with MLX and the M5 Neural Accelerators](https://machinelearning.apple.com/research/exploring-llms-mlx-m5): what the per-core Neural Accelerators change.
- [Asahi Linux platform documentation](https://asahilinux.org/docs/platform/subsystems/): AGX (the GPU) and the display coprocessor, from the driver writers.
