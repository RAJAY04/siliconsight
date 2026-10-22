---
id: 16-capstone-experiments
title: Capstone experiments
minutes: 40
focus: overview
live: [cpu.cores, cpu.pFreqMHz, cpu.eFreqMHz, power.cpuW, power.gpuW, power.aneW, power.systemW, memory.bandwidthGBs, memory.appBytes, memory.compressedBytes, memory.pressure, memory.swapUsedBytes, thermal.state, thermal.cpuTempC, battery.watts, battery.percent, disk.writeBps]
---
## In plain words

Now you get to be the scientist. Each experiment below mixes several things you've learned. Before you run each one, write down what you think will happen: which workers wake up, how full the Desk gets, whether the Highway fills, how warm the case gets. Then run it and see. Being wrong is the useful part.

The big one: is it cheaper to finish a job fast with a Fast Worker, or slowly with an Eco Worker? The answer turns out to be "it depends what else is switched on", and you can measure why.

## The idea

Every experiment here follows the same method:

1. Write down a prediction: which parts light up, roughly how many watts, how long.
2. Run it with the app open.
3. Compare. Where you were wrong, find the lesson that explains it.
4. Clean up with the command given.

Several of these heat the machine and use battery. Run them on a hard surface, and plug in for experiment 4 only if it asks you to.

### Energy is power times time

Lesson 4 said high clocks cost far more power, and lesson 3 showed background work using a tenth of the power. But a job's energy is power multiplied by time, and the slow version takes longer. Which wins depends on what you count. Count only the CPU, and the slow, low-voltage version usually wins. Count the whole Mac, display and radio included, and the fast version often wins, because finishing sooner lets everything else go idle sooner. This is race to idle in numbers, and experiment 1 measures it.

## Watch it live

Keep the overview open with the power panel visible for all of these. You need CPU watts, system watts and the per-core strips most of the time; the memory panel for experiment 2; the chip panel's temperatures for experiment 3.

## Try it

### 1. The energy race: P cores against E cores (warms the machine slightly)

The same fixed job, a Python loop that adds up 600 million numbers, run normally and then in the background state:

```bash
/usr/bin/time -p python3 -c "sum(range(600_000_000))"
/usr/bin/time -p taskpolicy -b python3 -c "sum(range(600_000_000))"
```

Each prints `real`, the wall-clock seconds. While each runs, note CPU watts and system watts in the power panel, and note them once at idle too.

My results on this M5 Air:

| | Time | CPU watts | CPU watts above idle | CPU energy above idle |
|---|---|---|---|---|
| Idle | | about 0.55 W | | |
| Normal (P core, 4464 MHz) | 4.3 s | about 9.3 W | about 8.8 W | about 38 J |
| Background (E core, low clock) | 20.1 s | about 1.1 W | about 0.55 W | about 11 J |

So counting the CPU alone, the background run used roughly a third of the energy, and took almost five times as long. Now add the rest of the Mac. "Rest of system" was about 5 W here with the screen on. Keeping that awake for an extra 16 seconds costs about 80 J, far more than the 27 J the E core saved. If the screen is going to be on anyway because you're using the Mac, that cost is paid regardless, and background still wins for the CPU. If the Mac could have gone to sleep, finishing fast wins.

Two cautions. The background readings are small and noisy: in my samples CPU watts during the background run ranged from 0.7 to 1.5 W, so the energy could be anywhere from about 4 to 20 J. Repeat each run three times. And other apps change the baseline from second to second.

### 2. The memory squeeze (uses about 6 GB of memory and battery)

Combine lessons 8, 9 and 10. In one Terminal window, hold about a quarter of your RAM:

```bash
python3 -c 'b=b"x"*(4<<30); input("Holding 4 GB. Press Return to free it.")'
```

In a second window, from the repository root, run the GPU bandwidth lab, which wires another 2 GB:

```bash
swift docs/learn/lab/bandwidth.swift gpu 30
```

