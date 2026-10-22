---
id: 08-unified-memory
title: Unified memory, the compressor and memory pressure
minutes: 35
focus: memory
live: [memory.totalBytes, memory.wiredBytes, memory.appBytes, memory.activeBytes, memory.inactiveBytes, memory.compressedBytes, memory.freeBytes, memory.swapUsedBytes, memory.pressure, topMem]
---
## In plain words

Memory (RAM) is Desk Space. Everything the Mac is working on right now has to be on the desk: open apps, documents, browser tabs. This Mac has 16 GB of Desk Space, shared by every worker.

macOS keeps the desk full on purpose, with copies of files you might need again, because an empty desk does nothing for you. Those copies can be swept off instantly. So "memory used" being high is fine.

When the desk really runs out, macOS first folds older papers into tight bundles to save room (compression). If that's not enough, it moves bundles into Overflow Storage on the SSD (swap). Overflow Storage works, but fetching things back from it is slow.

The number that matters is memory pressure: green means the desk is coping, red means it's struggling.

In the app: the block map is your desk, coloured by what's on it.

## The idea

Your Mac's memory is one pool of LPDDR DRAM in the chip package: 16 GB on this Air, between 8 GB and 512 GB across the Apple Silicon range. The CPU, GPU, Neural Engine and media engines all use the same pool (lesson 1). This lesson is about how macOS divides it up, why "memory used" is the wrong number to worry about, and what happens when it runs short.

### Pages

macOS manages memory in pages. On Apple Silicon a page is 16 KB (`sysctl hw.pagesize` says 16384), four times the 4 KB page of Intel Macs. Every process sees its own private map of virtual addresses, and the kernel decides which of those addresses are backed by a real page of RAM right now, which are compressed, which are on the SSD, and which haven't been touched yet.

### The five kinds the app shows

The memory panel splits RAM into a block map. Each block is a fixed slice of your RAM, coloured by what it holds:

- Wired: memory the kernel and drivers need that can never be paged out or compressed. Kernel data structures, and memory a driver has pinned for hardware to use directly. GPU buffers that are in use get wired too: when you run the GPU lab in lesson 9, watch wired memory rise by a couple of gigabytes.
- App: memory that apps have allocated for themselves (anonymous memory, the heap and stacks), minus purgeable memory they've offered back. This is roughly what Activity Monitor calls App Memory. The app paints the biggest processes onto this region by their memory footprint.
- Compressed: memory the compressor has squeezed. The block shows the space the compressed data occupies, not its original size.
- Cached: pages macOS can drop or reuse at any moment, mostly copies of files that were read recently. Apple calls these Cached Files. If an app reads the same file again, it comes from here instead of the SSD.
- Free: pages holding nothing at all.

Apple's Activity Monitor help adds one more definition worth knowing: memory pressure is determined by the amount of free memory, the swap rate, wired memory and file-cached memory together. It's not a percentage of RAM used.

### Why a full Mac is a healthy Mac

Free memory does nothing for you. macOS deliberately fills spare RAM with cached file data, because a cached read is thousands of times faster than going to the SSD, and cached pages can be thrown away the instant an app needs room. So a Mac that's been on for a day typically shows very little free memory. That's working as designed.

The `memory_pressure` command makes this visible. On this Mac it reported "System-wide memory free percentage: 75%" at a moment when only 4.5 GB of 16 GB, 28%, was literally free. The kernel counts cached and other easily reclaimed pages as available.

### When memory runs short: compress, then swap

When an app needs memory and there are no free pages, macOS first takes cached pages. Then it starts on pages apps haven't touched recently. Since OS X Mavericks in 2013, instead of writing those to disk straight away it compresses them in RAM. Apple said then that compressed pages take about half their original space and that compressing and decompressing is faster than swapping to disk. The XNU kernel source shows two algorithms, WKdm, which is tuned for the kinds of data typical in memory, and LZ4, with the kernel switching between them based on how well each is doing.

How well a page compresses depends on what's in it. A page of zeros or repeated values shrinks to almost nothing. Random or already-compressed data (JPEGs, video, encrypted data) barely shrinks, and the compressor gives up on it.

Only when compression isn't enough does macOS write pages to swap files on the SSD, in `/System/Volumes/VM`. On Apple Silicon Macs swap is encrypted (`sysctl vm.swapusage` says "(encrypted)"). Swap is slow compared with RAM and it wears the SSD a little (lesson 11), but a small, steady amount of swap is normal: macOS swaps out pages nobody has touched for hours even when memory is comfortable. Swap that keeps growing while you work is the warning sign.

### Memory pressure

The pressure level the app shows comes from `kern.memorystatus_vm_pressure_level`: normal, warn or critical. That's the same signal behind Activity Monitor's green, yellow and red graph. At warn, macOS is compressing hard and asking apps to release caches. At critical it may start quitting idle apps or show the "Your system has run out of application memory" dialog.

