# Reader ↔ view contract

The reader (`reader/`, Swift) serves a WebSocket at `ws://127.0.0.1:7878/ws` (also accepted at `/`) and also serves the built web app over HTTP on the same port (`http://127.0.0.1:7878/`). Bind to 127.0.0.1 only.

On connect it sends one `hello`, then one `sample` per second. Every field the reader cannot read on this machine is `null`, never a made-up value. The view must render `null` as "not available", not as 0.

```ts
type Hello = {
  type: "hello";
  version: 1;
  hardware: {
    model: string;            // "Mac17,3"
    chip: string;             // "Apple M5"
    pCores: number;           // hw.perflevel0.physicalcpu
    eCores: number;           // hw.perflevel1.physicalcpu
    gpuCores: number | null;
    aneCores: number | null;  // Neural Engine core count if known (16 on M-series)
    memBytes: number;
    hasBattery: boolean;
    fanCount: number;         // 0 = fanless
    macosVersion: string;
  };
};

type Sample = {
  type: "sample";
  t: number;                  // unix ms
  cpu: {
    cores: { id: number; kind: "P" | "E"; usage: number /*0..1*/; }[];
    pFreqMHz: number | null;  // cluster average
    eFreqMHz: number | null;
  };
  gpu: { usage: number | null; freqMHz: number | null };
  power: {                    // watts: IOReport CLPC counters on macOS 27, "Energy Model" on older macOS; null when neither reads
    cpuW: number | null; gpuW: number | null; aneW: number | null;
    dramW: number | null; systemW: number | null;
  };
  memory: {
    totalBytes: number;
    wiredBytes: number; activeBytes: number; inactiveBytes: number;
    compressedBytes: number; freeBytes: number; appBytes: number | null;
    swapUsedBytes: number;
    pressure: "normal" | "warn" | "critical";
    bandwidthGBs: number | null;   // DRAM read+write, IOReport
  };
  topCpu: { pid: number; name: string; cpu: number /*% of one core*/ }[];      // top 8
  topMem: { pid: number; name: string; bytes: number }[];                       // top 8, footprint
  disk: { readBps: number; writeBps: number };
  net: { rxBps: number; txBps: number; iface: string | null };
  thermal: {
    state: "nominal" | "fair" | "serious" | "critical";   // ProcessInfo.thermalState
    cpuTempC: number | null; gpuTempC: number | null; batteryTempC: number | null;
  };
  fans: { rpm: number; minRpm: number | null; maxRpm: number | null }[];
  battery: null | {
    percent: number; charging: boolean; acAttached: boolean;
    watts: number | null;        // + into battery, - out of battery
    adapterW: number | null;     // charger rating
    cycleCount: number | null; healthPct: number | null;  // max/design capacity
    timeRemainingMin: number | null;
    chargeHeld: boolean;         // on AC, not charging, below 100 (optimized / limit)
  };
  llm: null | {
    runtime: "ollama" | "lmstudio";
    models: { name: string; sizeBytes: number | null; vramBytes: number | null }[];
    tokensPerSec: number | null; // last observed generation rate, if the runtime exposes it
  };
};
```

The view must also run with no reader: `?demo` (or a failed connection after 3 s) switches to a built-in synthetic stream with the same shape, clearly labelled "Demo data".

## Sensors (added in round 2, still `version: 1`)

Both additions are optional for old clients: a view that doesn't know them ignores them.

Every `sample` also carries:

```ts
sensors: {
  lidAngleDeg: number | null;        // hinge angle, 0 closed .. ~130+ open; null without a lid sensor
  cameraInUse: boolean | null;       // any app has the built-in camera running
  micInUse: boolean | null;          // any app has the default input device running
  audioPlaying: boolean | null;      // default output device is running somewhere
  displayBrightness: number | null;  // 0..1, built-in display
  keyboardBacklight: number | null;  // 0..1
};
```

Fast channel: while something moves, the reader also sends at most 30 per second

```ts
type Fast = {
  type: "fast";
  t: number;
  lidAngleDeg: number | null;        // sent when it changed by >= 0.5 degrees
  fingers: { id: number; x: number; y: number; size: number }[] | null; // trackpad, x 0..1 left->right, y 0..1 front->back (hinge), size 0..1; [] when lifted, null when unavailable
};
```

No keystrokes and no key identity are ever read. Finger positions are coordinates only and are never stored.

## Media engines (added in round 3, still `version: 1`)

Every `sample` may also carry the DRAM traffic of the video and camera blocks, from the per-block PMP `DCS BW` histograms in IOReport (no root needed). Refreshed every 2 s with memory bandwidth. Each field is `null` when the reader cannot read it; older readers send no `media` at all.