Predict first: does bandwidth drop when memory is tight? Does pressure change? Does swap move? Then watch the memory map, pressure and swap, and the bandwidth figure. On a 16 GB Mac with a browser open, expect free memory to vanish, the compressor to grow and pressure to stay normal or go to warn. What I saw on this 16 GB Mac: wired memory rose from 3.7 to 6.3 GB, compressed from 1.9 to 2.5 GB, free fell to 0.1 GB, pressure stayed normal and swap didn't move. The lab reported 103 to 110 GB/s, against about 125 GB/s with memory comfortable. Full memory doesn't shrink the channels, but the compressor was busy squeezing pages at the same time, and its reading and writing shares the same Highway. That's my best explanation for the drop; I didn't isolate it. Press Return in the first window and let the lab finish (or Ctrl-C) to clean up.

On an 8 GB Mac, use `2<<30` in the first command and `swift docs/learn/lab/bandwidth.swift gpu 30 512` in the second.

### 3. Where does the heat go first? (heats the machine)

Start one loop per core:

```bash
for i in $(seq $(sysctl -n hw.ncpu)); do yes > /dev/null & done
```

Every 30 seconds for three minutes, write down the P clock, the E clock, CPU watts, CPU temperature and the thermal state, and touch the keyboard deck above the function keys and the palm rest. Predict before starting: which cluster slows down first? When does the palm rest get warm? Stop with:

```bash
killall yes
```

Compare with the table in lesson 5. In my run, the P cluster lost half its clock in three minutes while the E cluster stayed at full speed for over two.

### 4. Make your own battery estimate (needs to run on battery)

Unplug. For one minute of each, note the system watts: idle with the screen on, scrolling a web page, a video call or video, and the experiment 1 loop. Then compute how long your battery would last at each:

```bash
python3 -c 'wh=53.8; [print(f"{w:5.1f} W -> {wh/w:5.1f} hours") for w in (4, 7, 12, 20)]'
```

Replace `53.8` with your battery's watt-hours from Apple's tech specs, and the list with your measured watts. Compare your idle figure with Apple's battery-life claim (up to 18 hours of video on the 13-inch M5 Air) and with what `pmset -g batt` predicts. Apple's video test runs at a set brightness; yours probably doesn't.

### 5. Name that workload

Ask someone else to run one of these while you look only at the app, not their screen: a `yes` loop, the bandwidth lab, the Neural Engine lab (`swift docs/learn/lab/ane.swift 30`), a `dd` write to `/tmp`, the Spotlight test from lesson 3, or opening Photo Booth. Work out which it was from the parts that light up. Then swap. If you can identify all six, you've learned the course. Clean up anything they started: `killall yes`, `rm -f /tmp/macviz-ssd-test.bin`, `rm -rf ~/Documents/macviz-spotlight-test`, and quit Photo Booth.

## Check yourself

Q: The background run used about a third of the CPU energy. Why might the fast run still be better for battery life?
A: The rest of the Mac stays awake for the whole run, and that cost grows with time; finishing fast lets everything idle sooner.

Q: In the memory squeeze, why doesn't bandwidth collapse just because memory is full?
A: Bandwidth is set by the memory channels, not by how full memory is. It can dip if the compressor is busy at the same time, since that traffic shares the channels, and it collapses only when pages have to come from swap.

Q: Which experiment would make the ANE block glow, and which would only fill the Highway?
A: The Neural Engine lab lights the ANE; the bandwidth lab fills the Highway with the GPU waiting.

Q: Your Mac draws 7 W browsing. Roughly how long will a 53.8 Wh battery last?
A: About 7.7 hours.

## Go deeper

- [Apple, Energy Efficiency Guide for Mac Apps: fundamental concepts](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/FundamentalConcepts.html): fixed costs and race to idle.
- [Apple, MacBook Air 13-inch M5 tech specs](https://support.apple.com/126320): battery capacity and Apple's battery-life test conditions.
- [Eclectic Light, Making the most of Apple silicon power](https://eclecticlight.co/2022/10/13/making-the-most-of-apple-silicon-power-3-controls/): Oakley's series on power and core control.
- [How the app works](../how-it-works.md): what the "What's happening" card looks for.
