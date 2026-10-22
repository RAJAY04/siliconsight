---
id: 11-storage-and-encryption
title: The SSD, encryption at rest and why swap touches storage
minutes: 30
focus: ssd
live: [disk.readBps, disk.writeBps, memory.swapUsedBytes, memory.pressure, power.systemW]
---
## In plain words

The SSD is your Mac's filing cabinet. Unlike the Desk (memory), it keeps everything when the power is off. It's made of flash memory chips, and it's far bigger than the Desk but much slower to reach.

The clever bit on Apple Silicon is that the cabinet's manager, the SSD controller, lives inside the main chip, right next to the security guard (the Secure Enclave) who holds the keys. Everything is locked (encrypted) on its way into the cabinet and unlocked on the way out, automatically, so a stolen flash chip on its own is useless.

When the Desk overflows, macOS uses part of the cabinet as Overflow Storage (swap). That works, but it's slow, and every write wears the flash a tiny bit. A little is fine. Lots, all day, means the Mac needs more Desk Space.

In the app: particles between the flash chips and the processor show reads (toward the chip) and writes (away from it).

## The idea

### Flash memory

An SSD stores bits as electric charge trapped in NAND flash cells. A cell can be read quickly and written once, but can't be overwritten in place: flash is erased in large blocks, then written in smaller pages. Each erase-and-write cycle wears the cell slightly, and after enough cycles it stops holding charge reliably.

So every SSD has a controller running a flash translation layer. It maps the addresses the operating system asks for onto wherever the data physically lives, spreads writes evenly across all cells (wear levelling), moves still-valid data out of blocks before erasing them (garbage collection), and keeps spare blocks in reserve. TRIM (supported here, per `system_profiler`) lets macOS tell the controller which blocks hold deleted data, so it doesn't waste effort preserving them.

### The controller is in the SoC

On a PC, an NVMe SSD is a complete device: flash chips plus their own controller on a stick. Apple moved the controller into its own chips, first the T2 security chip in late Intel Macs and then every Apple Silicon SoC. The flash packages on the logic board (or on the removable modules in a Mac Studio) are raw flash without a controller. TidBITS explained it in 2022 when people tried to swap Mac Studio modules: they aren't standard SSDs, and the data on them is tied to the chip they were paired with. The Asahi Linux developers name the storage coprocessor ANS. On this Mac, `diskutil` even reports the protocol as "Apple Fabric" rather than NVMe.

The M5 Air's spec page says its SSD is twice as fast as the previous generation's for reads and writes, without giving a figure. In the experiment below I saw about 6 GB/s of writes reaching the SSD for a second.

### Encryption at rest, always

Apple's Platform Security Guide is clear about how this works on Apple Silicon:

- A dedicated AES-256 engine sits on the path between flash storage and memory, so data is encrypted and decrypted as it moves, at full speed, without the CPU doing the work.
- The keys are managed by the Secure Enclave, a separate processor inside the SoC with its own boot ROM, its own memory protection and its own random-number generator. The keys are never exposed to the main CPU or to macOS.
- Every APFS volume has a volume encryption key. With FileVault off, that key is protected only by a hardware key unique to this chip (the UID), so the data is encrypted but unlocks automatically on this Mac. With FileVault on, the key is also wrapped with a key derived from your password, so nothing can be read until you log in.
- Erasing a volume makes the Secure Enclave destroy its key. The data is still physically there, but it's unreadable, which is why erasing an Apple Silicon Mac takes seconds.

One thing that confuses people: `diskutil apfs list` may say "Encrypted: No" next to "FileVault: Yes". On Apple's own account the hardware encryption above applies regardless. My guess is that the field refers to APFS-level encryption state rather than the hardware engine, but I couldn't find Apple documentation of what it means on Apple Silicon. Trust the Platform Security Guide over the label.

### Writes and wear

Apple doesn't publish an endurance rating for Mac SSDs. Howard Oakley's working estimate is at least 3,000 erase-write cycles per cell, so a 512 GB SSD could take about 1,500 TB of writes before wearing out. At 60 GB of writes a day that's decades. One reported 256 GB M1 Mac had written 136 TB and reported 10% of its life used. Wear is real but, for normal use, it's not something to worry about.

### Why swap touches the SSD

When memory runs out (lesson 8), macOS writes compressed pages to swap files in `/System/Volumes/VM`. On this Mac swap is encrypted, like everything else. Swap isn't harmful in small amounts, but it's the single biggest source of avoidable SSD writes: Oakley's advice for a long SSD life is to have enough RAM that you rarely swap. It's also slow compared with RAM, which is why a Mac under heavy memory pressure feels sticky.

