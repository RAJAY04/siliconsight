---
id: 02-cpu-cores
title: CPU cores, caches and why there are two kinds
minutes: 35
focus: cpu
live: [cpu.cores, cpu.pFreqMHz, cpu.eFreqMHz, power.cpuW, topCpu, hardware.pCores, hardware.eCores]
---
## In plain words

Your Mac's CPU has two kinds of workers. Fast Workers (performance cores) are strong and quick but eat a lot of energy. Eco Workers (efficiency cores) are slower but sip energy. This Mac has 4 Fast and 6 Eco Workers.

Each worker keeps a tiny notepad right next to them for things they need constantly (the L1 cache), a shared shelf for their team (L2), and a big cupboard the whole building shares (the system level cache). Going all the way to the desk (memory) is slow by comparison, so good workers keep what they need close.

Why two kinds? Most jobs aren't urgent. Checking email in the background doesn't need a Fast Worker, so an Eco Worker does it for a fraction of the energy. When you open an app, the Fast Workers jump in.

In the app: each tile on the chip is one worker. Brighter means busier.

## The idea

A CPU core runs one stream of instructions at a time: load this, add that, compare, jump. Your Mac has several cores so it can run several streams at once. What makes a modern core fast is not one trick but a pipeline of them.

### What a core does, step by step

1. Fetch. The core pulls the next few instructions from memory, in practice from its instruction cache.
2. Decode. It works out what each instruction means. Arm instructions are all 4 bytes long, which makes it easy to decode many in parallel. AnandTech's 2020 analysis of the M1's performance core (Firestorm) found it decodes 8 instructions per clock, wider than any x86 core of its time.
3. Rename and schedule. Here is the clever part. The core looks far ahead in the instruction stream and finds instructions that don't depend on each other. Those can run now, out of program order. AnandTech measured the M1 P core's reorder buffer, the list of instructions in flight, at around 630 entries. So the core can be juggling hundreds of instructions at once while it waits for slow ones.
4. Execute. Many execution units work in parallel: integer adders, multipliers, floating-point and vector units, load and store units.
5. Retire. Results are committed in the original program order, so to software it looks as if everything ran one at a time.

Branches make this hard, because the core has to guess which way an "if" will go before it knows. A branch predictor learns patterns and guesses right most of the time. A wrong guess means throwing away the work done down the wrong path. Apple's announcements for M4 and for the M5 Pro and Max both list better branch prediction among the headline changes, which tells you how much it matters.

### Why caches exist

The core can do a few billion operations a second. Main memory takes on the order of a hundred nanoseconds to answer a request that misses every cache, and in that time a core running at 4 GHz could have done hundreds of cycles of work. Out-of-order execution hides some of that wait. Caches hide most of it.

A cache is a small, fast memory that keeps recently used data close to the core. Your Mac has three levels, and you can read their sizes yourself. On this M5 MacBook Air, `sysctl` reports:

| | Performance ("Super") core | Efficiency core |
|---|---|---|
| L1 instruction cache, per core | 192 KB | 128 KB |
| L1 data cache, per core | 128 KB | 64 KB |
| L2 cache, shared by the cluster | 16 MB for 4 cores | 6 MB for 6 cores |
| Cache line | 128 bytes | 128 bytes |

Beyond L2 sits the system level cache (SLC), shared by every block on the chip: CPU, GPU, Neural Engine and the rest. Apple doesn't publish its size. On the M1 it was measured at 8 MB. Analysts estimate around 32 MB for the base M5, but I couldn't verify that from a primary source, so treat it as an estimate.

Data moves in lines, 128 bytes at a time on Apple Silicon. Reading one byte brings its neighbours along. That's why code that walks through memory in order is fast and code that hops around randomly is slow, on any machine.

### Clusters

Cores come in clusters. All the cores in a cluster share one L2 cache and one clock: the cluster runs at a single frequency, and each core can be busy or idle within it. Linux developers who wrote the Asahi CPU frequency driver describe a separate frequency controller per cluster. That's why the app shows one clock for the P cluster and one for the E cluster, not one per core.

### Why two kinds

Since the M1, every base M-series chip has had two kinds of core. The performance (P) cores are big and wide. The efficiency (E) cores are smaller: on the M1, Howard Oakley describes them as having roughly half the internal processing units, and they run at lower clocks and lower voltage.

The reason is energy. A big core finishes work sooner, but every extra execution unit, every wider buffer, costs power even when it's only half used. Plenty of work doesn't need speed: checking mail, indexing files, syncing photos, keeping the clock ticking. Running that on a small core costs a fraction of the energy. When you do need speed, the big cores are there.

The maximum clocks show the split. From Oakley's April 2026 table, read with `powermetrics`:

| Chip | E core max | P core max |
|---|---|---|
| M1 | 2064 MHz | 3228 MHz |
| M2 | 2424 MHz | 3696 MHz |
| M3 | 2748 MHz | 4056 MHz |
| M4 | 2892 MHz | 4512 MHz |
| M5 | 3048 MHz | 4608 MHz (Super) |

One wrinkle: the highest step in this MacBook Air's own frequency table is 4464 MHz, not 4608. Oakley doesn't say which M5 Mac his figure comes from. It may be a MacBook Pro, and I couldn't confirm whether the Air is capped lower.

