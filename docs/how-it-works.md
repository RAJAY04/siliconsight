# How it works

SiliconSight has two halves. The reader (`reader/`, Swift) samples the hardware once a second and sends JSON over a WebSocket on 127.0.0.1:7878. The page (`web/`, React) draws the exploded Mac from those samples and keeps the last 10 minutes in memory for the sparklines. The message shape is in [CONTRACT.md](../CONTRACT.md).

This page goes part by part: what you see, and where the number behind it comes from. For the exact IOReport channel names and every field that can be null, see [reader/README.md](../reader/README.md).

A rule that holds everywhere: if the reader can't read something on your Mac, it sends `null` and the page prints "n/a". It never fills in a 0.

## CPU cores

Each core is a tile. A busier tile is brighter and flickers faster, and neighbours flicker out of step so a fully loaded cluster shimmers instead of blinking in unison. The chip panel also has a 60-second strip per core, so you can see work move between cores.

Per-core load comes from `host_processor_info`, the same tick counters `top` uses. The reader takes the difference in user, nice, system and idle ticks since the last sample, so 0.4 means the core was busy 40% of the last second.

Which cores are P and which are E comes from the `cluster-type` of each `cpuN` device in IORegistry. On chips with three tiers, the two slower tiers are both shown as E. On the M5, Apple calls the fast cores "Super" internally; the page still says P.

Cluster clocks come from IOReport's "CPU Core Performance States" group. It reports how long each cluster spent in each DVFS state, and the reader weights those residencies by the frequency table it finds on the `pmgr` device in IORegistry. An idle cluster reports its lowest frequency rather than 0.

## GPU and Neural Engine

GPU busy-ness and clock come from IOReport's `GPUPH` residencies, weighted the same way against the GPU's DVFS table. A powered-off GPU shows 0 MHz, which is real: the GPU really is off.

The Neural Engine tiles glow with ANE power, because there is no public counter for ANE utilisation. macOS doesn't expose the ANE core count either, so the Neural Engine is drawn as a single block. The page never invents a core count: if the GPU core count were missing too, the GPU would also be one block.

## Power

On macOS 27, CPU, GPU and ANE watts come from hidden CLPC (Closed Loop Performance Controller) energy counters in IOReport. Their IDs differ per chip, and the table in `reader/Sources/macviz/IOReport.swift` comes from [macmon](https://github.com/vladkens/macmon). On older macOS the same numbers come from IOReport's "Energy Model" group. The reader uses whichever source has a non-zero CPU reading that second.

"System" watts is the SMC key `PSTR`, the whole machine including the display. It's an instant reading and jumps around, so the page averages the last three. The power panel stacks CPU, GPU, ANE and DRAM and calls the gap up to `PSTR` "Rest of system".

DRAM power reads 0 on macOS 27 and shows "n/a".

The chip glows harder as CPU + GPU + ANE power climbs toward about 22 W. Without power numbers it falls back to P-cluster and GPU load.

## Unified memory

The memory panel splits RAM into a grid of blocks. Each block is a fixed slice of your RAM, coloured by what it holds:

- Wired: kernel and driver memory that can't be paged out.
- App: anonymous memory minus purgeable pages, which is roughly what Activity Monitor calls App Memory. The biggest processes are painted onto this region by their memory footprint.
- Compressed: pages the memory compressor has squeezed.
- Cached: inactive pages macOS can drop or reuse.
- Free.

The numbers come from `host_statistics64` (`vm_statistics64`), swap from `vm.swapusage`, and pressure from `kern.memorystatus_vm_pressure_level`. If swap is in use, the panel shows memory spilling to the SSD.

The "Memory" label on the overview is total minus free minus cached, which is closer to "in use" than the free page count alone.

## Memory bandwidth

The particles running between the DRAM packages and the chip are memory traffic. The rate scales with measured DRAM bandwidth as a share of the chip's peak (153 GB/s on the M5, from a table of Apple's published figures in `web/src/story.ts`). A chip missing from the table is scaled against 140 GB/s. About 30% of particles flow back toward memory, as a rough nod to reads outnumbering writes. That split is drawn, not measured.

Bandwidth comes from IOReport's PMP "DCS BW" group, a histogram of memory controller (AMC) read and write traffic in 4 GB/s bins. The reader takes the mean of the bin midpoints, every two seconds. It's coarse, but it needs no root. The byte-exact AMC counters return nothing without root, so chips without this histogram show "n/a" and the particles fall back to GPU load, then CPU load.

## SSD and Wi-Fi

Particles also run between the SSD's NAND and the chip. Reads flow toward the chip, writes away from it, in proportion to the two rates. The rate uses a log scale from 50 KB/s to 3 GB/s, so both a log file being written and a big copy show up.

Disk numbers are byte deltas from the `Statistics` dictionary of every `IOBlockStorageDriver`, summed over all drives. That includes external drives.

Wi-Fi gets particles plus rings from the antennas, log scaled from 2 KB/s to 100 MB/s. The numbers are link-layer byte deltas from `getifaddrs` on the busiest physical interface. macOS rounds these counters to 1 KiB for normal processes, so slow traffic moves in 1 KiB/s steps.

## Battery

The cells fill to the charge level. They turn one colour while charging, another when charge is held, and warn below 20% on battery. The power panel draws adapter, Mac and battery as three nodes with the flow of energy between them.

