---
id: 01-orientation
title: What's inside the case, and why it's all one chip
minutes: 25
focus: overview
live: [hardware.model, hardware.chip, hardware.pCores, hardware.eCores, hardware.gpuCores, hardware.memBytes, hardware.fanCount, hardware.hasBattery, power.systemW, power.cpuW, power.gpuW, power.aneW]
---
## In plain words

Your Mac is mostly battery. The thinking happens in one small chip that holds every kind of worker under one roof: Fast Workers and Eco Workers for everyday jobs (the CPU), a big team of painters for pictures (the GPU), a specialist for recognising faces and text (the Neural Engine), and a security guard who keeps the keys (the Secure Enclave). They all share one desk, which is the memory, and they all fetch things along one road, the Highway, whose speed limits how fast data can reach the desk.

Older computers put each worker in a separate building and drove parts between them. Putting everyone in one building saves time and energy. The catch is that you can't add more Desk Space later, and when everyone is busy, the Highway gets crowded.

In the app: the exploded drawing is your Mac taken apart, and the magnified chip is that one building.

## The idea

Open a MacBook Air and most of what you see is battery. Four lithium-polymer cells fill the bottom half of the case in a horseshoe around the trackpad. The logic board is a narrow strip running along the hinge, and almost all the computing happens in one small square on it: the system on a chip, or SoC. Beside the SoC sit the NAND flash chips that hold your files, the wireless module, and a few power-management chips that turn battery voltage into the many smaller voltages the chip needs. On the 13-inch Air there is no fan, no heat pipe and no vents. A thin metal shield and the aluminium case are the whole cooling system. (The layout comes from iFixit's M2 Air teardown, which the M4 and M5 Airs reuse. Our [teardown reference](../teardown-reference.md) has the measurements.)

A Mac mini, iMac, MacBook Pro or Mac Studio looks different inside, mostly because it has fans and more room, but the centre of every Apple Silicon Mac is the same idea: one SoC.

### What "system on a chip" means

On an older PC, the main jobs were spread over separate chips. The CPU sat in one package, the graphics card had its own processor and its own memory, the memory sticks plugged into slots, and an SSD controller, a security chip and a sound chip each had their own spot on the board. Wires on the circuit board connected them.

An SoC puts most of those jobs on one piece of silicon. On every M-series chip you get:

- CPU cores of two kinds (fast performance cores and frugal efficiency cores; lesson 2)
- a GPU (lesson 6)
- a 16-core Neural Engine for machine learning (lesson 7)
- media engines that encode and decode video in fixed-function hardware
- a display engine that sends finished frames to the screen
- the Secure Enclave, a separate small processor that holds encryption keys (lesson 11)
- the SSD controller (also lesson 11)
- memory controllers, Thunderbolt and USB controllers, and a large shared cache called the system level cache

The memory (LPDDR DRAM) is not on the same silicon, but it is on the same package: two DRAM chips sit right next to the SoC die on one small substrate. That's what Apple means by "unified memory in a custom package".

### Why put it all together

Moving data costs energy, and the cost grows with distance. Driving a signal down a long trace on a circuit board, through a connector and into another chip takes far more energy per bit than moving it a few millimetres inside one package. It also takes longer.

The bigger win is that every block shares one pool of memory. Apple's M1 announcement in 2020 put it this way, roughly: high-bandwidth, low-latency memory in one pool inside the package, so every part of the SoC can use the same data without copying it between separate pools. On a PC with a graphics card, a texture or a block of model weights has to be copied from system memory across PCIe into the card's own memory before the GPU can use it. On an Apple Silicon Mac, the CPU writes the data and the GPU reads the same physical bytes. Apple's Metal documentation says the same thing in developer terms: Apple GPUs have a unified memory model where the CPU and GPU share system memory.

There are trade-offs. You can't add RAM later, because it's in the package. The GPU shares memory bandwidth with everything else. And a chip with lots of blocks is big and expensive to make, which is why Apple sells the same design with some cores switched off (binning): this Mac's M5 has a 10-core GPU design with 8 cores enabled.

### An analogy that holds up

Think of a workshop. The old PC design is a set of separate rooms. The graphics specialist works in a room with its own shelves, and parts get passed through a hatch, one trolley at a time. The SoC is one big room with a shared central shelf (the memory) and a shared tray by the shelf (the system level cache). Every specialist reaches the same parts directly. Nobody waits for a trolley, but they do all reach for the same shelf, so when everyone is busy the shelf becomes the bottleneck. That last part matters later: memory bandwidth is the speed limit for some workloads, including local language models.

### The family, so you can place your own Mac

Every Apple Silicon Mac since 2020 follows this design. The base chips, from Apple's announcements:

| Chip | Year | CPU cores (base chip) | GPU cores | Memory bandwidth | Process |
|---|---|---|---|---|---|
| M1 | 2020 | 4 P + 4 E | 7 or 8 | 68 GB/s | 5 nm |
| M2 | 2022 | 4 P + 4 E | 8 or 10 | 100 GB/s | 5 nm (2nd gen) |
| M3 | 2023 | 4 P + 4 E | 8 or 10 | 100 GB/s | 3 nm |
| M4 | 2024 | up to 4 P + 6 E | 8 or 10 | 120 GB/s | 3 nm (2nd gen) |
| M5 | 2025 | up to 4 P + 6 E | 8 or 10, each with a Neural Accelerator | 153 GB/s | 3 nm (3rd gen) |

Pro, Max and Ultra chips scale the same parts up: more cores, more memory channels, more bandwidth (up to 400 GB/s on M1 to M3 Max, 546 GB/s on M4 Max, 614 GB/s on M5 Max, and around 800 GB/s on the Ultras, which join two Max dies). M5 Pro and M5 Max change the CPU mix: Apple describes them as 6 "super" cores plus 12 performance cores, with no efficiency cores at all. Lessons that depend on P and E cores note where that matters.

## Watch it live

Start with the overview, the exploded Mac. Each layer is a real part, drawn in the order it stacks: the lid, the hinge and antennas, the top case with keyboard and trackpad, the logic board, the battery cells, the bottom case.

Click the logic board area to open the magnified chip. That's the die map: GPU cores, the P cluster and E cluster, the system level cache, the Neural Engine, media and display engines, the Secure Enclave and the memory interfaces. One honest note: no labelled die photo of the base M5 has been published, so the block positions are a plausible drawing based on Apple's M3 and M4 renders, not a measurement. The counts are real. They come from your Mac.

Now look at the power numbers. The power panel stacks CPU, GPU and Neural Engine watts and calls the gap up to the whole-machine reading "rest of system". At idle, the chip's own blocks often draw well under 2 W while the whole Mac draws several watts, because the display backlight, the wireless radio and the power conversion all cost something. On this M5 Air at a quiet moment the reader showed CPU 1.1 W, GPU 0.2 W, ANE 0 W and system 7 W.

The "What's happening" card in the top left gives you a one-line story. Leave it open through the whole course. Most lessons end with it saying something new.

## Try it

### 1. Ask your Mac what it is

```bash
sysctl machdep.cpu.brand_string hw.perflevel0.name hw.perflevel0.physicalcpu hw.perflevel1.name hw.perflevel1.physicalcpu hw.memsize
system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Chip|Total Number of Cores|Memory"
```

`perflevel0` is the fastest core type and `perflevel1` the next. On this M5 Air the first is named "Super" with 4 cores and the second "Efficiency" with 6. On an M1 to M4 you'll see "Performance" for level 0. On an M5 Pro or Max, level 1 is "Performance" rather than "Efficiency". `hw.memsize` is bytes: 17179869184 is 16 GiB. Compare all of this with the chip panel. They should match, because the reader asks the same questions.

### 2. Check for a fan

```bash
system_profiler SPHardwareDataType SPPowerDataType | grep -iE "model name|fan" ; echo "(no fan lines on a MacBook Air)"
```

The app's `fanCount` comes from the SMC. On an Air it's 0 and no fans are drawn. On a MacBook Pro or Mac mini the scene draws as many fans as the SMC reports.

### 3. Put a number on idle

Close what you can, wait 30 seconds, and read the power panel. Then move a window around quickly for ten seconds and watch the GPU and "rest of system" numbers twitch. Nothing here heats the machine.

## Check yourself

Q: What is on the same silicon die as the CPU cores, and what is only on the same package?
A: GPU, Neural Engine, media and display engines, Secure Enclave, SSD controller, caches and I/O controllers are on the die. The DRAM chips sit beside it on the same package.

Q: Why doesn't an Apple Silicon Mac need to copy data from "system RAM" to "video RAM"?
A: There is only one pool. The CPU and GPU address the same physical memory.

Q: What's the main cost of unified memory?
A: You can't upgrade it, and every block competes for the same memory bandwidth.

Q: Where does most of the volume inside a MacBook Air go?
A: The battery. The logic board is a narrow strip along the hinge.

## Go deeper

- [Apple newsroom, M5 announcement (October 2025)](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/): core counts, 153 GB/s, Neural Accelerators in the GPU.
- [Apple Metal docs, choosing a storage mode for Apple GPUs](https://developer.apple.com/documentation/metal/choosing-a-resource-storage-mode-for-apple-gpus): the official statement of unified memory, from the GPU side.
- [Asahi Linux platform documentation](https://asahilinux.org/docs/platform/subsystems/): the reverse-engineered list of blocks inside the SoC, by people who wrote drivers for them.
- [iFixit, M2 MacBook Air teardown](https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink): the chassis the M5 Air still uses, photographed open.
- [Our teardown reference](../teardown-reference.md): what the exploded view is drawn from and which parts are estimates.
