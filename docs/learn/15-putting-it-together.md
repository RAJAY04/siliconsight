---
id: 15-putting-it-together
title: Following one click and one keypress through the whole Mac
minutes: 30
focus: overview
live: [cpu.cores, cpu.pFreqMHz, cpu.eFreqMHz, gpu.usage, gpu.freqMHz, memory.appBytes, memory.freeBytes, memory.inactiveBytes, memory.bandwidthGBs, disk.readBps, power.cpuW, power.gpuW, power.systemW, topCpu, topMem]
---
## In plain words

Every part you've met works together on even the smallest action. When you open an app: the filing cabinet (SSD) hands over the app's files, macOS clears room on the Desk (memory), a Fast Worker wakes up and runs at full beat to get the app going, the GPU painters draw the window, and the display shows it. Then everyone rests again. On this Mac, opening Chess took the Fast Workers from idle to their top speed and the chip from under 1 watt to about 8, for about a second.

A single keypress is a smaller version of the same trip: from your finger, through the keyboard's own little processor, into the chip, through the app, to the painters, to the screen, in a few hundredths of a second.

In the app: open something and watch the whole drawing light up in order, then go quiet.

## The idea

This lesson reuses everything. Each step names the lesson that explains it.

### Opening an app

You double-click an app in the Finder. Here's the trip, in order.

1. The click. The trackpad's force sensors cross their threshold and the Taptic Engine taps the glass (lesson 14). On M2 and later laptops a dedicated input coprocessor sends the event to the main chip. WindowServer, the process that owns the screen, works out which window was under the pointer and passes a double-click to the Finder.
2. Asking for the launch. The Finder asks launchd, the parent of every process, to start the app. Launching is user-initiated work, so it runs at high QoS (lesson 3). The scheduler wakes a P core; the P cluster's controller ramps its clock and voltage up over tens of milliseconds (lesson 4).
3. Checking it's safe. Gatekeeper (the `syspolicyd` daemon) checks that a downloaded app is signed and, the first time it opens, that it was notarised by Apple and isn't known malware. That check is why the very first launch of a new download can take a few seconds longer.
4. Loading from the SSD. The app's executable and frameworks are mapped into memory, not copied. Pages are read from the SSD only when they're first touched (lesson 11). Every byte passes through the AES engine on its way to memory. If you launched the app recently, many of its pages are still cached in RAM and nothing is read at all (lesson 8). That's why the second launch is faster.
5. Making room. The new process needs memory. macOS takes free pages first, then reclaims cached pages, then compresses if it must (lesson 8). Shared system frameworks are already in memory for every app, so most of a new app's code costs almost nothing extra.
6. Running. The app's main thread runs at user-interactive QoS on a P core, setting up its window and loading its data. Its helper threads, if any, spread across other cores. Memory traffic rises (lesson 9).
7. Drawing. The app draws its window with Core Animation, which becomes Metal commands for the GPU (lesson 6). WindowServer composites the new window with everything else, also on the GPU, and the display engine scans the finished frame out to the panel.
8. Back to idle. Once the window is up and the app is waiting for input, its threads sleep. The P cluster drops back to its lowest step, the GPU powers down, and the E cores carry the background trickle again (lesson 2). Race to idle (lesson 4).

### Pressing a key

A keypress is shorter but touches as much. The keyboard matrix is scanned by the input coprocessor, which sends a key event to the SoC. macOS turns it into an event for the focused app, which may use dictionary lookups for autocorrect, maybe the Neural Engine for predictive text (Apple doesn't document which hardware it uses), updates its text, and asks for a redraw. Core Animation renders only the changed part of the window, WindowServer composites it, and the next display refresh shows it, within one refresh interval of being ready, about 16.7 ms at 60 Hz (the Air's refresh rate isn't on its spec page; 60 Hz is the usual value for non-ProMotion Mac displays). Most of the time from finger to pixel is waiting for the next refresh.

### Why it feels instant

Every step is designed to wake briefly, do a burst of work and go back to sleep: P cores for short bursts, E cores for the trickle, caches so most data is never fetched from DRAM, cached file pages so most files are never read from the SSD, tile memory so most pixels are never written to DRAM more than once, and power states so idle parts cost almost nothing.

### An analogy

A theatre. The audience member raises a hand (the click). The usher (WindowServer) sees which seat and tells the stage manager (launchd), who calls a lead actor (P core) from the green room. Props are fetched from the store (SSD), unless they're still in the wings from last night (cache). The stagehands (GPU) set the scene, the lighting desk (display engine) brings up the lights, the curtain rises. Then, during a quiet scene, the lead actor goes back to the green room and only the understudies (E cores) are on stage.

## Watch it live

Before you start, look at the quiet state: E cores carrying a little, P cores near zero, the GPU at a low clock or off, SSD particles still, bandwidth a few GB/s, chip power under 1 W.

Then open an app you haven't used today and watch, in roughly this order: SSD read particles, the P tiles lighting and the P clock jumping, app memory growing on the memory map while free or cached shrinks, bandwidth twitching up, a GPU blip as the window appears, and then everything settling back within a second or two. The top processes list shows the new app and `WindowServer`'s work appears only indirectly, since root processes aren't listed.

## Try it

### 1. Watch a launch

Pick an app you haven't opened today. If it's Chess:

```bash
open -a Chess
```

Watch the overview for two seconds, then quit with Command-Q, or:

```bash
osascript -e 'quit app "Chess"'
```

On this Mac, sampled just before and during the launch: the P cluster went from 3257 MHz and almost idle to 4412 MHz with every P core at about 25%, CPU power from 0.7 to 7.8 W, SSD reads from 0 to about 37 MB/s, memory bandwidth from 5.9 to 10.6 GB/s, and free memory fell by half a gigabyte. Within a few seconds it was all back to idle.

### 2. The second launch

Open the same app again straight away, and quit it again. This time the SSD particles hardly move: the app's pages are still in memory as cached files. The CPU still spikes, because the app still has to set itself up.

### 3. Narrate a workload yourself

Do three things in a row, 20 seconds each: scroll a long web page, play a video, then run `yes > /dev/null &` (stop it with `killall yes`). For each, before looking at the app, write down which parts you expect to light up. Then check, and read what the "What's happening" card says. If it disagrees with you, decide which of you is right. The card's rules are simple thresholds in `web/src/story.ts` and can be wrong.

## Check yourself

Q: Why is the second launch of an app faster than the first?
A: Its pages are still in RAM as cached file pages, so the SSD isn't read again.

Q: Which QoS does a user-initiated app launch run at, and what does that mean for the cores?
A: High QoS (user-initiated or user-interactive), so it runs on P cores, which ramp to a high clock.

Q: Which part of a keypress usually takes the longest?
A: Waiting for the next display refresh.

Q: What three things happen to memory when a new app starts?
A: Free pages are used, then cached pages are reclaimed, then compression starts if needed.

## Go deeper

- [Apple, Energy Efficiency Guide for Mac Apps](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/index.html): the design rules behind "wake, burst, sleep".
- [Apple Platform Security, Gatekeeper and runtime protection in macOS](https://support.apple.com/guide/security/sec5599b66df): what's checked before an app runs.
- [Apple developer documentation, Optimize for variable refresh rate displays (WWDC21)](https://developer.apple.com/videos/play/wwdc2021/10147/): how frames are paced to the display.
- [Eclectic Light Company](https://eclecticlight.co): Howard Oakley's long-running series on macOS internals, from launch to logs.
- [How the app works](../how-it-works.md): where every number in this lesson comes from.