Everything comes from `AppleSmartBattery` in IORegistry (plus `AppleSmartBatteryPack` on macOS 27): percent, charging, AC attached, cycle count, temperature and the adapter's rated watts. Battery watts is `Amperage` times `Voltage`, positive into the battery. Health is maximum capacity over design capacity, and a new battery can read above 100%.

"Held" means on AC, not charging and below 100%. That's Optimized Battery Charging or a charge limit doing its job, not a fault.

## Heat

A warm glow spreads from the chip into the shield, the case and the top case. Its strength follows CPU temperature from 45 °C (none) to 95 °C (full). If the SMC can't be read, it follows macOS's thermal state (nominal, fair, serious, critical) instead.

CPU temperature is the mean of the SMC's `Tp*` and `Te*` float sensors, and GPU temperature the mean of `Tg*`, read every two seconds. The MacBook Air has no fan, so the glow is literally where the heat goes: into the aluminium. On a Mac with fans, the reader reports their RPM from the SMC (`F<n>Ac`, `F<n>Mn`, `F<n>Mx`), and the scene draws as many fans as it reports.

## Processes

Top processes by CPU and by memory come from `proc_listpids` and `proc_pid_rusage`: CPU time deltas and the memory footprint, refreshed every two seconds. CPU is a percentage of one core, so a 10-core Mac tops out at 1000%. Processes owned by root, such as `kernel_task` and `WindowServer`, can't be inspected without sudo and are left out of the lists. Demo mode follows the same rule.

## What's happening

The card at the top left names the workload. It looks at the median of the last five samples so one spike doesn't flip it, and picks the first rule that matches:

1. Local LLM: Ollama or LM Studio is answering and a model looks like it's generating. That means the runtime reported a token rate, or a model is loaded and the GPU is above 50%, or the GPU is above 60% while app memory jumped by more than 2 GB in 30 seconds. A model that is loaded but idle doesn't take over the card. It gets a short "loaded and idle" note under whichever story wins.
2. Heavy CPU work: the P cluster is above 60%, both over the window and right now. The card names the process that used the most CPU in the window. It only says "near full, clocks at their highest" when the P cores are above 85% and the P clock is within 10% of the highest seen this session.
3. GPU busy, CPU calm: GPU above 50% while the clusters together stay under 60%.
4. Background work: E cores above 30% while P cores stay under 15%. Spotlight indexing and backups look like this.
5. Mostly idle: everything low.
6. Mixed load: anything else.

These are rules of thumb in `web/src/story.ts`, not a classifier. A game at a low resolution can read as heavy CPU work. The thresholds are easy to change.

## Why local LLMs are bandwidth-bound

Text generation produces one token at a time, and each token needs a full pass through the model. For a dense model, that means reading every weight out of memory once per token. The maths per weight is a multiply and an add, which the GPU finishes much faster than memory can deliver the weight. So the GPU spends most of its time waiting on memory, and the speed limit is roughly:

```
tokens per second  ≈  memory bandwidth  ÷  bytes read per token
                   ≈  memory bandwidth  ÷  model size
```

A 4.7 GB model on an M5 with 153 GB/s of bandwidth tops out around 153 ÷ 4.7 ≈ 33 tokens per second, no matter how many GPU cores it has. That's why a quantised model (fewer bytes per weight) runs faster, and why a Max chip, with several times the bandwidth, generates several times faster on the same model.

While a model is generating, the card shows this sum with your numbers: your chip's peak bandwidth divided by the size of the largest loaded model, labelled as a ceiling. Peak bandwidth comes from Apple's published figures in `web/src/story.ts` (M1 to M5, including Pro, Max and Ultra). For a chip not in that table, the card shows the model size and the explanation but no number. The model list comes from Ollama's `/api/ps` on 127.0.0.1:11434, or LM Studio's `/api/v0/models` (then `/v1/models`) on 127.0.0.1:1234, polled every two seconds with a 300 ms timeout. The reader only reads those lists. It doesn't proxy or intercept any requests.

The honest caveats:

- It's a ceiling, not a prediction. Real runtimes reach maybe 60 to 80% of peak bandwidth, and attention over a long context reads the KV cache on top of the weights. Expect real speed well under the number.
- Ollama's `size` is the model's whole memory use, KV cache included, so the divisor runs a little high and the estimate a little low.
- LM Studio doesn't report model size, so with LM Studio the card explains the idea but can't do the sum.
- Mixture-of-experts models read only the active experts per token, so they beat this estimate by a wide margin.
- Prompt processing (before the first token) is compute-bound, not bandwidth-bound. The formula only covers generation.
- Neither runtime reports a live token rate without proxying requests, so the "Measured" line only appears in demo mode.

## Privacy and cost

The reader binds to 127.0.0.1. Every HTTP request needs a `Host` of `127.0.0.1:<port>` or `localhost:<port>`. A WebSocket that sends an `Origin` must come from the page itself or the Vite dev server on port 5173; one with no `Origin` (a local script) is allowed. It holds at most 64 connections and drops a socket that sends no request within 10 seconds. It sends nothing off the machine. With a page connected it uses about 1% of one core. The bandwidth histogram, SMC temperatures and process scan are the expensive parts, which is why they run every two seconds instead of every second.
