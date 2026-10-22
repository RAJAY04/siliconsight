---
id: 05-heat-and-throttling
title: Heat in a fanless Mac
minutes: 25
focus: thermal
live: [thermal.state, thermal.cpuTempC, thermal.gpuTempC, thermal.batteryTempC, cpu.pFreqMHz, cpu.eFreqMHz, power.cpuW, power.systemW, fans, hardware.fanCount]
---
## In plain words

Every bit of energy the chip uses turns into heat. Most Macs have fans to blow it away. The MacBook Air has no fan at all: the heat soaks into the metal case and drifts off into the room.

The case can soak up a short burst of heat easily, so quick jobs run at full speed. On a long, heavy job the case fills up with heat like a sponge fills with water. Then macOS slows the Fast Workers down to make less heat. That's called throttling. It's normal, and it's how the Mac protects itself.

In the app: a warm glow spreads from the chip into the case as it heats up, and the thermal state (nominal, fair, serious, critical) tells you how hard macOS is working to keep cool.

## The idea

Every watt the chip uses ends up as heat. All of it. A CPU drawing 15 W is a 15 W heater the size of a fingernail, and the heat has to go somewhere before the silicon gets hot enough to misbehave.

A MacBook Pro, Mac mini or Mac Studio has fans: they push air over a heatsink and out of the case, and the faster they spin the more heat they remove. A MacBook Air has none. iFixit's teardown of the M2 Air, the chassis the M5 Air still uses, found a thin shield over the chip with graphite tape and a thermal pad, and no heatsink, heat pipe or vapour chamber. Heat flows from the die, through the package, into the shield and then into the aluminium top case, which spreads it over a large area and gives it to the air by plain convection and radiation. The keyboard deck and the area above the hinge get warm. That warm aluminium is the cooling system.

### Why that works, and where it runs out

Aluminium conducts heat well and has a lot of thermal mass. A cold Air can absorb a burst of 15 to 20 W for a while just by warming up, like a cold pan you drop an ice cube into. That's why short tasks run at full speed on an Air: the case is a heat sponge.

But a sponge fills. The case can only lose heat to the room at a rate set by its area and how much hotter it is than the air around it. For a sustained load that rate, a handful of watts in steady state, is the real limit. When the chip produces more heat than the case can lose, temperature rises until macOS steps in.

### What macOS does about it

macOS watches dozens of temperature sensors and has a power budget for each cluster and for the whole system. When temperatures approach their limits it lowers that budget, and the clock and voltage come down with it (lesson 4). Because power falls faster than clock, a modest clock cut buys a big drop in heat. This is throttling. It's gradual and it's normal: the machine is protecting itself, not failing.

macOS also publishes a coarse summary for apps, the thermal state, which the app shows directly. Apple defines four levels:

- nominal: no action needed
- fair: slightly elevated; on Macs with fans, the fans may be audible; apps may start trimming optional work
- serious: high; performance is affected; apps should cut CPU, GPU, I/O, frame rates and visual effects
- critical: the system needs to cool down

Note what's missing: a temperature. The state is a decision about how hard the system is working to stay cool, not a reading. On a fanless Air you can see "fair" at a lower chip temperature than you expect, because the system has already started cutting power to hold the temperature where it wants it.

### What I measured

On this M5 MacBook Air, on battery with the lid open (room temperature not measured), I started 10 `yes` loops (every core busy) and logged every 15 seconds for 3 minutes:

| Time | P clock | E clock | CPU power | CPU temp | Thermal state |
|---|---|---|---|---|---|
| 0 s | 4464 MHz | 3042 MHz | 14.8 W | 58 °C | nominal |
| 15 s | 4210 MHz | 3048 MHz | 15.4 W | 85 °C | nominal |
| 30 s | 3941 MHz | 3048 MHz | 12.3 W | 93 °C | nominal |
| 75 s | 3717 MHz | 3048 MHz | 10.1 W | 91 °C | fair |
| 120 s | 3448 MHz | 3048 MHz | 8.5 W | 87 °C | fair |
| 150 s | 3141 MHz | 3048 MHz | 6.8 W | 79 °C | fair |
| 180 s | 2050 MHz | 2471 MHz | 4.8 W | 74 °C | fair |

