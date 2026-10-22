# Glossary

Every term used in the course, in alphabetical order. The lesson where it's explained properly is in brackets.

AES engine. A dedicated hardware block on the path between storage and memory that encrypts and decrypts data with AES-256 as it moves, without using the CPU. [11]

AGX. The Asahi Linux project's name for Apple's GPU architecture. [6]

AIC. Apple Interrupt Controller: the hardware that delivers interrupts (signals that something needs attention) to CPU cores. [1]

AMX. Apple's undocumented matrix instructions on M1 to M3, executed by a matrix unit attached to the CPU clusters. Used through Apple's Accelerate framework. [7]

ANE. Apple Neural Engine: a 16-core fixed-function accelerator for neural network operations, reached only through Core ML. [7]

ANS. The Asahi name for Apple's storage coprocessor, the SSD controller inside the SoC. [11]

APFS. Apple File System, the file system on every modern Mac. Each APFS volume has its own encryption key. [11]

App memory. Memory apps have allocated for themselves (heap, stacks), minus purgeable memory. Roughly Activity Monitor's App Memory. [8]

Arithmetic intensity. How many operations a computation does per byte it loads from memory. Low intensity means bandwidth-bound; high means compute-bound. [9]

Background QoS. The lowest standard QoS class, value 9. On two-tier Apple chips, background threads run only on E cores. [3]

Bandwidth. See memory bandwidth.

Binning. Selling chips with some cores disabled, either because those cores have flaws or to make a cheaper model. This Mac's M5 has 8 of 10 GPU cores enabled. [1]

Branch predictor. The part of a CPU core that guesses which way a conditional jump will go, so it can keep working before it knows. [2]

Cache. A small, fast memory close to a processor that keeps recently used data. Apple Silicon has L1 per core, L2 per cluster and an SLC shared by the whole chip. [2]

Cache line. The unit a cache moves data in: 128 bytes on Apple Silicon. [2]

Cached files. File data macOS keeps in otherwise unused memory so it can be reread without going to the SSD. Dropped instantly when memory is needed. [8]

Charge cycle. Using 100% of the battery's capacity in total, possibly spread over several days. [12]

Charge Limit. A macOS Tahoe 26.4 and later setting on Apple Silicon laptops that caps charging between 80% and 100%. [12]

Charging On Hold. What the battery menu shows when Optimized Battery Charging is pausing at 80%. The app calls it "held". [12]

CLPC. Closed Loop Performance Controller: the part of macOS that chooses cluster frequencies and power budgets. Its energy counters give the app CPU, GPU and ANE watts. [4]

Cluster. A group of CPU cores of one kind sharing an L2 cache and one clock. [2]

Compressed memory. Pages macOS has compressed in RAM instead of writing them to swap. [8]

Compressor. The part of macOS that compresses idle memory pages, using WKdm or LZ4. [8]

Core ML. Apple's framework for running machine learning models. It decides whether each part of a model runs on the ANE, GPU or CPU. [7]

Cycle count. How many charge cycles the battery has done. Apple rates Apple Silicon MacBook Airs for 1000. [12]

DART. Apple's IOMMU, which limits which memory each device can reach by DMA. [13]

dBm. Decibels relative to one milliwatt, the unit for Wi-Fi signal strength. Always negative here; closer to 0 is stronger. [13]

DCP. Display coprocessor: a processor inside the SoC that drives the display engine. [6]

Decode. The stage of a CPU core that works out what each instruction means. The M1 P core decodes 8 instructions per clock. [2]

Die. The single piece of silicon a chip is made on. [1]

DMA. Direct memory access: a device reading or writing memory itself without the CPU copying the data. [13]

DRAM. Dynamic random-access memory, the main memory. Apple Silicon uses LPDDR DRAM in the chip package. [1]

DVFS. Dynamic voltage and frequency scaling: changing a cluster's clock and voltage on the fly to match the load. [4]

Dynamic Caching. From the M3 on, the GPU's hardware allocation of on-chip memory to running programs as needed. [6]

