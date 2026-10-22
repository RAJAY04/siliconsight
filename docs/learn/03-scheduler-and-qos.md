---
id: 03-scheduler-and-qos
title: How macOS decides which core runs what
minutes: 30
focus: cpu
live: [cpu.cores, cpu.pFreqMHz, cpu.eFreqMHz, power.cpuW, topCpu]
---
## In plain words

macOS has a manager who hands out jobs to the Fast Workers and the Eco Workers. Every job comes with a label saying how urgent it is. "The person is waiting for this right now" goes to a Fast Worker. "Do this whenever" (indexing files for search, backups, syncing photos) goes to an Eco Worker, and the manager even tells the Eco Workers to take it slow.

The surprising rule: low-priority jobs never get a Fast Worker, even when every Fast Worker is sitting idle. Saving energy wins over finishing early, because nobody is waiting.

You can label a job yourself in Terminal with `taskpolicy -b`, and watch it move to the Eco Workers. Same job, about a tenth of the power.

In the app: watch the small E tiles light up while the big P tiles stay dark.

## The idea

At any moment your Mac has a few thousand threads. Most are asleep, waiting for a timer, a network packet or a keypress. A few dozen want to run. The scheduler, part of the macOS kernel (XNU), decides which of those runs on which core, for how long, and at what clock speed. On a chip with two kinds of core it also has to pick the kind.

It can't read a thread's mind, so it asks the app. That's what quality of service (QoS) is.

### QoS: the app says how much it matters

Every thread and every Grand Central Dispatch queue carries a QoS class. Apple's energy efficiency guide describes four main ones, and the SDK header `sys/qos.h` gives each a number:

| QoS class | Value | What it's for, in Apple's words (paraphrased) | Expected duration |
|---|---|---|---|
| User interactive | 33 | the main thread, animations, responding to input | effectively instant |
| User initiated | 25 | something the user just asked for and is waiting on | a second or so |
| Default | 21 | used when nothing is specified | |
| Utility | 17 | longer jobs the user knows about, like a download or import | seconds to minutes |
| Background | 9 | maintenance the user doesn't see: indexing, backups, sync | minutes to hours |

QoS changes more than CPU priority. Apple says the system uses it to set scheduling priority, CPU and I/O throughput, and timer latency, so a background thread also gets its disk access throttled and its timers coalesced with others to save wake-ups. Apple's guide even suggests apps run at utility or lower about 90% of the time when the user isn't actively interacting with them.

### The rule on two-tier chips

Howard Oakley has spent years measuring this on M1 to M4. His findings, in short:

- Threads at QoS 9 (background) run only on E cores. Even if every P core is idle and the E cores are busy, background threads stay on E cores.
- Threads at higher QoS prefer P cores. They fill P cores first, and only spill onto E cores when the P cores are full.
- When background threads run on the E cores, macOS keeps the E cluster at a low clock. On M4 he saw about 1020 MHz for background work, against the E cores' 2892 MHz maximum. When high-QoS threads spill over onto E cores, the E cluster runs at its top clock instead.
- Threads move between cores within a cluster often, about every 0.1 seconds on M4, and between clusters every few seconds, which spreads heat across the chip.

QoS is a request, not a guarantee. The kernel can promote a background thread that holds a lock a higher-QoS thread needs, so the important work isn't stuck behind it.

This is why Spotlight indexing, Time Machine backups and photo analysis show up as E-core activity. Oakley found Spotlight's processes run at low QoS and almost entirely on E cores. You can see the same thing in the priority column of `ps`: Spotlight's `mdworker_shared` processes run at priority 4, the background band, while a normal command you start runs at 31.

### What about chips with no E cores?

The M5 Pro and M5 Max have super cores and performance cores but no efficiency cores. Oakley's published measurements so far cover the two-tier E/P chips. I couldn't find a primary source on exactly where background threads land on an M5 Pro or Max, so this lesson's E-core rules apply to M1 to M5 base chips (and to M1 to M4 Pro and Max, which do have E cores).

### Forcing it yourself: `taskpolicy`

macOS ships a command, `taskpolicy`, that runs a program with a different policy. `taskpolicy -b` starts it in the Darwin background state, the same treatment the system gives background work: lowest CPU priority, throttled I/O, and on Apple Silicon, E cores only. `taskpolicy -B -p <pid>` lifts a running process back out of it. `taskpolicy -c utility` or `-c background` clamps a program's QoS instead.

