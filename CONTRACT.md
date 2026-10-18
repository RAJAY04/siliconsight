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
