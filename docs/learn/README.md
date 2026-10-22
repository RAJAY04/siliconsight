# Learn how your Mac works

A self-paced course, about one day long, on how an Apple Silicon Mac actually works, from the chip up to macOS. The live app is the lab bench: every lesson points at something you can see moving on your own Mac and ends with an experiment you run in Terminal and watch happen.

It's written for a curious developer or student, not a hardware engineer. You need no background beyond opening Terminal and pasting a command.

## Two ways through each lesson

Every lesson starts with "In plain words": a few short paragraphs with everyday pictures, for anyone. The same names come back in every lesson:

- Fast Workers and Eco Workers: the performance and efficiency CPU cores
- Desk Space: memory (RAM)
- Highway Speed: memory bandwidth
- Overflow Storage: swap on the SSD

If that's all you want, read the plain-words section and do the experiments. The rest of each lesson, from "The idea" on, is the technical track: how it really works, with numbers and sources.

## Course map

| # | Lesson | Minutes | App part |
|---|---|---|---|
| 1 | [What's inside the case, and why it's all one chip](01-orientation.md) | 25 | overview |
| 2 | [CPU cores, caches and why there are two kinds](02-cpu-cores.md) | 35 | cpu |
| 3 | [How macOS decides which core runs what](03-scheduler-and-qos.md) | 30 | cpu |
| 4 | [Clocks, voltage and where the watts go](04-clocks-voltage-power.md) | 30 | power |
| 5 | [Heat in a fanless Mac](05-heat-and-throttling.md) | 25 | thermal |
| 6 | [The GPU, tile-based rendering and the display](06-gpu-and-display.md) | 30 | gpu |
| 7 | [The Neural Engine and the other matrix units](07-neural-engine.md) | 25 | ane |
| 8 | [Unified memory, the compressor and memory pressure](08-unified-memory.md) | 35 | memory |
| 9 | [Memory bandwidth, the speed limit you rarely see](09-memory-bandwidth.md) | 25 | memory |
| 10 | [Local language models and why bandwidth sets their speed](10-local-llms.md) | 40 | memory |
| 11 | [The SSD, encryption at rest and why swap touches storage](11-storage-and-encryption.md) | 30 | ssd |
| 12 | [Battery, charging and why your Mac stops at 80%](12-battery-and-charging.md) | 30 | battery |
| 13 | [Wi-Fi, Bluetooth and the ports](13-wireless-and-io.md) | 25 | wifi |
| 14 | [Sensors, the green and orange dots, and what apps can see](14-sensors-and-privacy.md) | 25 | sensors |
| 15 | [Following one click and one keypress through the whole Mac](15-putting-it-together.md) | 30 | overview |
| 16 | [Capstone experiments](16-capstone-experiments.md) | 40 | overview |

Total: 480 minutes, 8 hours of lessons. Add breaks and it's a full day.

Also here: the [glossary](glossary.md) of every term, the [sources](sources.md) with what each one contributed, and two small lab programs in [`lab/`](lab/).

## A one-day schedule

| Time | What |
|---|---|
| 9:00 | Set up: start the app with `./run.sh` from the repository root and leave it open in a browser window beside Terminal |
| 9:15 | Lesson 1, orientation (25 min) |
| 9:40 | Lesson 2, CPU cores (35 min) |
| 10:15 | Break, 15 min |
| 10:30 | Lesson 3, the scheduler and QoS (30 min) |
| 11:00 | Lesson 4, clocks, voltage and power (30 min) |
| 11:30 | Lesson 5, heat (25 min). Let the Mac cool during lunch |
| 11:55 | Lunch, 60 min |
| 12:55 | Lesson 6, the GPU (30 min) |
| 13:25 | Lesson 7, the Neural Engine (25 min) |
| 13:50 | Break, 10 min |
| 14:00 | Lesson 8, unified memory (35 min) |
| 14:35 | Lesson 9, memory bandwidth (25 min) |
| 15:00 | Lesson 10, local LLMs (40 min) |
| 15:40 | Break, 15 min |
| 15:55 | Lesson 11, storage (30 min) |
| 16:25 | Lesson 12, battery (30 min). Have your charger handy |
| 16:55 | Lesson 13, wireless and I/O (25 min) |
| 17:20 | Break, 10 min |
| 17:30 | Lesson 14, sensors and privacy (25 min) |
| 17:55 | Lesson 15, putting it together (30 min) |
| 18:25 | Lesson 16, capstone (40 min). Better with a friend for the last experiment |
| 19:05 | Done |

Split across two days if you prefer: lessons 1 to 8 on day one, 9 to 16 on day two.

## What you need

- An Apple Silicon Mac (M1 or later). The course was tested on a 13-inch MacBook Air with M5 and 16 GB on macOS 27. Where other chips behave differently, the lessons say so.
- The app running (see the main [README](../../README.md)). Without a Mac, `?demo` mode shows synthetic data, which works for reading but not for the experiments.
- Terminal, and comfort pasting commands. The lab programs in `lab/` run with `swift`, which comes with Xcode or the Command Line Tools (`xcode-select --install`), the same requirement as the app.
- Your charger, for lesson 12.
- Optional: Ollama, for the hands-on part of lesson 10. Everything else uses what ships with macOS.

## Safety

Every experiment is safe and reversible. None needs `sudo`. Each one says how to stop it. The ones that heat the machine or drain the battery say so: run those on a hard surface, not on a blanket or your lap. The usual clean-up commands are `killall yes` for CPU loops and `rm` of the named test file in `/tmp`.

## How the lessons are structured

Each lesson is a Markdown file with front matter (id, title, minutes, focus, and `live`: the [CONTRACT.md](../../CONTRACT.md) fields it reads) and the same sections in the same order: In plain words, The idea, Watch it live, Try it, Check yourself, Go deeper. `focus` is one of chip, cpu, memory, gpu, ane, ssd, battery, wifi, power, thermal, sensors or overview, and names the part of the app to highlight. Check-yourself questions are written as "Q:" and "A:" lines so they can be collapsed.

## Honesty notes

Numbers quoted from Apple, researchers and benchmarks carry their source and the chip they were measured on. Numbers from "this Mac" are my own measurements on the test machine, one run each unless stated, with other apps running. Your figures will differ; the shape of the result is the point. Where I couldn't verify something, the lesson says so. The full list is at the end of [sources.md](sources.md).