```ts
media: {
  decodeGBs: number | null;   // AVD, the hardware video decoder (H.264, HEVC, AV1); ProRes has its own engine with no counter here
  encodeGBs: number | null;   // AVE, the hardware video encoder
  scalerGBs: number | null;   // MSR, the scaler and colour converter that frames pass through
  ispGBs: number | null;      // ISP, the camera's image signal processor
};
```

These are memory traffic, averaged over the whole interval, not utilisation. A block that is off reads about 0; the histogram's lowest bin is 0 to 1 GB/s, so very light traffic is coarse.

## Paging (added in round 4, still `version: 1`)

Every `sample` may also carry what the virtual memory system did since the previous sample, from the kernel's lifetime counters in `host_statistics64(HOST_VM_INFO64)` (no root needed). Rates are pages per second; multiply by `pageBytes` for bytes. Each rate is `null` when there is no earlier reading to compare with. Older readers send no `paging` at all.

```ts
paging: null | {
  pageBytes: number;              // 16384 on Apple Silicon
  compressorStoredBytes: number;  // original size of what the compressor holds; memory.compressedBytes is the space it takes
  faults: number | null;          // page faults: an address touched with no page of RAM behind it yet
  zeroFills: number | null;       // faults answered with a fresh zeroed page
  pageins: number | null;         // pages read in from files on the SSD
  pageouts: number | null;        // file pages written back out
  compressions: number | null;    // pages squeezed into the compressor
  decompressions: number | null;  // pages taken back out of it
  swapins: number | null;         // pages read back from swap files
  swapouts: number | null;        // pages written to swap files
};
```

## Wi-Fi link (added in round 5, still `version: 1`)

Every `sample` may also carry the Wi-Fi link's quality, from CoreWLAN (`CWWiFiClient.shared().interface()`). None of these fields needs root or location permission. The network name does need location permission, so the reader never reads or sends it. `wifi` refreshes every 2 s and is `null` when there is no Wi-Fi interface, Wi-Fi is off, or it is on but not joined to a network; older readers send no `wifi` at all.

```ts
wifi: null | {
  rssiDbm: number;            // received signal strength in dBm, always negative; nearer 0 is stronger
  noiseDbm: number | null;    // background radio noise on the channel, dBm
  txRateMbps: number | null;  // current transmit link rate to the router
  channel: number | null;     // channel number, 1..233
  bandGHz: 2.4 | 5 | 6 | null;
  widthMHz: number | null;    // channel width: 20, 40, 80 or 160
};
```

## Cores and threads (added in round 6, still `version: 1`)

Every `sample` may also carry a deeper look at each core and at the busiest threads, for the Core X-ray and scheduler labs. None of it needs root. Older readers send no `sched` at all.

```ts
sched: {
  cores: {                      // one per logical CPU, same order and ids as cpu.cores
    id: number;
    active: number | null;      // 0..1 of the interval the core was out of its hardware idle state (IOReport "CPU Core Performance States")
    freqMHz: number | null;     // residency-weighted clock while active; the lowest table clock when it never left idle
    res: number[] | null;       // 0..1 of the interval spent at each DVFS state, same order as eStatesMHz or pStatesMHz; sums to active
    irqs: number | null;        // interrupts taken per second (PROCESSOR_CPU_STAT64 irq_ex_cnt)
    ipis: number | null;        // inter-processor interrupts per second (ipi_cnt): other cores poking this one, for example to reschedule
  }[];
  eStatesMHz: number[];         // the E cluster's DVFS table, slowest first; [] when unknown
  pStatesMHz: number[];         // the P cluster's
  threads: {                    // busiest 12 threads over the last 5 s, from processes this user may inspect
    pid: number;
    proc: string;               // process name
    name: string;               // thread name, "" when the app gave it none
    cpu: number;                // % of one core
    pri: number;                // current scheduling priority, 0..127
    basePri: number;            // base priority; the QoS class sets it (46 user interactive, 37 user initiated, 31 default, 20 utility, 4 background)
    state: "run" | "wait" | "uninterruptible" | "stopped" | "halted";  // "run" means running or ready to run
    policy: "timeshare" | "rr" | "fifo";
  }[];
  contextSwitches: number | null;  // per second, summed over the processes this user may inspect
  runnable: number;                // their threads in the run state at the scan
  threadsSeen: number;             // their threads in total
  systemThreads: number | null;    // every thread on the Mac, root's included (processor_set_statistics)
  systemTasks: number | null;
  loadAvg: number | null;          // 1 minute load average: threads running or waiting to run
};
```

`threads`, `contextSwitches`, the thread counts and `loadAvg` refresh every 5 s; the per-core fields every second. macOS does not reveal which thread runs on which core without root, so nothing here links a thread to a core.
