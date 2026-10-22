---
id: 09-memory-bandwidth
title: Memory bandwidth, the speed limit you rarely see
minutes: 25
focus: memory
live: [memory.bandwidthGBs, gpu.usage, gpu.freqMHz, power.gpuW, power.cpuW, memory.wiredBytes, cpu.cores]
---
## In plain words

Memory bandwidth is Highway Speed: how much data per second can travel between the desk (memory) and the workers. This Mac's Highway carries up to 153 GB a second, and every worker on the chip shares the same road.

Most everyday jobs barely use it, because workers keep what they need close at hand. But some jobs need a constant flood of data and do very little with each piece: copying big files in memory, scanning huge spreadsheets, and especially running AI chatbots on your Mac. For those, the Highway is the limit. Hiring more workers doesn't help when the road is jammed.

In the app: the particles flowing between the memory chips and the processor are the traffic on that Highway. More particles, more GB per second.

## The idea

Memory has two speeds. Latency is how long one request takes to come back, on the order of a hundred nanoseconds for a request that misses every cache. Bandwidth is how many bytes per second can flow when you stream a lot of data. Caches and out-of-order cores mostly deal with latency. Bandwidth is a harder wall: once every memory channel is busy, nothing makes data arrive faster.

Apple publishes a peak bandwidth for every chip: 153 GB/s on the base M5 (68 on M1, 100 on M2 and M3, 120 on M4), up to 307 GB/s on the M5 Pro and 614 GB/s on the M5 Max. The number comes from the memory's width times its transfer rate. The M5 uses LPDDR5X; Pro and Max chips get more by using more memory channels in parallel, not faster memory.

### Who uses bandwidth

Everything on the chip shares it: CPU cores, the GPU, the Neural Engine, the media engines, the display engine reading the frame buffer, the SSD controller moving data in and out. At idle, total traffic on this Mac reads a few GB/s. Most everyday work never comes close to the peak, because caches serve most requests.

### When bandwidth is the limit

Every computation needs data and does some arithmetic on it. The ratio between the two, operations per byte loaded from memory, is called arithmetic intensity, and it decides which limit you hit.

- High intensity: compiling code, encrypting a file, rendering a complicated 3D scene. Each byte gets used many times from cache. The cores are the limit. Faster clocks or more cores help.
- Low intensity: copying a big buffer, scanning a large array once, applying a simple filter to a huge image, and above all generating text with a language model, where every weight is read once and used for a single multiply-add. The memory is the limit. More cores or higher clocks don't help at all.

The M5's GPU can do trillions of operations per second. At 153 GB/s it can only receive about 76 billion 16-bit numbers a second. Any job doing fewer than a few dozen operations per number fetched spends most of its time waiting. Engineers draw this as a "roofline": performance rises with intensity until it hits the flat roof of peak compute, and below that, the sloped part of the roof is bandwidth.

### What the app measures

The reader gets bandwidth from a macOS counter group (PMP "DCS BW") that reports the memory controllers' read and write traffic as a histogram in 4 GB/s bins. It takes the mean every two seconds. It's coarse but needs no root. The particles between the DRAM packages and the chip scale with that reading as a share of your chip's peak. The roughly 30% of particles flowing back toward memory are a drawing choice, not a measured read/write split.

### What I measured

Using the course's lab program (Try it below) on this M5 MacBook Air:

| Test | Reported | Reader's DRAM reading | Share of 153 GB/s peak |
|---|---|---|---|
| GPU copying 1 GB buffers | about 125 GB/s | about 123 GB/s | about 82% |
| One CPU thread, `memcpy` of 1 GB | 91 to 112 GB/s over three runs | about 107 GB/s (110 GB/s run) | 60 to 73% |
| Both at once | GPU about 78 + CPU about 41 = about 119 GB/s | about 125 GB/s | about 80% |

