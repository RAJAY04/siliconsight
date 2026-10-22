---
id: 12-battery-and-charging
title: Battery, charging and why your Mac stops at 80%
minutes: 30
focus: battery
live: [battery.percent, battery.charging, battery.acAttached, battery.watts, battery.adapterW, battery.cycleCount, battery.healthPct, battery.timeRemainingMin, battery.chargeHeld, thermal.batteryTempC, power.systemW]
---
## In plain words

The battery is a fuel tank for electricity. This Air's tank holds 53.8 watt-hours: enough to run a 5-watt load for about ten hours.

Batteries wear out slowly, and two things wear them fastest: heat, and sitting completely full for a long time. So when your Mac learns that you usually leave it plugged in, it stops charging at 80% and waits, then tops up to 100% shortly before you normally unplug. That's "Charging On Hold". Nothing is wrong. It's protecting the battery.

A charge cycle is using 100% of the battery's capacity in total, even if it's spread over days: 50% today plus 50% tomorrow is one cycle. Apple designs Air batteries to keep 80% of their capacity after 1000 cycles.

In the app: the four cells fill to your charge level, change colour when charging or held, and the power panel shows watts flowing from the charger, into the Mac and in or out of the battery.

## The idea

### How a lithium-ion cell works

A lithium-ion cell has two electrodes in an electrolyte, with a thin separator between them. Charging pushes lithium ions out of the positive electrode (a metal oxide) and packs them into the negative electrode (graphite). Discharging lets them flow back, and the electrons that travel the other way, through your Mac, are the current. The cell's voltage tells you roughly how full it is: a typical lithium-ion cell sits around 4.2 V when full and around 3 V when empty, with most of its life spent around 3.6 to 3.9 V.

A cell ages in two ways. Calendar ageing happens just by existing, faster when the cell is hot and when it's held at high voltage (full). Cycle ageing happens with use, faster with deep discharges and fast, hot charging. Both slowly use up lithium and thicken the surface layer on the graphite, which permanently reduces capacity.

Battery University's measurements show the effect of heat and full charge clearly. Cells stored for a year at 25 °C kept 96% of their capacity at 40% charge but only 80% at 100% charge. At 40 °C, 85% versus 65%. Lowering the full-charge voltage from 4.20 V to 4.10 V per cell can roughly double cycle life at the cost of about 10% of the energy. These are general lithium-ion figures, not Apple's cells, but they explain every feature below.

### Your Mac's battery

The 13-inch M5 Air has a 53.8 Wh lithium-polymer battery. A gas-gauge chip on the pack (the reader shows a Texas Instruments bq40z651 here) measures voltage, current and temperature continuously and works out the charge level, the remaining capacity and the cycle count. iFixit's M2 Air teardown found four cells in a horseshoe around the trackpad, with the two small centre cells wired in parallel, so the pack behaves electrically like three cells in series. That matches this Mac's pack voltage: about 12.3 V at 80%, or about 4.1 V per cell group.

Apple rates every Apple Silicon MacBook Air for 1000 cycles, designed to retain up to 80% of original capacity at that count. "Maximum capacity" in System Settings, and health in the app, is the current full-charge capacity over the design capacity. A new battery can read slightly above 100%; this one read 100.6% at 25 cycles.

### Charging

Apple says its batteries fast-charge to 80% and then switch to slower trickle charging. That's the standard lithium-ion profile: constant current until the cell nears its voltage limit, then constant voltage while the current tapers off. The last 20% takes disproportionately long. Apple's spec page for the 13-inch M5 Air lists a 40 W adapter as standard, with a 35 W dual-port or 70 W adapter as options; it, can fast-charge with a 70 W or higher USB-C PD adapter, over MagSafe 3 or either Thunderbolt port.

### Holding at 80%

Two features use what the chemistry tells you:

- Optimized Battery Charging (macOS Big Sur and later) learns your routine with on-device machine learning, and when it predicts you'll stay plugged in for a long time, holds at 80% and finishes charging before you usually unplug. The battery menu says "Charging On Hold".
- Charge Limit (macOS Tahoe 26.4 or later, Apple Silicon only) lets you set a fixed ceiling between 80% and 100%. The Mac charges to within a few percent of it, stops, and resumes if the charge falls more than 5% while plugged in. The menu says "Charged to [limit]".

Either way, while held, the Mac runs from the adapter and the battery just sits. "Charge to Full Now" in the battery menu overrides both.

### Watts in and out

Battery power is current times voltage. The gauge reports current with a sign: positive into the battery, negative out of it. On battery, the battery's watts equal what the whole Mac is drawing. On the charger, the adapter supplies the Mac's draw plus whatever goes into the battery, and when the battery is held, the battery's watts are close to zero.