### The page cache

Not every write goes to the SSD immediately. macOS collects writes in RAM and flushes them in large batches, and keeps recently read files in RAM as cached pages. So a program can "write" 4 GB in a second, and reading the same file back can come entirely from memory without touching the SSD. You'll see both below.

### An analogy

The SSD is a warehouse of notebooks written in pencil that can't be erased line by line: to change one line, you copy the page's other lines into a fresh notebook and shred the old one. The warehouse manager (the controller) does all that copying, keeps a map of where everything really is, and makes sure no notebook gets shredded far more often than the others. Everything written is in a cipher, and only the guard at the door (the Secure Enclave) has the codebook.

## Watch it live

The SSD particle stream runs between the NAND and the chip: reads flow toward the chip, writes away, on a log scale from 50 KB/s to 3 GB/s so both a log file and a big copy show up. The numbers come from the byte counters of every block storage device, so an external drive counts too. In the memory panel, swap used tells you how much of the SSD is acting as Overflow Storage right now.

## Try it

### 1. Write 4 GB, watch, delete (writes 4 GB to the SSD)

Open a second Terminal and start a once-a-second view of what actually reaches the SSD:

```bash
iostat -d -w 1 disk0
```

In the first Terminal, write a 4 GB file of zeros to `/tmp`:

```bash
dd if=/dev/zero of=/tmp/macviz-ssd-test.bin bs=1m count=4096
```

On this Mac `dd` claimed 3.9 GB/s, finishing in about a second, but `iostat` showed the writes reaching the SSD a moment later, at a peak of about 6.1 GB/s for one second and about 2 GB/s the next. `dd` measured how fast macOS accepted the data into RAM; `iostat` shows when it went to flash. Watch the SSD particles in the app: writes flow away from the chip.

### 2. Read it back from cache

```bash
dd if=/tmp/macviz-ssd-test.bin of=/dev/null bs=1m
```

It reported 5.8 GB/s, but `iostat` and the app's read counter barely moved (under 100 MB/s): the file was still in RAM as cached pages. That's the page cache doing its job. Now delete the file, and stop `iostat` with Ctrl-C:

```bash
rm /tmp/macviz-ssd-test.bin
```

### 3. Check encryption and lifetime writes

```bash
fdesetup status
diskutil info disk0 | grep -E "Media Name|Protocol|Solid State|SMART"
ioreg -rc IOBlockStorageDriver -w0 | grep -oE '"Bytes \((Read|Write)\)"=[0-9]+'
sysctl -n kern.boottime
```

`fdesetup status` says whether FileVault is on. The `ioreg` line shows bytes read and written since boot. This Mac had written about 530 GB in the four days since `kern.boottime`, some of it from this course's own tests. Lifetime totals need a SMART tool like `smartctl` (from Homebrew's smartmontools), which is optional and not needed for this course.

## Check yourself

Q: Where is the SSD controller on an Apple Silicon Mac?
A: Inside the SoC. The flash packages are raw NAND.

Q: With FileVault off, is the internal SSD encrypted?
A: Yes. The volume key is protected by the chip's hardware UID; FileVault adds your password to the protection.

Q: Why did `dd` report a write speed far higher than you might expect?
A: It measured how fast macOS cached the data in RAM; the SSD got it slightly later.

Q: Why does erasing an Apple Silicon Mac take seconds?
A: The Secure Enclave destroys the volume key, making the data unreadable.

Q: What's the biggest avoidable source of SSD writes?
A: Swap from memory pressure.

## Go deeper

- [Apple Platform Security, Secure Enclave](https://support.apple.com/guide/security/sec59b0b31ff): the AES engine, key hierarchy and memory protection.
- [Apple Platform Security, volume encryption with FileVault](https://support.apple.com/guide/security/sec4c6dc1b6e): FileVault on and off, in Apple's words.
- [TidBITS, clarifying the lack of Mac Studio SSD upgradability](https://tidbits.com/2022/03/23/clarifying-the-lack-of-mac-studio-ssd-upgradability/): why Apple's flash modules aren't SSDs.
- [Eclectic Light, How long will my Mac's SSD last?](https://eclecticlight.co/2026/02/26/how-long-will-my-macs-ssd-last/): endurance, wear and swap.
- `man iostat` and `man dd` in Terminal.