Three things stand out. The die went from 58 to 93 °C in 30 seconds, which tells you how small and concentrated the heat source is. macOS then held the die near 92 °C and walked the P cluster's power down to keep it there, leaving the E cluster at full clock for over two minutes, which makes sense because E cores give far more work per watt. And by three minutes the P cluster was at 46% of its top clock and the chip was drawing a third of the power it started with. Thirty seconds after stopping, the CPU was back to 55 °C, but the thermal state still said "fair": the case was still warm.

Treat these as one run on one machine, not a spec: other apps were running, and a cooler room, a hard desk versus a lap, or being plugged in will change them.

### Where else heat matters

The battery is the part that minds heat the most. Apple's guidance is to keep Mac laptops between 10 and 35 °C ambient, and Battery University's measurements show lithium-ion cells losing capacity much faster when kept warm. The app shows battery temperature separately; on an Air it's usually close to room temperature plus a few degrees, because the cells sit away from the chip.

### An analogy

A fanless Air is like cooking on a cast-iron pan on a small burner. Drop in a cold steak and the pan's stored heat sears it instantly. Keep adding steaks and the pan cools to whatever temperature the burner can sustain. A Mac with fans has a bigger burner. In this kitchen the pan is the case and the burner is how fast the case can shed heat. The chip is the steak, except it's making the heat, not taking it.

## Watch it live

The overview shows heat as a warm glow spreading from the chip into the shield, the case and the top case. Its strength follows CPU temperature from 45 °C (no glow) to 95 °C (full). If the SMC can't be read, it follows the thermal state instead. The chip panel lists CPU and GPU temperatures (averages of the SMC's CPU and GPU sensors) and the thermal state.

On a MacBook Pro or Mac mini, the scene draws the fans the SMC reports and shows their speed. On an Air, there's nothing to draw, which is the honest picture.

## Try it

### 1. The heat soak (heats the machine, uses battery)

Put the Mac on a hard surface. Start one `yes` per core:

```bash
for i in $(seq $(sysctl -n hw.ncpu)); do yes > /dev/null & done
```

Watch the chip panel for three to five minutes. Expect the P clock to start at its top step and fall steadily while the CPU temperature climbs fast, plateaus, and then eases as power is cut. The thermal state may change to "fair". Touch the keyboard deck above the function keys: that's where the heat is going. Stop:

```bash
killall yes
```

### 2. Ask macOS directly

```bash
pmset -g therm
```

On this Mac it says "No thermal warning level has been recorded" even after the soak, because `pmset` reports only formal thermal and performance warnings, which a fair state doesn't raise. The app's state comes from `ProcessInfo.thermalState`, a different, finer signal. Comparing the two is a good lesson in how many layers of "too hot" there are.

### 3. Short burst versus long haul

Run the same command for just 10 seconds, wait two minutes, and repeat. Each short burst runs at full clock because the case starts cool. That's the heat sponge at work, and it's why an Air feels as fast as a Pro for anything that finishes in under half a minute.

## Check yourself

Q: Where does the heat from the chip go in a MacBook Air?
A: Through a thermal pad and thin shield into the aluminium top case, and from there into the room. No fan, heat pipe or heatsink.

Q: Why does a short task run at full speed on an Air even though long ones throttle?
A: The case absorbs heat for a while before it warms up; only sustained loads hit the limit of how fast it can shed heat.

Q: Is the thermal state a temperature?
A: No. It's macOS's summary of how hard it's working to stay within limits.

Q: In the measured run, why were the E cores left at full clock while the P cluster was slowed?
A: E cores do more work per watt, so cutting the P cluster removes the most heat for the least lost work.

## Go deeper

- [Apple documentation, ProcessInfo.ThermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum): the four states and what apps should do in each.
- [Apple, Energy Efficiency Guide: respond to thermal state changes](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/RespondToThermalStateChanges.html): the older, more detailed guidance.
- [iFixit, M2 MacBook Air teardown](https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink): photographs of the shield-only cooling.
- [Notebookcheck, MacBook Air 13 M4 review](https://www.notebookcheck.net/The-passively-cooled-M4-SoC-makes-the-competition-look-old-Apple-MacBook-Air-13-M4-entry-review.1002534.0.html): sustained-load comparisons with the fan-cooled Mac mini.
- [Apple, battery temperature guidance](https://www.apple.com/batteries/maximizing-performance/): the 10 to 35 °C comfort zone for Mac laptops.
