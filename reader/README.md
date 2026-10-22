# macviz reader

A small Swift program that reads the Mac's hardware counters without sudo and streams them to the
view as JSON over a WebSocket. The message shape is in `../CONTRACT.md`. No third-party packages.

## Build and run

Needs an Apple Silicon Mac (M1 or later). On Intel, or in a Rosetta terminal, it prints
"macviz needs Apple Silicon" and exits 1.

The quickest way is `./run.sh` at the repo root. It checks for Apple Silicon, `swift` and `npm`,
builds the web app if `web/dist` is missing or older than `web/src` (`npm ci` only when
`web/node_modules` is missing), builds the reader in release, starts it, and opens
`http://127.0.0.1:7878/` once the port answers. Ctrl-C stops it. `./run.sh --no-open` skips the
browser; any other flags (such as `--port 7979`) go to macviz.

To build by hand:

```bash
cd reader
swift build -c release
swift run -c release macviz            # serves http://127.0.0.1:7878/
swift run -c release macviz --once     # print one hello + sample as JSON and exit
swift run -c release macviz --selftest # check every contract key and range, exit 1 on failure
```

Flags:

- `--port <n>` listen port, default 7878. The server binds to 127.0.0.1 only. If the port is taken, macviz says so and exits 1.
- `--web <dir>` static files to serve. The default is the first `web/dist` in a directory above the executable, so the release binary works from any cwd; if none is found, `web/dist` in the checkout it was built from. `/` serves `index.html`. Paths that resolve outside the directory get 403.
- `--once`, `--selftest`, `--help`.

`--port=N` and `--web=dir` work too. Any other argument prints usage and exits 1.

The WebSocket only accepts browsers whose `Origin` is the page itself (`http://127.0.0.1:<port>` or `http://localhost:<port>`) or the Vite dev server (`http://localhost:5173`, `http://127.0.0.1:5173`); any other website gets 403. A request with no `Origin` (Node, curl) is allowed. Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding. Static files that resolve outside the web root, through `..` or a symlink, get 403.

Limits: 64 open connections, 10 s to send a request head, and a WebSocket client with 30 unsent samples is dropped.

The WebSocket lives at `/ws` (and `/`). A client gets `hello`, then the latest `sample` right away, then one `sample` per second.

## Where the numbers come from

| Field | Source |
| --- | --- |
| per-core usage | `host_processor_info` tick deltas |
| core kind | IORegistry `cluster-type` of each `cpuN` device, by `logical-cpu-id` (see below) |
| `pFreqMHz`, `eFreqMHz` | IOReport "CPU Core Performance States" residencies weighted by the `pmgr` (or `pmgr-child`) DVFS tables (`voltage-states5-sram` P, `voltage-states1-sram` E, or the keys `acc-clusters` names when those are missing). An idle cluster reports its lowest frequency. |
| GPU usage and frequency | IOReport `GPUPH` residency and `voltage-states9`. A powered-off GPU reports 0 MHz. |
| `cpuW`, `gpuW`, `aneW` | macOS 27: hidden IOReport CLPC energy counters (ids from macmon, see below). Otherwise IOReport "Energy Model". Each sample uses whichever source has a non-zero CPU counter; if neither does, the fields are null rather than 0. |
| `dramW` | IOReport "Energy Model" `DRAM` |
| `systemW` | SMC key `PSTR` |
| memory | `host_statistics64`, `vm.swapusage`, `kern.memorystatus_vm_pressure_level`. `appBytes` is anonymous minus purgeable pages. |
| `bandwidthGBs` | IOReport PMP "DCS BW" `AMCC RD+WR` histogram (4 GB/s bins, mean of midpoints, read every 2 s) |
| top processes | `proc_listpids` + `proc_pid_rusage` (footprint, CPU time delta), refreshed every 2 s |
| disk | `IOBlockStorageDriver` Statistics byte deltas, all drives summed |
| net | `getifaddrs` link-layer byte deltas on the busiest physical interface. A delta over 1 GB in one interval (an interface recreated under the same name) reads as 0. |
| temperatures | SMC: mean of `Tp*`/`Te*` (CPU) and `Tg*` (GPU) float sensors, every 2 s. Battery: `AppleSmartBatteryPack` `Temperature`. |
| fans | SMC `FNum`, `F<n>Ac`, `F<n>Mn`, `F<n>Mx` |
| battery | `AppleSmartBattery` (+ `AppleSmartBatteryPack` on macOS 27) |
| `sensors.lidAngleDeg` | the lid angle HID sensor ("las", Apple vendor 0x05AC, product 0x8104, usage page 0x20, usage 0x8A), report 1, a 9-bit angle in degrees. The server listens for the sensor's own input reports (about one a second at rest, more while the hinge moves); `--once` reads the feature report. |
| `cameraInUse` | CoreMediaIO `kCMIODevicePropertyDeviceIsRunningSomewhere` on every built-in camera device (the FaceTime camera and its Desk View twin), listed once at start |
| `micInUse`, `audioPlaying` | CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default input and default output device |
| `displayBrightness` | `DisplayServicesGetBrightness` (private DisplayServices framework) on the online display that `CGDisplayIsBuiltin` reports |
| `keyboardBacklight` | `KeyboardBrightnessClient brightnessForKeyboard:` (private CoreBrightness framework) on the first id from `copyKeyboardBacklightIDs` |
| `fast.fingers` | `MTDeviceCreateDefault`, `MTRegisterContactFrameCallback`, `MTDeviceStart` (private MultitouchSupport framework). Contacts in state 3 or 4 (touching); x and y are the framework's normalized position, size its `zTotal`, each clamped to 0..1. |
| llm | `127.0.0.1:11434/api/ps` (Ollama), `127.0.0.1:1234/api/v0/models` then `/v1/models` (LM Studio), every 2 s, 300 ms timeout |