### An analogy

The scheduler is an airport gate agent with two kinds of plane: fast jets and slow, cheap turboprops. Every passenger carries a ticket class. First class (user interactive) gets a jet unless every jet is full. Standby passengers (background) only ever board turboprops, even if a jet is sitting empty, because the airline has decided the fuel saving is worth more than their time. And when only standby passengers are flying, the turboprops cruise slowly too.

## Watch it live

Keep the chip panel open with the per-core strips visible. The strip shows the last 60 seconds per core, so you can see work move.

When the Mac is quiet, glance at the E tiles. Small, steady E-core load with idle P cores is background housekeeping. The "What's happening" card says "Background work" when E cores are above 30% while P cores stay under 15%. The top processes list (top CPU) names what's doing it. Processes owned by root, like `kernel_task`, aren't listed, because reading them needs sudo.

## Try it

### 1. Same work, two classes

Start four ordinary `yes` loops (use your P core count if it isn't 4), watch for 15 seconds, and stop them:

```bash
for i in 1 2 3 4; do yes > /dev/null & done
killall yes
```

Now run the same four loops in the background state:

```bash
for i in 1 2 3 4; do taskpolicy -b yes > /dev/null & done
```

Watch for 15 seconds and stop:

```bash
killall yes
```

What I measured on this M5 Air. Normal: all four P cores at 100%, P cluster at about 4060 MHz, CPU power about 18 W. Background: the P cores stayed nearly idle, the six E cores went to about 85% each, the E cluster ran at about 1530 MHz (half its 3048 MHz maximum) and CPU power was about 1.6 W. Same work, same Mac, roughly a tenth of the power. It also took longer per loop, which is the point: nobody was waiting.

### 2. See the priority bands

```bash
yes > /dev/null &
taskpolicy -b yes > /dev/null &
ps -axo pid,pri,comm | grep -E "(yes|mdworker_shared)$"
killall yes
```

You'll see one `yes` at priority 31 and one at 4. If Spotlight is busy, its `mdworker_shared` workers also show 4.

### 3. Make Spotlight work

Create 3000 small text files in a folder Spotlight indexes, watch the E cores, and delete them:

```bash
mkdir -p ~/Documents/macviz-spotlight-test
python3 -c 'import os,random; d=os.path.expanduser("~/Documents/macviz-spotlight-test"); w="cache core memory battery thermal".split(); [open(f"{d}/n{i}.txt","w").write(" ".join(random.choice(w) for _ in range(3000))) for i in range(3000)]'
```

Within a few seconds several `mdworker_shared` processes appear in top CPU, and the load lands on the E tiles while the P tiles stay low. When you're done:

```bash
rm -rf ~/Documents/macviz-spotlight-test
```

## Check yourself

Q: A thread at QoS 9 is ready to run, all P cores are idle and all E cores are busy. Where does it run?
A: It waits for an E core. Background threads don't run on P cores on two-tier chips.

Q: Why did four background `yes` loops use about a tenth of the power of four normal ones?
A: They ran on E cores, which are smaller, and macOS held the E cluster at a low clock and voltage for background work.

Q: Besides CPU placement, what else does QoS change?
A: I/O priority, timer coalescing and latency, and CPU throughput.

Q: How would you un-background a process you started with `taskpolicy -b`?
A: `taskpolicy -B -p <pid>`.

## Go deeper

- [Apple, Energy Efficiency Guide for Mac Apps: prioritize work at the task level](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheTaskLevel.html): the QoS classes and what each changes.
- [Apple developer documentation, DispatchQoS](https://developer.apple.com/documentation/dispatch/dispatchqos): the current API reference.
- [Eclectic Light, Scheduling of threads on M1 series chips](https://eclecticlight.co/2022/01/25/scheduling-of-threads-on-m1-series-chips-second-draft/): the original measurements that established the QoS 9 rule.
- [Eclectic Light, Inside M4 chips: CPU core management](https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/): E-core clocks for background versus spillover work.
- [Eclectic Light, In the background: Spotlight indexing](https://eclecticlight.co/2026/02/10/in-the-background-spotlight-indexing/): which Spotlight processes run where.
- `man taskpolicy` in Terminal: every flag, including the QoS clamp.
