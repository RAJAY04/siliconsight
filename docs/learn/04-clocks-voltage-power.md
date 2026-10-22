---
id: 04-clocks-voltage-power
title: Clocks, voltage and where the watts go
minutes: 30
focus: power
live: [cpu.pFreqMHz, cpu.eFreqMHz, gpu.freqMHz, power.cpuW, power.gpuW, power.aneW, power.dramW, power.systemW, cpu.cores]
---
## In plain words

Every worker works to a beat, the clock. A faster beat gets more done, but to keep up the worker needs more push (voltage), and the energy cost grows much faster than the speed. Working about 3.4 times faster costs about 10 times the energy per worker on this Mac.

So macOS keeps changing the beat, many times a second. When you click something, the Fast Workers sprint, finish, and then everyone rests. That's cheaper than plodding along all day, because just being awake costs energy. Engineers call it race to idle.

In the app: the clock numbers on the chip jump when you do something and fall back when you stop, and the power panel shows how many watts each part is using right now.

## The idea

A chip's clock is the beat everything moves to. At 4 GHz, a P core gets 4 billion beats a second to do work. You'd think the fastest Mac is one that runs every core at full clock all the time. It isn't, and the reason is how power scales.

### Why power rises faster than frequency

Most of a chip's power while it's working goes into charging and discharging tiny capacitances, billions of times a second. The textbook formula for this dynamic power is:

```
power ≈ capacitance × voltage² × frequency
```

Frequency appears once. Voltage appears squared. And you can't raise the frequency without raising the voltage, because transistors switch faster at higher voltage. So every step up in clock costs more than the step before it.

You don't have to take that on faith. macOS keeps a table of frequency and voltage steps for each cluster in the IORegistry, and the reader uses the frequency half to compute cluster clocks. Here is the P cluster table on this M5 MacBook Air, read without sudo (Try it, experiment 1, shows how):

| P cluster step | Core voltage |
|---|---|
| 1308 MHz | 635 mV |
| 2220 MHz | 725 mV |
| 3072 MHz | 825 mV |
| 3720 MHz | 915 mV |
| 4020 MHz | 980 mV |
| 4176 MHz | 1055 mV |
| 4464 MHz | 1070 mV |

That's 7 of the 19 steps. Look at the top end: the last 450 MHz cost 90 mV, the same as the first 900 MHz. Go from the bottom step to the top: frequency rises 3.4 times, voltage rises 1.69 times, voltage squared rises 2.84 times. Multiply: dynamic power per core rises about 9.7 times for 3.4 times the speed. The E cluster here runs from 972 MHz at 680 mV to 3048 MHz at 990 mV, and the GPU from 338 MHz at 640 mV to 1578 MHz at 1025 mV. (The interpretation of these tables as frequency and millivolt pairs comes from the reader's source and Asahi Linux work; Apple doesn't document them.)

There's a second kind of power, leakage: current that trickles through transistors even when they're not switching. It grows with voltage and with temperature. Hot chips leak more, which makes them hotter. That feedback is one reason macOS manages heat so carefully (lesson 5).

### DVFS: picking a step many times a second

Dynamic voltage and frequency scaling (DVFS) means the chip changes its clock and voltage on the fly. On Apple Silicon each CPU cluster and the GPU have their own controllers. A part of macOS Apple calls the Closed Loop Performance Controller (CLPC) watches how busy each cluster is, the QoS of what's running and the thermal budget, and picks a step.

It isn't instant. Chips and Cheese measured an M1 Mac mini taking a little over 100 ms to ramp from idle to its 3.2 GHz top clock, often pausing around 2 GHz on the way, while recent Intel and AMD desktop chips ramp in 5 to 11 ms. Apple trades a little responsiveness in the first tenth of a second for not wasting energy on short spikes.

### Race to idle

If high clocks are expensive, why not run everything slowly? Because idle is even cheaper, and there are fixed costs to being awake. Apple's energy guide puts it bluntly: bringing the CPU and GPU from sleep to a state where they can serve requests costs about ten times the power of sleeping, and every timer that fires wakes them. The cheapest pattern is to do the work in one go, quickly, then let everything power down for as long as possible. Engineers call it race to idle.

The balance between "race" and "slow and steady" is exactly what QoS tells the system. User-interactive work races on a P core at a high clock because you're waiting. Background work strolls on an E core at a low clock because you aren't. Both finish, and both end idle.

### Watts per block

The power panel shows CPU, GPU and ANE watts from Apple's CLPC energy counters, and "system" watts from the SMC: the whole machine, including the display. The gap is labelled "rest of system": display backlight, wireless, SSD, memory, and the loss in converting battery voltage to the chip's voltages. DRAM power reads 0 on macOS 27 and shows "n/a".