## Core kinds

Each `cpuN` device in IORegistry has a `logical-cpu-id` (the `host_processor_info` index) and a `cluster-type`. A core with type `P` is reported as P; every other type (`E`, and `M` for the middle tier on chips with three tiers) is reported as E. The hello's `pCores` is `hw.perflevel0.physicalcpu` and `eCores` is the sum of every slower perflevel (`hw.nperflevels` can be 3), so a three-tier chip shows its two slower tiers together as E.

If IORegistry does not give a type for every core, or its P count does not match `pCores`, the reader falls back to E cores first, then P. That order was checked on the M5 (Mac17,3): with three `taskpolicy -c background` busy loops only ids 0 to 5 went busy at about 1.3 GHz, and with four normal busy loops ids 6 to 9 went to 100% and the P cluster to 4464 MHz, its top DVFS state. On the M5 the IORegistry types agree with this order.

On the M5 `hw.perflevel0.name` is "Super" and `perflevel1` is "Efficiency"; the contract still calls them P and E.

## Power counters on macOS 27

The CLPC counter ids differ per chip. `IOReport.swift` has the table from macmon by vladkens (MIT, https://github.com/vladkens/macmon, `src/clpc.rs`), which covers the drivers for M1, M2, M3, M4 and M5 including Pro, Max and Ultra, plus A18 Pro and T8152. The reader looks up the `CFBundleIdentifier` of the `AppleCLPC` service in that table. Only the M5 (`AppleT8142CLPC`) row has been checked on real hardware here; the rest are taken as macmon publishes them. A chip that is not in the table gets null `cpuW` and `aneW` on macOS 27, and `gpuW` from the "Energy Model".

## Fields that can be null

| Field | When | Why |
| --- | --- | --- |
| `aneCores` | always | No public or IORegistry property gives the Neural Engine core count. |
| `dramW` | macOS 27 | The "Energy Model" mJ channels (CPU, ANE, DRAM) read exactly 0 on macOS 27. CPU and ANE come from CLPC counters instead; DRAM has no replacement. |
| `cpuW`, `aneW` | macOS 27 on a chip whose CLPC driver is not in the table | See "Power counters on macOS 27". `gpuW` still comes from the "Energy Model" `GPU Energy` channel once it has read non-zero. |
| `bandwidthGBs` | chips without the PMP "DCS BW" histogram | The AMC Stats byte counters exist but return no data without root. |
| `pFreqMHz`, `eFreqMHz`, `gpu.*` | no `pmgr` node (VMs) | No DVFS table to weight against. |
| `cpuW`, `gpuW`, `aneW`, `dramW` | no IOReport (VMs) | `libIOReport.dylib` missing or its channels absent. |
| `gpuCores` | no `AGXAccelerator` | No GPU service to read. |
| `cpuTempC`, `gpuTempC`, `systemW`, fans | SMC not openable | No sensor fallback is implemented. `fanCount` is then 0. |
| `systemW` | SMC without `PSTR` | No other whole-system power reading is used. |
| `battery` | desktops | No `AppleSmartBattery`. |
| `battery.watts` | battery without `Amperage` or `Voltage` | Nothing to multiply. |
| `timeRemainingMin` | on AC, or while macOS is still estimating | macOS reports 0 or 65535 then. |
| `tokensPerSec` | always | Neither runtime exposes a rate without proxying requests. |
| `lidAngleDeg` | Macs without the sensor (desktops, older laptops) | No "las" HID device. |
| `cameraInUse` | no built-in camera | Nothing to watch; an external camera is not counted. |
| `displayBrightness` | lid closed, desktops | The built-in panel is not an online display, so there is nothing to read. |
| `keyboardBacklight` | no backlit built-in keyboard, or CoreBrightness changed | |
| `fast.fingers` | no trackpad, or MultitouchSupport changed | |
| `llm` | no runtime answering | Neither port responded within 300 ms. |

## Sensors and the fast channel

The lid and the trackpad feed `fast` messages: at most 30 a second, only while the lid angle moves by 0.5 degrees or more or a finger is on the trackpad. Each one carries the current angle and the current fingers. Fingers that lift send one `fingers: []`, then nothing until the next touch. A client with 3 unsent frames skips `fast` messages instead of queueing them, so they never count toward the 30-sample drop. The other sensors are read once a second with the sample.

The lid code is our own, written after reading LidAngleSensor by Sam Henri Gold (Apache 2.0, https://github.com/samhenrigold/LidAngleSensor), which showed which HID device holds the angle and how report 1 is laid out. That app polls the feature report 30 times a second; this reader waits for the sensor's input reports instead.

Private APIs that a future macOS can break or remove: DisplayServices (`displayBrightness`), CoreBrightness (`keyboardBacklight`) and MultitouchSupport (`fingers`). Each is loaded with `dlopen`; if a symbol or class is missing the field is null. The lid sensor's report layout is undocumented too. The finger struct layout (96 bytes, normalized x at byte 32, y at 36, size at 48) comes from public reverse engineering and has not been checked against real touches here.

Permissions: none of these ask for anything. Checked on a MacBook Air 13 (M5, Mac17,3), macOS 27.0.1, by watching `tccd` in `log show` while macviz ran: opening the lid sensor and starting MultitouchSupport made no TCC request at all, and the only requests were silent preflight checks (`preflight=yes`) for Microphone, AudioCapture, ScreenCapture and ListenEvent, made by coreaudiod and WindowServer when a process becomes their client. No dialog appeared. The camera and microphone are never opened; the reader only asks CoreMediaIO and CoreAudio whether some other process has them running.

Privacy: no keystrokes and no key identity are read. The trackpad gives finger positions and sizes only, nothing about what they click or type, and they are sent to connected clients and never stored or logged.

## Things to know

- Network counters are rounded by macOS to 1 KiB for ordinary processes, so slow traffic shows in steps of 1 KiB/s, and rx and tx often read the same small number.
- `healthPct` can be above 100 on a new battery (raw max capacity above design capacity).
- `topCpu` only lists processes the current user may inspect. Root processes such as `kernel_task` and `WindowServer` are skipped.
- `systemW` is an instant reading and jumps around; CPU and GPU power are 1 s averages.
- Trackpad `y` is 0 at the front edge (nearest you) and 1 at the hinge, taken from the framework's documented normalized coordinates (origin at the bottom left). Not verified by touch.
- With the lid closed (clamshell on an external display) the lid reads 0, `displayBrightness` is null and `keyboardBacklight` is 0 because macOS turns the backlight off.
- MultitouchSupport prints "*** Recognized ... family ***" on stdout when it opens the trackpad; the reader sends stdout to /dev/null for that call.
- Cost with sensors: 0.76 s of CPU over 60 s with a client connected and nothing moving, against 0.66 s for the build before sensors on the same machine. With 120 synthetic finger frames a second and a moving lid (a temporary test build), 28 `fast` messages a second went out and the reader used 0.67 s over 30 s, about 2% of one core.
- Cost: about 1% of one core with a client connected, measured with `ps` (1.15 s of CPU time over 120 s, 0.29 s over 30 s; re-measured after the chip-coverage changes at 1.40 s over 120 s on a busier machine, where the previous build took 1.68 s over the same 120 s). The PMP bandwidth read, the SMC temperature reads and the process scan cost the most, which is why they run every 2 s.