So the question "is my Mac short of memory?" is answered by pressure and by swap growth, never by how much is "used".

### An analogy

A desk in a busy office. Wired memory is the stuff bolted to the desk. App memory is the papers people are working on. Cached is a stack of photocopies of reference documents: handy, but you can shred them any time because the originals are in the filing room (the SSD). When the desk fills up, you first shred photocopies. Then you start folding old papers into tight bundles at the corner of the desk (the compressor). Only when that's not enough do you carry bundles down to the filing room (swap), which takes time every time someone needs one back.

## Watch it live

Open the memory panel. The block map is the whole 16 GB (or your size); the colours are the five kinds above, with your largest processes painted on the app region. Beside it are swap used and the pressure level. The "Memory" label on the overview is total minus free minus cached, closer to "in use" than any other single number.

Leave the panel open and launch a big app, or open twenty browser tabs. Watch free drop first, then cached shrink, then compressed grow. Close them and watch app memory fall. Cached usually stays: macOS keeps the file data until something needs the room.

## Try it

### 1. Read the raw numbers

```bash
sysctl hw.pagesize vm.swapusage kern.memorystatus_vm_pressure_level
vm_stat | head -20
memory_pressure | tail -1
ls -lh /System/Volumes/VM
```

`vm_stat` counts pages (16 KB each here). "Pages stored in compressor" is the original size of what's compressed; "Pages occupied by compressor" is the space it takes. Divide one by the other for your compression ratio. On this Mac it was about 8 GB stored in about 3.9 GB, roughly 2 to 1, which matches Apple's 2013 "about half" claim nicely. The pressure level prints 1 for normal, 2 for warn and 4 for critical. The `ls` shows the swap files, 1 GB each here.

### 2. Fill memory and watch the compressor

Pick about a quarter of your RAM. This command holds 4 GB of a single repeated byte (`4<<30` is 4 GiB; use `2<<30` on an 8 GB Mac):

```bash
python3 -c 'b=b"x"*(4<<30); input("Holding 4 GB. Press Return to free it.")'
```

Watch the memory panel. On this Mac, app memory jumped from 3.4 to 7.3 GB and free memory went from 4.4 GB to 0.3 GB. Over the next half minute macOS started compressing the idle pages: in a second Terminal window,

```bash
top -l 1 -o mem -n 5 -stats pid,command,mem,cmprs
```

showed the Python process at about 4.1 GB with about 370 MB of it already in the compressor, and rising. (`cmprs` is the process's compressed memory; Activity Monitor's Compressed Memory column shows the same thing.) Press Return and it all comes back within a second. If your Mac has lots of free memory, nothing gets compressed, which is also a result: the compressor only works when it has to.

### 3. Now try data that doesn't compress

```bash
python3 -c 'import os; b=os.urandom(2<<30); input("Holding 2 GB of random bytes. Press Return to free it.")'
```

Random bytes don't compress. In my run the compressed column for this process stayed at 0 while the repeated-byte version had hundreds of megabytes compressed. Under real pressure, data like this goes to swap instead, and you'd see swap used grow. Press Return to free it. Neither experiment harms anything; if your Mac gets sluggish, press Return or Ctrl-C.

## Check yourself

Q: Your Mac shows 200 MB free out of 16 GB. Is that a problem?
A: Not by itself. Check memory pressure and whether swap is growing. Low free memory usually just means a big file cache.

Q: Why does a page of zeros cost almost nothing once compressed, while a page of a JPEG doesn't shrink?
A: Compression removes repetition; JPEG data is already compressed and looks random.

Q: What's the difference between "pages stored in compressor" and "pages occupied by compressor"?
A: Stored is the original size of the compressed pages; occupied is the RAM the compressed data takes.

Q: What can never be compressed or swapped?
A: Wired memory.

Q: Where do swap files live and are they encrypted?
A: In `/System/Volumes/VM`, and yes, `vm.swapusage` reports them as encrypted.

## Go deeper

- [Apple, View memory usage in Activity Monitor](https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac): the official definitions of each category and of memory pressure.
- [Eclectic Light, Memory Lane: grokking memory problems in Activity Monitor](https://eclecticlight.co/2022/01/19/memory-lane-grokking-memory-problems-in-activity-monitor/): how to read the memory tab without panicking.
- [XNU source, vm_compressor_algorithms.c](https://opensource.apple.com/source/xnu/xnu-6153.61.1/osfmk/vm/vm_compressor_algorithms.c.auto.html): the compressor's WKdm and LZ4 selection, in Apple's own code.
- [Apple newsroom, OS X Mavericks (2013)](https://www.apple.com/newsroom/2013/10/23OS-X-Mavericks-Available-Today-Free-from-the-Mac-App-Store/): where compressed memory was introduced.
- `man vm_stat` and `man memory_pressure` in Terminal.
