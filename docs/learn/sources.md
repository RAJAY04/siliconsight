# Sources

Everything the course relies on, grouped by topic, with what I took from each. "This Mac" means measurements on the test machine: a 13-inch MacBook Air, M5, 16 GB, Mac17,3, macOS 27.0.1, taken on 18 October 2026 with other apps running.

## Apple chips and Macs

- [Apple newsroom, Apple unleashes M5 (October 2025)](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/). Up to 4 performance and 6 efficiency cores, a 10-core GPU with a Neural Accelerator in each core, an improved 16-core Neural Engine, 153 GB/s (nearly 30% over M4, more than 2x M1), third-generation 3 nm. Lessons 1, 6, 9.
- [Apple newsroom, MacBook Air with M5 (March 2026)](https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-macbook-air-with-m5/). N1 chip with Wi-Fi 7 and Bluetooth 6, 512 GB base storage, SSD "2x faster", fanless, up to 18 hours. Lessons 1, 11, 13.
- [Apple newsroom, MacBook Pro with M5 Pro and M5 Max (March 2026)](https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/). 307 and 614 GB/s; with secondary reporting (TechSpot, Guru3D), 6 super cores plus 12 performance cores and no efficiency cores. Lessons 1, 2, 9.
- [Apple newsroom, M4 Pro and M4 Max (October 2024)](https://www.apple.com/newsroom/2024/10/apple-introduces-m4-pro-and-m4-max/). M4: up to 4 P plus 6 E cores, 120 GB/s. Lesson 1.
- Apple's M1 announcement (November 2020), via the [Business Wire copy](https://www.businesswire.com/news/home/20201110006071/en/Apple-Unleashes-M1). Unified memory in a single pool in a custom package, used by every block without copying. Lesson 1.
- [Apple, MacBook Air 13-inch M5 tech specs](https://support.apple.com/126320). 4 super plus 6 efficiency cores, 8- or 10-core GPU, 16 to 32 GB, 153 GB/s, 53.8 Wh, 40 W adapter standard (35 W dual or 70 W optional), fast charge with 70 W or more, Thunderbolt 4 at 40 Gb/s, 10 to 35 °C operating range. Lessons 1, 12, 13, 16.
- `web/src/story.ts` in this repository. The per-chip peak bandwidth table (M1 to M5) used for the lesson 1 table, cross-checked against the Apple pages above for M1, M4, M5, M5 Pro and M5 Max.
- [Our teardown reference](../teardown-reference.md), which draws on iFixit's M2 Air teardown and chip ID. Chassis layout, four-cell horseshoe battery, shield without heatsink. Lessons 1, 5, 12.

## CPU microarchitecture

- [AnandTech, Apple M1 and A14 deep dive (2020)](https://www.anandtech.com/show/16226/apple-silicon-m1-a14-deep-dive/2). Firestorm decodes 8 instructions per clock; the reorder buffer is about 630 entries. Measured on A14/M1. Lesson 2.
- [AnandTech, The 2020 Mac mini unleashed](https://www.anandtech.com/show/16252/mac-mini-apple-m1-tested). One Firestorm core: about 58 GB/s reads, 33 to 36 GB/s writes, 60 to 62 GB/s copies. Confirmed through search snippets of the page; AnandTech has closed and the page now redirects, so I couldn't open it directly. Lesson 9.
- [Chips and Cheese, iGPU cache setups compared, including M1](https://chipsandcheese.com/p/igpu-cache-setups-compared-including-m1). M1: 12 MB P-cluster L2, 8 MB SLC, 8 KB GPU L1, 1 MB GPU L2. Lesson 2.
- [Chips and Cheese, clock ramp addendum](https://chipsandcheese.com/p/addendum-clock-ramp-on-adl-zen-4-m1-and-more). M1 reaches 3.2 GHz a little after 100 ms; Intel about 5 ms, Zen 4 about 11 ms. Lesson 4.
- [Creative Strategies, M5: it's all about the cache and tensors](https://www.creativestrategies.com/research/m5-apple-silicon-its-all-about-the-cache-and-tensors/). Estimate of about 32 MB SLC on base M5. Secondary, not confirmed by Apple; marked as an estimate in lesson 2.
- This Mac, `sysctl hw.perflevel*`. Cache sizes, core counts, the "Super" and "Efficiency" names, 128-byte lines, 16 KB pages. Lessons 1, 2, 8.

## Scheduling, QoS and power

- [Eclectic Light, Scheduling of threads on M1 series chips](https://eclecticlight.co/2022/01/25/scheduling-of-threads-on-m1-series-chips-second-draft/) and [Making the most of Apple silicon power: 3](https://eclecticlight.co/2022/10/13/making-the-most-of-apple-silicon-power-3-controls/). QoS 9 threads are confined to E cores; higher QoS prefers P cores and spills to E. M1 E cores have about half the P core's processing units. Lessons 2, 3.
- [Eclectic Light, Inside M4 chips: CPU core management](https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/). M4 E cores at about 1020 MHz for background work against 2592 MHz for spillover; P cores from 4512 MHz single-threaded down to about 3852 MHz all-core; threads move within a cluster about every 0.1 s and between clusters every 4 to 5 s. Lessons 2, 3.
- [Eclectic Light, CPU core frequencies for all Apple silicon Macs (April 2026)](https://eclecticlight.co/2026/04/13/cpu-core-frequencies-updated-for-all-current-apple-silicon-macs/). Maximum E and P frequencies M1 to M5, from `powermetrics`. Lesson 2.
- [Eclectic Light, In the background: Spotlight indexing](https://eclecticlight.co/2026/02/10/in-the-background-spotlight-indexing/). Spotlight processes run at low QoS, almost entirely on E cores. Lesson 3.
- [Apple, Energy Efficiency Guide for Mac Apps: prioritize work at the task level](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheTaskLevel.html). The QoS classes, their durations, what QoS controls, and the advice to run at utility or lower about 90% of the time. Lesson 3.
- [Apple, Energy Efficiency Guide: fundamental concepts](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/FundamentalConcepts.html). Fixed versus dynamic cost; waking the CPU and GPU costs about ten times sleep power; race back to idle. Lessons 4, 16.
- [Apple developer documentation, DispatchQoS](https://developer.apple.com/documentation/dispatch/dispatchqos). Class descriptions. Lesson 3.
- The macOS SDK header `sys/qos.h` on this Mac. QoS values 0x21, 0x19, 0x15, 0x11, 0x09. Lesson 3.
- `man taskpolicy` on this Mac. The `-b`, `-B`, `-c` and `-p` options. Lesson 3.
- [Linux kernel binding, Apple cluster cpufreq](https://kernel.org/doc/Documentation/devicetree/bindings/cpufreq/apple%2Ccluster-cpufreq.yaml), and the Asahi `apple-soc-cpufreq` driver. A per-cluster DVFS controller in hardware. Lessons 2, 4.
- [macmon by vladkens](https://github.com/vladkens/macmon). The counter IDs the reader uses for CPU, GPU and ANE watts. Lesson 4.
- This Mac, `ioreg -rn pmgr`. The frequency and voltage tables (P cluster 1308 MHz at 635 mV to 4464 MHz at 1070 mV). The reading of these keys as frequency and millivolt pairs follows the reader's own source (`reader/Sources/macviz/IOReport.swift`); Apple doesn't document it. Lesson 4.

## Thermal

- [Apple documentation, ProcessInfo.ThermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum) and the [older energy guide page on thermal state](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/RespondToThermalStateChanges.html). The four states and what apps should do at each. Lesson 5.
- [iFixit, M2 MacBook Air teardown](https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink). Shield and thermal pad, no heatsink. Lesson 5.
- [Notebookcheck, MacBook Air 13 M4 review](https://www.notebookcheck.net/The-passively-cooled-M4-SoC-makes-the-competition-look-old-Apple-MacBook-Air-13-M4-entry-review.1002534.0.html). Seen in search results only (the page refused my fetch): the Air throttles in multi-minute Cinebench runs, with the fan-cooled Mac mini about 10% ahead. Listed in lesson 5 as further reading, not quoted for numbers.
- This Mac: a 3-minute all-core `yes` run, logged every 15 s with the reader. Lesson 5's table.

## GPU and display

- [Apple Metal docs, tailor your apps for Apple GPUs and TBDR](https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering). How TBDR works; tile memory has much higher bandwidth, lower latency and lower energy than device memory. Lesson 6.
- [Apple Metal docs, choosing a resource storage mode for Apple GPUs](https://developer.apple.com/documentation/metal/choosing-a-resource-storage-mode-for-apple-gpus). Unified memory model; shared, private and memoryless modes. Lessons 1, 6.
- [Apple tech talk, Explore GPU advancements in M3 and A17 Pro](https://developer.apple.com/videos/play/tech-talks/111375), with Apple's M3 announcement as reported by AppleInsider. Dynamic Caching. Lesson 6.
- [Asahi Linux platform documentation](https://asahilinux.org/docs/platform/subsystems/) and [glossary](https://asahilinux.org/docs/project/glossary/). AGX, DCP, ANS, AIC, DART, SEP, SMC, AMX and other block names. Lessons 1, 6, 11, 13.
- [The Apple Wiki, DCP](https://theapplewiki.com/wiki/DCP). The display coprocessor, introduced with A14 and M1, running RTKit firmware. Lesson 6.
- [WWDC21, Optimize for variable refresh rate displays](https://developer.apple.com/videos/play/wwdc2021/10147/). Frame pacing. Lesson 15.

## Neural Engine and matrix units

- [Apple Machine Learning Research, Deploying transformers on the Apple Neural Engine (2022)](https://machinelearning.apple.com/research/neural-engine-transformers). A11 at 0.6 TFLOPS FP16; the 2021 16-core ANE at 15.8, 26 times more; layout rules (4D channels-first, last axis aligned to 64 bytes); DistilBERT at 3.47 ms and 0.454 W on iPhone 13. Lesson 7.
- [Matthijs Hollemans, neural-engine](https://github.com/hollance/neural-engine). No public ANE programming interface; Core ML decides placement; Metal can't target the ANE. Lesson 7.
- [Bryngelson, Apple Neural Engine: architecture, programming and performance (arXiv 2606.22283, 2026)](https://arxiv.org/abs/2606.22283). Large reverse-engineering study, with direct measurements on M1 and M5. I read the abstract only; per-figure claims attributed to it in search summaries (SRAM size, TFLOPS) are not used in the course.
- Secondary reports of Apple's TOPS figures (M1 11, M2 15.8, M3 18, M4 38) and the note that M4's figure is INT8 while earlier ones are FP16 (Notebookcheck, Macwelt via search). Lesson 7. Apple's own pages give these per chip; I didn't open each one.
- [corsix/amx](https://github.com/corsix/amx) and [tzakharko, M4 SME exploration](https://github.com/tzakharko/m4-sme-exploration). AMX on M1 to M3, SME added on M4. Lesson 7.
- This Mac, `lab/ane.swift`. About 125 images/s at 0.8 W ANE, against about 33 images/s at 12 W CPU-only. Lesson 7.

## Memory

- [Apple, View memory usage in Activity Monitor](https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac). Definitions of app, wired, compressed and cached memory and of memory pressure. Lesson 8.
- [Eclectic Light, Memory Lane: grokking memory problems in Activity Monitor](https://eclecticlight.co/2022/01/19/memory-lane-grokking-memory-problems-in-activity-monitor/). How to read the memory tab; watch trends, not snapshots. Lesson 8.
- [Apple newsroom, OS X Mavericks (2013)](https://www.apple.com/newsroom/2013/10/23OS-X-Mavericks-Available-Today-Free-from-the-Mac-App-Store/), and iMore's preview of compressed memory. Compression to about half size, faster than swapping to disk. Lesson 8.
- [XNU source, vm_compressor_algorithms.c](https://opensource.apple.com/source/xnu/xnu-6153.61.1/osfmk/vm/vm_compressor_algorithms.c.auto.html). The compressor chooses between WKdm and LZ4. Lesson 8.
- `man memory_pressure` and `man vm_stat` on this Mac, and the measurements in lesson 8. `memory_pressure -S` (simulated pressure) fails without root, so the course doesn't use it.

## Memory bandwidth and local LLMs

- [llama.cpp discussion 4167, Apple Silicon performance](https://github.com/ggml-org/llama.cpp/discussions/4167). Prompt and generation speed per chip for Llama 7B Q4_0 (3.56 GiB), as of August 2026, including the base M5 row flagged as uncertain. Lesson 10.
- [Apple Machine Learning Research, Exploring LLMs with MLX and the M5 Neural Accelerators](https://machinelearning.apple.com/research/exploring-llms-mlx-m5). Time to first token is compute-bound and generation bandwidth-bound; M5 versus M4: 3.3 to 4.1x faster time to first token, 19 to 27% faster generation; tested on a 24 GB M5 MacBook Pro. Lessons 6, 10.
- [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md). Bits per weight and size for Llama 3.1 8B in each format. Lesson 10.
- [Ollama FAQ](https://docs.ollama.com/faq). `ollama ps`, 5-minute keep-alive, 4096-token default context, `OLLAMA_KV_CACHE_TYPE`. Lesson 10.
- KV cache formula and the Llama 3.1 8B figure of 128 KB per token, from [APXML's KV cache sizing notes](https://apxml.com/courses/designing-and-sizing-production-llm-infrastructure/chapter-3-inference-dynamics-attention/kv-cache-memory-scaling), checked against the model's published configuration (32 layers, 8 KV heads, head size 128). Lesson 10.
- Metal's recommended working set of about 75% of RAM, from developer write-ups such as [this note on the macOS Metal VRAM cap](https://github.com/ivanopcode/devnote-override-macos-metal-vram-cap). Secondary; Apple doesn't publish the rule. Lesson 10.
- [How the app works](../how-it-works.md). The bandwidth histogram and the LLM ceiling with its caveats. Lessons 9, 10.
- This Mac, `lab/bandwidth.swift`. GPU about 125 GB/s; one CPU thread 91 to 112 GB/s; both together about 119 GB/s. Lesson 9.

## Storage and security

- [Apple Platform Security, Secure Enclave](https://support.apple.com/guide/security/sec59b0b31ff). Dedicated AES-256 engine on the DMA path between flash and memory, L4-based sepOS, memory protection engine, keys never exposed to the CPU. Lesson 11.
- [Apple Platform Security, volume encryption with FileVault](https://support.apple.com/guide/security/sec4c6dc1b6e). With FileVault off the volume key is protected by the hardware UID; with it on, by the password and the UID; erase destroys the key. Lesson 11.
- [Apple Platform Security, DMA protections](https://support.apple.com/guide/security/seca4960c2b5/web). One IOMMU per DMA agent, including each PCIe and Thunderbolt port; out-of-bounds access panics. Lesson 13.
- [Apple Platform Security, Gatekeeper and runtime protection](https://support.apple.com/guide/security/sec5599b66df), with MITRE ATT&CK's Gatekeeper notes. Signature and notarization checks at first launch. Lesson 15.
- [TidBITS, clarifying the lack of Mac Studio SSD upgradability (2022)](https://tidbits.com/2022/03/23/clarifying-the-lack-of-mac-studio-ssd-upgradability/). The controller is in the SoC; flash modules are raw NAND tied to the chip. Lesson 11.
- [Eclectic Light, How long will my Mac's SSD last? (2026)](https://eclecticlight.co/2026/02/26/how-long-will-my-macs-ssd-last/). At least 3,000 erase-write cycles estimated; a 256 GB M1 at 10% used after 136 TB; avoid swap for longevity. Lesson 11.
- This Mac: `diskutil`, `fdesetup`, `iostat` and `dd` results in lesson 11 (protocol "Apple Fabric", about 6.1 GB/s peak writes reaching the SSD).

## Battery

- [Apple, About Optimized Battery Charging and Charge Limit on Mac](https://support.apple.com/102338). Holding at 80%, "Charging On Hold", Charge Limit from 80 to 100% on macOS Tahoe 26.4 and later, resuming after a 5% drop. Lesson 12.
- [Apple, Determine battery cycle count for Mac notebooks](https://support.apple.com/102888). 1000 cycles for every Apple Silicon MacBook Air; retains up to 80% of capacity at that count. Lesson 12.
- [Apple, Why lithium-ion](https://www.apple.com/batteries/why-lithium-ion/). Fast charge to 80%, then trickle; what a cycle is. Lesson 12.
- [Apple, Maximizing battery life and lifespan](https://www.apple.com/batteries/maximizing-performance/). 10 to 35 °C comfort zone for MacBooks; heat above 35 °C can permanently reduce capacity; store at 50%. Lessons 5, 12.
- [Battery University, BU-808: How to prolong lithium-based batteries](https://batteryuniversity.com/index.php/learn/article/how_to_prolong_lithium_based_batteries). Capacity retention by temperature and charge level, cycle life by charge voltage. General lithium-ion data, not Apple cells. Lesson 12.
- This Mac: `pmset`, `system_profiler SPPowerDataType` and `ioreg AppleSmartBattery`. bq40z651 gauge, 25 cycles, 100.6% health, 12.3 V pack, and a held charge at 80% on a 30 W adapter. Lesson 12.

## Wireless, ports and sensors

- [Apple, Wi-Fi specification details for Apple devices](https://support.apple.com/guide/deployment/dep268652e6c). M5 Air: 2400 Mbps and 160 MHz on 5 and 6 GHz, 229 Mbps on 2.4 GHz, 2 streams; the M4 Air has the same 5 and 6 GHz limits. Lesson 13.
- [Apple, Recommended settings for Wi-Fi routers](https://support.apple.com/102766). Lesson 13.
- Asahi Linux and kernel mailing list reporting on Apple's Type-C PHY and ACIO Thunderbolt blocks ([Phoronix](https://www.phoronix.com/news/Linux-6.8-IOMMU), [LKML](https://lkml.iu.edu/hypermail/linux/kernel/2601.1/07167.html)). Thunderbolt and USB4 inside the SoC, a combined PHY per port, DART per port. Lesson 13.
- [Apple Platform Security, hardware microphone disconnect](https://support.apple.com/guide/security/secbbd20b00b/web). Lid-close mic disconnect in hardware on all Apple Silicon laptops; camera not disconnected. Lesson 14.
- [Apple, Don't close your MacBook with a cover over the camera](https://support.apple.com/102177). The camera can't activate without its indicator light. Lesson 14.
- [Apple, Control Center and privacy indicators on Mac](https://support.apple.com/guide/mac-help/mchl50f94f8f). Orange, green and purple dots and the location arrow; one dot at a time. Lesson 14.
- [Michael Tsai on the MacBook Neo's on-screen camera indicator](https://mjtsai.com/blog/?p=51291), quoting Apple's Platform Security Guide. Exclave-drawn indicator on A18 Pro. Lesson 14.
- [Apple Platform Deployment, privacy preferences](https://support.apple.com/guide/platform-support/supae21a43c8). Input Monitoring, Screen and System Audio Recording, Accessibility. Lesson 14.
- [Gigazine on LidAngleSensor (2025)](https://gigazine.net/gsc_news/en/20250908-macbook-sensor-angle-screen-hinge) and [Sam Henri Gold's LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor). The hinge sensor since the 2019 16-inch MacBook Pro, no public API, sleep and wake role, not working on M1. Lesson 14.
- Force Touch descriptions from [Macworld](https://www.macworld.com/article/671590/how-does-force-touch-work.html) and [AnandTech's 2015 MacBook review](https://www.anandtech.com/show/9136/the-2015-macbook-review/5). Four corner force sensors and a Taptic Engine. Lesson 14. Specific gram and hertz figures in those search summaries aren't used.
- [Asahi Linux, M2 release report](https://asahilinux.org/2022/07/july-2022-release/), with reporting on DockChannel. M2 and later laptops use an input coprocessor. Lessons 14, 15.
- [Our reader's README](../../reader/README.md). Lid sensor device and report, CoreMediaIO and CoreAudio checks, MultitouchSupport, and the TCC observations. Lesson 14.
- This Mac: Photo Booth turned the reader's `cameraInUse` from false to true and back. Lesson 14.

## Claims I couldn't verify

- The base M5's system level cache size (about 32 MB from Creative Strategies; Apple doesn't publish it).
- Whether the M5 MacBook Air's P cluster tops out at 4464 MHz while Oakley lists 4608 MHz for the M5 super core. This Mac's own table stops at 4464 MHz, and I couldn't find which Mac Oakley measured.
- Where background-QoS threads run on M5 Pro and M5 Max, which have no efficiency cores.
- The M5 Air's display refresh rate (assumed 60 Hz for the scanout and keypress estimates).
- Why the base M5 row in the llama.cpp table reaches only 46% of its bandwidth ceiling.
- Which macOS features use the Neural Engine (Live Text, dictation and so on). Apple doesn't say, so lesson 7 calls them candidates to test.
- What `diskutil apfs list`'s "Encrypted: No" means on an Apple Silicon volume that the hardware encrypts anyway.
- Whether AnandTech counted copy bandwidth once or twice per byte, which affects how directly the M1 and M5 single-thread numbers compare.
- The Ollama experiments in lesson 10, which I couldn't run because Ollama isn't installed on the test Mac. The commands follow Ollama's documentation.
- Which quantization Ollama and LM Studio pick by default.