### An analogy

A lithium-ion battery is like a sponge that wears out a little every time you wring it and fill it, and wears faster if you leave it soaked and warm. Keeping it most of the way full, at room temperature, is easy on it. Optimized charging is a careful person who notices you always leave the sponge on the counter overnight, leaves it damp rather than dripping, and soaks it fully just before you usually pick it up.

## Watch it live

Open the battery panel. The cells fill to the charge level. They turn one colour while charging and another when the charge is held: on AC, not charging, below 100%. That's the reader's `chargeHeld`, and it means Optimized Battery Charging or a charge limit is working, not a fault. The panel shows cycle count, health, battery temperature and time remaining, and the power panel draws adapter, Mac and battery as three nodes with energy flowing between them.

Unplug and plug in while you watch. On battery, the battery node feeds the Mac. Plugged in, the adapter feeds both.

## Try it

### 1. Read the battery

```bash
pmset -g batt
system_profiler SPPowerDataType | grep -E "Cycle Count|Condition|Maximum Capacity|State of Charge|Charging|Connected|Wattage"
```

`pmset` gives charge, state and time remaining. On this Mac: "80%; discharging; 8:28 remaining". `system_profiler` adds cycles, condition and maximum capacity, plus the adapter's wattage when one is connected.

### 2. Watts in and out, by hand

```bash
python3 -c 'import subprocess,re;o=subprocess.check_output(["ioreg","-rn","AppleSmartBattery"],text=True);g=lambda k:int(re.search(r"\""+k+r"\" = (\d+)",o).group(1));a=g("Amperage");a=a-2**64 if a>2**63 else a;v=g("Voltage");print(f"{v/1000:.2f} V x {a/1000:.2f} A = {v*a/1e6:.1f} W (negative = out of the battery)")'
```

The gauge stores negative current as a large unsigned number, which the script converts. On this Mac, on battery with several apps and a build running, it printed `12.29 V x -1.24 A = -15.2 W`. Run it a few times while doing different things and compare with the app's battery watts. They come from the same two values.

### 3. Catch a hold (needs a charger; nothing changes)

Plug in when the battery is above 80% and wait a few minutes. If the battery menu says "Charging On Hold" or "Charged to [limit]", `pmset -g batt` should say "AC attached; not charging" and the app's cells should switch to the held colour. I caught exactly this on the test Mac with Apple's 30 W adapter at 80%: `pmset -g batt` said "80%; AC attached; not charging", the reader reported `chargeHeld: true` with battery watts at 0, and the script from experiment 2 printed `12.57 V x 0.00 A = 0.0 W`. The Mac was running entirely from the adapter. To see what the adapter reports about itself:

```bash
pmset -g adapter
```

It lists the rated wattage and the voltage and current it negotiated (20 V at 1.49 A for this 30 W adapter), plus the adapter's name. It also prints a serial number, so don't paste the output anywhere public.

If it charges straight on, Optimized Battery Charging hasn't learned a routine yet, or is off: you can check under System Settings, Battery, the info button next to Charging. Don't change those settings just for this experiment.

## Check yourself

Q: You used 30% of your battery on Monday, 50% on Tuesday and 20% on Wednesday. How many cycles?
A: One.

Q: Why does macOS hold at 80% when it expects you to stay plugged in?
A: Sitting at full charge, especially when warm, ages lithium-ion cells faster.

Q: The app says "held". Is the charger faulty?
A: No. On AC, not charging and below 100% means Optimized Battery Charging or a charge limit.

Q: Why does the last 20% take longer to charge than the first 80%?
A: The charger switches from constant current to constant voltage, and the current tapers as the cell approaches its voltage limit.

Q: The battery reports 12.3 V. Why not about 4 V like a single lithium-ion cell?
A: The pack is several cells (or cell groups) in series; their voltages add.

## Go deeper

- [Apple, About Optimized Battery Charging and Charge Limit on Mac](https://support.apple.com/102338): how both features behave and what the menu says.
- [Apple, Determine battery cycle count for Mac notebooks](https://support.apple.com/102888): 1000 cycles for every Apple Silicon Air, and what a cycle is.
- [Apple, Why lithium-ion](https://www.apple.com/batteries/why-lithium-ion/): fast charge to 80% then trickle, in Apple's words.
- [Battery University, BU-808: How to prolong lithium-based batteries](https://batteryuniversity.com/index.php/learn/article/how_to_prolong_lithium_based_batteries): the tables on heat, charge level and voltage.
- [Apple, Maximizing battery life and lifespan](https://www.apple.com/batteries/maximizing-performance/): the 10 to 35 °C comfort zone and storing at 50%.