Dynamic power. Power used by transistors switching. Scales roughly with voltage squared times frequency. [4]

E core. Efficiency core: a smaller, slower, low-voltage CPU core for work nobody is waiting on. Eco Workers in the plain-words track. [2]

Eco Workers. The plain-words name for E cores.

Exclave. A protected execution environment on M4, A18 and later chips, separate from the kernel. The MacBook Neo draws its camera indicator from one. [14]

Fast Workers. The plain-words name for P cores.

FileVault. macOS's full-volume encryption tied to your login password, on top of the always-on hardware encryption. [11]

Flash translation layer. SSD controller logic that maps the addresses the system asks for onto physical flash locations, and handles wear levelling and garbage collection. [11]

Force Touch trackpad. A trackpad with force sensors and no mechanical click; the Taptic Engine simulates the click. [14]

FP16. 16-bit floating point, the main number format of the Neural Engine and of unquantized LLM weights. [7]

Gatekeeper. The macOS feature (the `syspolicyd` daemon) that checks downloaded apps are signed and notarized before they first run. [15]

GPU. Graphics processing unit: many simple cores running the same program on lots of data at once. [6]

Highway Speed. The plain-words name for memory bandwidth.

Immediate-mode rendering. The traditional GPU approach of shading triangles as they arrive, with the frame kept in main memory. [6]

IOMMU. Input-output memory management unit: hardware that translates and restricts device memory accesses. Apple's is the DART. [13]

IOReport. A private macOS interface for hardware counters; the app reads clocks, power and bandwidth from it. [4]

KV cache. The stored keys and values for every earlier token in an LLM conversation, so they aren't recomputed. Grows with context length. [10]

L1, L2. The first two cache levels: L1 per core, L2 shared by a cluster. [2]

Latency. The delay before one request is answered. [9]

Leakage. Power that leaks through transistors even when they aren't switching. Grows with voltage and temperature. [4]

Lid angle sensor. A hinge sensor in Mac laptops since 2019 that reports how far the lid is open. [14]

Link rate. The raw radio rate between the Mac and the Wi-Fi router, not the internet speed. [13]

Lithium-ion. The battery chemistry in every Mac laptop: lithium ions move between graphite and a metal oxide. [12]

LLM. Large language model, such as Llama or Qwen. [10]

LPDDR5X. The low-power DRAM type in the M5. [9]

LZ4. A fast general-purpose compression algorithm, one of the two the memory compressor uses. [8]

MCS. Modulation and coding scheme: how many bits each Wi-Fi radio burst carries, chosen from signal quality. [13]

Media engine. Fixed-function hardware for encoding and decoding video. [6]

Memory bandwidth. Bytes per second the memory can deliver while streaming: 153 GB/s on the M5. Highway Speed in the plain-words track. [9]

Memory pressure. macOS's judgement of how well memory is meeting demand: normal, warn or critical. The number to watch, not "memory used". [8]

Memoryless texture. A Metal texture that exists only in GPU tile memory, never in DRAM. [6]

Metal. Apple's API for graphics and GPU compute. [6]

MIMO. Multiple input, multiple output: several antennas carrying separate data streams at once. The Air has 2 streams. [13]

Mixture of experts (MoE). An LLM design where each token uses only a few of many weight sets, so it reads less memory per token than its size suggests. [10]

N1. Apple's wireless chip in the M5 MacBook Air: Wi-Fi 7, Bluetooth 6 and Thread. [13]

NAND flash. The memory type that stores data in an SSD. [11]

Neural Accelerator. Matrix-multiply hardware inside each GPU core, new in the M5. [6, 7]

Notarization. Apple's automated malware check of developer-signed software; Gatekeeper checks for its ticket. [15]

Optimized Battery Charging. A macOS feature that learns your routine and holds the charge at 80% when you'll be plugged in for a long time. [12]

Out-of-order execution. A core running independent instructions as soon as their inputs are ready, rather than strictly in program order. [2]