### An analogy

A car engine at high revs. Doubling the speed of a car more than doubles the fuel per hour, because drag grows faster than speed. A sensible driver accelerates firmly to get onto the motorway and then lifts off, rather than crawling in first gear for twice as long, and switches the engine off at the lights. Voltage is the extra fuel richness you need to rev higher. Leakage is the engine idling while you're parked.

## Watch it live

Open the chip panel and the power panel side by side. The P and E clocks are averages over the last second, weighted by how long each cluster spent at each step, so you'll often see values between the table entries. An idle cluster reports its lowest step, never 0. A GPU that's switched off does report 0 MHz, because it really is off.

Watch the power split while you scroll a long web page. Each scroll is a short race: P cluster up, GPU up, then back down within a fraction of a second.

## Try it

### 1. Read your own frequency and voltage table

This decodes the tables from IORegistry. No sudo, nothing changes.

```bash
ioreg -rn pmgr -w0 -l | python3 -c '
import sys,re,struct
d=dict(re.findall(r"\"(voltage-states(?:1|5|9)(?:-sram)?)\" = <([0-9a-f]+)>", sys.stdin.read()))
P=lambda h:[struct.unpack_from("<II",bytes.fromhex(h),i) for i in range(0,len(h)//2-7,8)]
for k,name in (("1","E cluster"),("5","P cluster"),("9","GPU")):
  if "voltage-states"+k+"-sram" not in d: continue
  f=[round(a/(1e3 if a<1e8 else 1e6)) for a,_ in P(d["voltage-states"+k+"-sram"])]
  v=[b for _,b in P(d["voltage-states"+k])]
  print(name, " ".join(f"{a}MHz@{b}mV" for a,b in zip(f,v) if a))'
```

It prints each step as frequency and core voltage. The key numbers (1 for the E cluster, 5 for the P cluster, 9 for the GPU) are what this M5 uses. On other chips the numbering can differ: if a line is missing or looks wrong, your chip stores its clusters under other keys, and the reader finds them through the `acc-clusters` key instead. The frequencies are stored in kHz on M4 and M5 and in Hz on M1 to M3; the script converts both.

### 2. Watts per thread

Run 1, then 2, then 4 `yes` loops for 15 seconds each, writing down P clock and CPU watts each time:

```bash
yes > /dev/null &
killall yes
for i in 1 2; do yes > /dev/null & done
killall yes
for i in 1 2 3 4; do yes > /dev/null & done
killall yes
```

On this M5 Air I got about 9.5 W at 4464 MHz for one thread, 10.3 W at 4290 MHz for two, and 18 W at 4060 MHz for four. Per thread that's 9.5, 5.1 and 4.6 W. The first thread is the most expensive because it pays for waking the cluster and runs at the top, highest-voltage step. Your numbers will vary second to second; the shape is what matters. Four loops warm the machine.

### 3. Background versus foreground watts

Repeat the four-loop run with `taskpolicy -b yes > /dev/null &` four times, then `killall yes`. Compare the CPU watts: about 1.6 W here, against 18 W.

## Check yourself

Q: Why does power rise faster than clock speed?
A: Higher clocks need higher voltage, and dynamic power scales with voltage squared times frequency.

Q: On this Mac, the P cluster's top step is 3.4 times the bottom step's frequency. Roughly how much more dynamic power per core does it cost?
A: About 9.7 times (3.4 × (1070/635)²).

Q: What is race to idle?
A: Doing work quickly and then letting the hardware drop into deep idle, because being awake has a fixed cost.

Q: What does "rest of system" in the power panel include?
A: Everything the SMC's whole-machine reading counts that isn't CPU, GPU or ANE: display, wireless, SSD, memory, and power conversion losses.

## Go deeper

- [Apple, Energy Efficiency Guide for Mac Apps: fundamental concepts](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/FundamentalConcepts.html): fixed and dynamic cost, and why idle matters.
- [Chips and Cheese, clock ramp on Alder Lake, Zen 4, M1 and more](https://chipsandcheese.com/p/addendum-clock-ramp-on-adl-zen-4-m1-and-more): measured ramp times.
- [Eclectic Light, Making the most of Apple silicon power: frequency](https://eclecticlight.co/2022/10/17/making-the-most-of-apple-silicon-power-4-frequency/): how cluster frequency follows load.
- [Linux kernel binding for the Apple cluster cpufreq controller](https://kernel.org/doc/Documentation/devicetree/bindings/cpufreq/apple%2Ccluster-cpufreq.yaml): per-cluster DVFS hardware, as documented by the people who drive it.
- [macmon](https://github.com/vladkens/macmon): the sudoless tool whose counter table the reader uses for CPU, GPU and ANE watts.
