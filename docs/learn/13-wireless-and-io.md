---
id: 13-wireless-and-io
title: Wi-Fi, Bluetooth and the ports
minutes: 25
focus: wifi
live: [net.rxBps, net.txBps, net.iface, disk.readBps, disk.writeBps, power.systemW]
---
## In plain words

Wi-Fi is a radio. Your Mac and your router talk by sending invisible waves back and forth, a bit like two people shouting across a room in a code only they know. The closer and clearer the room, the faster they can talk. Walls, distance and other people shouting (neighbours' Wi-Fi, microwaves) slow it down.

The M5 Air has Apple's own wireless chip, called N1, which handles Wi-Fi 7, Bluetooth 6 and Thread (used by smart-home gadgets). The ports on the side, two Thunderbolt and MagSafe, are wired roads: much faster than the radio, up to 40 gigabits a second.

In the app: rings pulse from the antennas at the hinge and particles flow when data moves over Wi-Fi.

## The idea

### A radio that carries bits

Wi-Fi sends data on radio waves in three bands: 2.4 GHz, 5 GHz and, from Wi-Fi 6E on, 6 GHz. The band is split into channels, and a wider channel carries more data, like a wider pipe. Within a channel, each burst of radio carries bits encoded in the wave's amplitude and phase. The cleaner the signal, the more bits can be packed into each burst: the modulation and coding scheme (MCS) goes up. With poor signal, the radio falls back to a sturdier, slower scheme. That's why your speed drops in the next room without anything being "wrong".

Two numbers tell you how clean the signal is. Signal strength in dBm (decibels relative to a milliwatt) is always negative: -30 is excellent, -60 fine, -80 poor. Noise is the background hiss, usually around -90 to -100. The gap between them, the signal-to-noise ratio, decides the MCS.

The Mac's antennas sit behind the hinge cover strip, and the Mac has two spatial streams (MIMO): two antennas sending two different data streams at once on the same channel, doubling the rate when conditions allow.

### What N1 brings, and what it doesn't

Apple's N1 chip, new in the M5 MacBook Air, provides Wi-Fi 7 (802.11be), Bluetooth 6 and Thread. The firmware string on this Mac literally names it (`N1_b` in `system_profiler`). Apple's deployment guide lists the Air's Wi-Fi limits: 2400 Mbps maximum link rate on 5 and 6 GHz with 160 MHz channels and 2 streams, and 229 Mbps on 2.4 GHz with 20 MHz channels.

Here's what surprised me: the M4 Air, with Wi-Fi 6E, has the same 2400 Mbps, 160 MHz ceiling on 5 and 6 GHz. Wi-Fi 7's headline 320 MHz channels aren't used on this Mac. What Wi-Fi 7 adds here is mostly better behaviour on busy networks and a small gain on 2.4 GHz (229 versus 195 Mbps). The link rate is also not your internet speed: it's the radio's raw rate to the router, before protocol overhead and before your internet connection, which is usually the real limit.

### Ports: Thunderbolt and USB-C

Thunderbolt 4 and USB4 run up to 40 Gb/s over a USB-C connector, and can carry PCIe (for fast external drives), DisplayPort (for monitors) and USB at the same time. On Apple Silicon the Thunderbolt controllers are inside the SoC. The Asahi Linux developers found each port has its own Apple-designed combined PHY that switches between USB, DisplayPort and Thunderbolt signalling.

Every device on those ports reads and writes memory directly (DMA), which could be a security hole. Apple's Platform Security Guide says each DMA agent on Apple Silicon, including each PCIe and Thunderbolt port, has its own IOMMU, a hardware address translator that only lets the device reach memory explicitly mapped for it. A device that tries to read anything else triggers a kernel panic rather than getting the data. Asahi calls Apple's IOMMU the DART.

MagSafe 3 is charging only. The Air can also charge from either Thunderbolt port.

### What the app measures

Network numbers are link-layer byte counters from the busiest physical interface, read once a second. macOS rounds them to 1 KiB for normal processes, so slow traffic moves in steps. The app sees bytes only, never what's in them, which sites they're for, or which app sent them.

### An analogy

Wi-Fi is a conversation across a crowded hall. Two people close together in a quiet hall can talk fast and use long words (high MCS). Move apart or let the hall fill up and they slow down and repeat themselves. Wider channels are a bigger shared language; MIMO is having two conversations at once using two mouths and two ears. A Thunderbolt cable is a private phone line: no crowd, no shouting.

## Watch it live

Find the Wi-Fi particles and the rings at the antennas, near the hinge. Particles flow toward the chip for downloads and away for uploads, on a log scale from 2 KB/s to 100 MB/s. Open a video and watch the incoming stream. On a video call, both directions flow at once.

## Try it

### 1. Look at your link

```bash
system_profiler SPAirPortDataType | awk '/Current Network Information/{f=1} f&&/PHY Mode|Channel|Signal|Transmit Rate|MCS/{print} /Other Local Wi-Fi/{exit}'
system_profiler SPAirPortDataType | grep -m1 "Supported PHY Modes"
```

You'll see your PHY mode (802.11ax is Wi-Fi 6, be is Wi-Fi 7), the channel and its width, signal and noise in dBm, the link rate and MCS. On this Mac, measured twice in one day: -58 dBm gave MCS 5 and 648 Mbps; later, at -26 dBm, MCS 11 and 1200 Mbps, on the same 80 MHz channel. Carry your Mac to another room and run it again.

### 2. Measure your connection (uses some data)

```bash
networkQuality -s -M 10
```

Apple's built-in tester runs upload and download one after the other, capped here at about 10 seconds each way, and prints capacity in Mbps plus "responsiveness", how much delay builds up under load. Watch the Wi-Fi particles swell during each half. Here the results were 50 Mbps up, 25 Mbps down and medium responsiveness, far below the 1200 Mbps link rate. The internet connection, not the radio, was the bottleneck.

### 3. How much has moved

```bash
netstat -ib -I en0 | awk 'NR==2{printf "received %.1f GB, sent %.1f GB since this interface came up\n",$7/1e9,$10/1e9}'
system_profiler SPThunderboltDataType | grep -E "Speed|Device Name" | head -4
```

The first line totals Wi-Fi traffic (`en0` is Wi-Fi on a MacBook Air). The full `netstat` output includes your hardware address, so this version only prints the totals. The second shows each Thunderbolt port's speed: "Up to 40 Gb/s" here.

## Check yourself

Q: Your link rate is 1200 Mbps but downloads run at 25 Mbps. Is your Wi-Fi slow?
A: Probably not. The link rate is to the router; the internet connection is usually the limit.

Q: Why does Wi-Fi get slower in the next room even with full bars?
A: Lower signal-to-noise ratio forces a lower MCS, fewer bits per burst.

Q: What stops a malicious Thunderbolt device reading your kernel's memory?
A: A per-port IOMMU (Apple's DART) only lets it reach memory mapped for it.

Q: Does this Air use Wi-Fi 7's 320 MHz channels?
A: No. Apple lists 160 MHz as its maximum channel width.

## Go deeper

- [Apple, Wi-Fi specification details for Apple devices](https://support.apple.com/guide/deployment/dep268652e6c): link rates, channel widths and streams for every Mac.
- [Apple, Recommended settings for Wi-Fi routers and access points](https://support.apple.com/102766): what Apple asks of your router.
- [Apple Platform Security, DMA protections for Mac](https://support.apple.com/guide/security/seca4960c2b5/web): the per-device IOMMU.
- [Apple newsroom, MacBook Air with M5](https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-macbook-air-with-m5/): the N1 chip announcement.
- `man networkQuality` in Terminal.