Overflow Storage. The plain-words name for swap.

P core. Performance core: a big, wide, high-clock CPU core. Called a "super" core on the M5. Fast Workers in the plain-words track. [2]

Page. The unit macOS manages memory in: 16 KB on Apple Silicon. [8]

Page cache. File data held in RAM. Writes are collected there before going to the SSD, and reads are served from it when possible. [11]

Perplexity. A measure of how well a language model predicts text; used to measure quality lost to quantization. [10]

Prompt processing. The first phase of LLM inference, reading the whole prompt. Compute-bound. [10]

QoS. Quality of service: the class an app gives each thread (user interactive, user initiated, utility, background) to tell macOS how much it matters. [3]

Quantization. Storing model weights in fewer bits (for example about 4.9 bits in Q4_K_M) to make the model smaller and faster to read. [10]

Race to idle. Finishing work quickly so the hardware can drop into deep idle, because being awake has a fixed cost. [4]

Reorder buffer. The list of in-flight instructions in an out-of-order core: about 630 entries on the M1 P core. [2]

Roofline. A chart showing performance limited by bandwidth at low arithmetic intensity and by peak compute at high intensity. [9]

Scheduler. The part of the macOS kernel that decides which thread runs on which core and when. [3]

Secure Enclave. A separate secure processor inside the SoC that manages encryption keys and biometric data; keys never reach the main CPU. [11]

SLC. System level cache: a large cache shared by every block on the chip. 8 MB measured on M1; not published for M5. [2]

SMC. System Management Controller: reports temperatures, fans and system power. [5]

SME. Arm's Scalable Matrix Extension, supported from the M4 on. [7]

SoC. System on a chip: CPU, GPU, Neural Engine and much more on one die. [1]

Spatial stream. One independent data stream in MIMO Wi-Fi. [13]

SSD. Solid-state drive: flash storage. On Apple Silicon, raw NAND driven by a controller inside the SoC. [11]

Super core. Apple's M5-generation name for its fastest CPU core. [2]

Swap. Memory pages written to files on the SSD when RAM runs out, in `/System/Volumes/VM`, encrypted. Overflow Storage in the plain-words track. [8]

Taptic Engine. The linear actuator that taps the trackpad glass to simulate a click. [14]

taskpolicy. A macOS command that runs or changes a process with a different scheduling policy; `-b` puts it in the background state. [3]

TCC. Transparency, Consent and Control: the macOS service that enforces privacy permissions. [14]

Thermal state. macOS's four-level summary of thermal stress: nominal, fair, serious, critical. Not a temperature. [5]

Throttling. Lowering clocks and power to keep temperatures in limits. [5]

Thunderbolt 4. A 40 Gb/s port standard over USB-C that carries PCIe, DisplayPort and USB. [13]

Tile memory. Fast on-GPU memory where each screen tile is rendered before being written to DRAM. [6]

Tile-based deferred rendering (TBDR). Rendering the screen tile by tile, removing hidden surfaces before shading. [6]

Token. A piece of text, roughly three-quarters of an English word, that an LLM reads and writes. [10]

TOPS. Trillions of operations per second, Apple's measure of Neural Engine peak throughput. Check whether it's quoted for INT8 or FP16. [7]

TRIM. A command that tells an SSD which blocks hold deleted data. [11]

Unified memory. One pool of memory shared by the CPU, GPU and every other block, with no copying between separate memories. Desk Space in the plain-words track. [1, 8]

User interactive, user initiated, utility. The higher QoS classes (33, 25 and 17). [3]

Voltage. The electrical push the chip runs at. Higher clocks need more, and dynamic power grows with its square. [4]

Wear levelling. Spreading writes across all flash cells so none wears out early. [11]

WindowServer. The macOS process that composites all windows into the frame you see. [6, 15]

Wired memory. Memory that can't be compressed or swapped: kernel data and buffers hardware uses directly. [8]

WKdm. A compression algorithm designed for in-memory data, used by the memory compressor. [8]