Two things surprised me. First, the program's own count and the reader's histogram agree within a few percent, which is good evidence the histogram is honest. Second, one CPU thread got 91 to 112 GB/s on its own, varying between runs with whatever else the Mac was doing. On the M1 in 2020, AnandTech measured a single Firestorm core at about 58 GB/s for reads, 33 to 36 GB/s for writes and 60 to 62 GB/s for copies, already unusual at the time. On this M5 a single thread reaches most of the chip's total. Two cautions: I couldn't find a published single-core figure for the M5, and I don't know whether AnandTech counted a copy's bytes once or twice (the lab counts each byte twice, once read and once written), so compare the two loosely. Third, running both together didn't add up: the GPU dropped to about 78 and the CPU to about 41 GB/s, about 119 in total, close to what the GPU managed alone.

Real workloads reach maybe 60 to 85% of the published peak. The peak counts every cycle of every channel; real traffic has gaps for refresh, direction changes between reads and writes, and imperfect access patterns.

### An analogy

A motorway into a city. Bandwidth is the number of lanes times the speed limit: how many cars per hour can arrive. Latency is how long one car's trip takes. A factory in the city that needs a thousand parts a minute, and does five seconds of work on each, is limited by the motorway, no matter how many workers it hires. A factory that does an hour of work on each part doesn't care about the motorway at all.

## Watch it live

Open the memory panel and find bandwidth and its 2-minute sparkline. At idle on this Mac it reads a few GB/s, around 5 to 8 GB/s with a browser and several apps open. Scroll and resize windows and it twitches. It only gets near the peak during streaming work: the lab below, or a local language model generating text (lesson 10).

## Try it

### 1. Max out bandwidth from the GPU (uses battery)

From the repository root:

```bash
swift docs/learn/lab/bandwidth.swift gpu 20
```

The program allocates two 1 GB buffers, copies one to the other on the GPU in a loop, and prints GB/s each second. Ctrl-C stops it. Watch: bandwidth near your chip's peak, particles at full flow, GPU at 100%, GPU clock well below its top step (about 1090 of 1578 MHz here), and wired memory up by about 2 GB while the buffers exist. Add a third argument to change the buffer size, for example `swift docs/learn/lab/bandwidth.swift gpu 20 256` for 256 MB. If the result jumps much higher with small sizes, you're seeing the system level cache rather than DRAM.

### 2. Now from one CPU thread

```bash
swift docs/learn/lab/bandwidth.swift cpu 20
```

One thread doing `memcpy`. Watch one cluster's load and the bandwidth reading. Compare the number with the GPU's.

### 3. Run both at once

Open two Terminal windows and start the GPU and CPU tests together. The two numbers should add up to roughly the same total as either one alone, not double. On this Mac the GPU fell from about 126 to 78 GB/s and the CPU from about 91 to 41 GB/s, together about 119 GB/s, while the reader showed about 125 GB/s. That's the shared motorway.

## Check yourself

Q: What's the difference between memory latency and memory bandwidth?
A: Latency is the delay for one request; bandwidth is bytes per second when streaming many.

Q: Why did the GPU sit at 100% busy but well below its top clock during the copy test?
A: It was waiting on memory. Higher clocks wouldn't move data any faster.

Q: Which is more likely to be bandwidth-bound: compiling a large project, or scanning a 10 GB array once?
A: Scanning the array. Each byte is used once, so arithmetic intensity is very low.

Q: Two programs each reach 120 GB/s alone. What do you expect when they run together on a 153 GB/s chip?
A: Roughly 120 to 150 GB/s combined, split between them. They share the same memory.

## Go deeper

- [Apple newsroom, M5 announcement](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/): the 153 GB/s figure and the comparison with M4 and M1.
- [Apple newsroom, M5 Pro and M5 Max](https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/): 307 and 614 GB/s.
- [AnandTech, The 2020 Mac mini unleashed: putting Apple Silicon M1 to the test](https://www.anandtech.com/show/16252/mac-mini-apple-m1-tested): the single-core bandwidth measurements quoted above. AnandTech has since closed, so the page may only load from an archive.
- [Chips and Cheese, iGPU cache setups compared, including M1](https://chipsandcheese.com/p/igpu-cache-setups-compared-including-m1): latency and bandwidth across cache levels.
- [How the app measures bandwidth](../how-it-works.md#memory-bandwidth): the histogram, its 4 GB/s bins and its limits.