On the M5 generation Apple renamed things. The base M5's fast cores are "super" cores. The M5 Pro and M5 Max drop efficiency cores entirely and pair 6 super cores with 12 "performance" cores designed for efficient multithreaded work. The two-tier idea is the same; the labels moved. The app calls the top tier P and everything below it E.

### An analogy

Think of a restaurant kitchen. A P core is a senior chef who reads the whole order ticket at once, starts the sauce while the pasta water heats, and guesses which dish comes next. That's out-of-order execution and branch prediction. The L1 cache is the chef's cutting board, L2 is the shared counter for that team of cooks, the SLC is the walk-in fridge every team shares, and DRAM is the delivery truck. The E cores are a second, smaller team who are slower but use far less gas, and they handle the prep nobody is waiting on. The kitchen manager deciding who cooks what is the scheduler, which is lesson 3.

## Watch it live

Open the chip panel. Each core is a tile: brighter and faster flicker means busier. The E tiles are the six smaller ones and the P tiles the four larger ones on this Mac; your counts come from `hw.perflevel` and will differ on other chips. Under the die map there's a 60-second strip per core.

Watch it while you do nothing. On a quiet Mac the E cores usually carry most of the small background load and the P cores sit near zero. That's the design working.

Now watch the P clock and CPU watts. When a P core wakes for even a short burst, the P cluster clock jumps and the CPU power reading jumps with it.

## Try it

### 1. One busy thread

`yes` prints "y" forever. Sent to `/dev/null`, it's a pure CPU loop that uses one thread.

```bash
yes > /dev/null &
```

Watch the chip panel for 20 seconds, then stop it:

```bash
killall yes
```

What I saw on this M5 Air: the P cluster jumped to its top step, 4464 MHz, CPU power rose to about 9.5 W, and the load was spread across all four P tiles at about 25% each instead of one tile at 100%. That isn't four threads. It's one thread that macOS moves between the cores of the cluster several times a second. Oakley measured this on M4 at about every 0.1 seconds within a cluster. Your Activity Monitor will still say `yes` is using 100% of one core.

### 2. Fill the cluster, then the chip

Count your P cores with `sysctl -n hw.perflevel0.physicalcpu`, then start that many:

```bash
for i in $(seq $(sysctl -n hw.perflevel0.physicalcpu)); do yes > /dev/null & done
```

All P tiles go solid. On this Mac with 4 threads the P clock settled around 4060 MHz, lower than the single-thread 4464, and CPU power was about 18 W. The cluster runs slower when all its cores are busy. Now add enough threads for every core:

```bash
for i in $(seq $(sysctl -n hw.perflevel1.physicalcpu)); do yes > /dev/null & done
```

The E tiles fill too, and the E clock goes to its maximum (3048 MHz here). This heats the machine quickly: the CPU temperature here passed 80 °C within about 5 seconds. Stop everything after 20 seconds:

```bash
killall yes
```

### 3. Read your caches

```bash
sysctl hw.cachelinesize hw.perflevel0.l1icachesize hw.perflevel0.l1dcachesize hw.perflevel0.l2cachesize hw.perflevel0.cpusperl2 hw.perflevel1.l1icachesize hw.perflevel1.l1dcachesize hw.perflevel1.l2cachesize hw.perflevel1.cpusperl2
```

Values are in bytes. `cpusperl2` tells you how many cores share each L2. On an M1 you'll see a 12 MB P-cluster L2. On a Pro or Max chip you may see more than one cluster of the same kind.

## Check yourself

Q: Why can't you see "per core" clocks in the app?
A: Cores in a cluster share one clock. macOS sets a frequency per cluster.

Q: One `yes` loop shows as about 25% on each of four P cores. Is it using four cores?
A: No. It's one thread being moved between cores of the cluster several times a second; the total is one core's worth.

Q: What does out-of-order execution buy you?
A: The core keeps doing useful independent work while an instruction waits, often for data from memory.

Q: Why do E cores exist if P cores are faster?
A: For work nobody is waiting on, a smaller, lower-voltage core finishes it for far less energy.

Q: Why does the cluster clock drop when you go from one to four busy P cores?
A: The cluster has a power and thermal budget. Four busy cores at full voltage would exceed it, so the cluster steps down to a lower frequency.

## Go deeper

- [AnandTech, M1 and A14 deep dive (2020)](https://www.anandtech.com/show/16226/apple-silicon-m1-a14-deep-dive/2): the decode width and reorder buffer measurements, still the clearest look inside an Apple P core.
- [Eclectic Light, CPU core frequencies for all Apple silicon Macs (2026)](https://eclecticlight.co/2026/04/13/cpu-core-frequencies-updated-for-all-current-apple-silicon-macs/): the frequency table, M1 to M5.
- [Eclectic Light, Inside M4 chips: CPU core management](https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/): how threads move inside and between clusters.
- [Chips and Cheese, iGPU cache setups compared, including M1](https://chipsandcheese.com/p/igpu-cache-setups-compared-including-m1): measured cache sizes and the 8 MB SLC on M1.
- [Apple newsroom, M5 Pro and M5 Max](https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/): the super core and performance core split.
