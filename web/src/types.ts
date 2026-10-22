// Mirrors CONTRACT.md. Keep in sync with reader/.

export type Hardware = {
  model: string
  chip: string
  pCores: number
  eCores: number
  gpuCores: number | null
  aneCores: number | null
  memBytes: number
  hasBattery: boolean
  fanCount: number
  macosVersion: string
}

export type Hello = { type: 'hello'; version: 1; hardware: Hardware }

export type Core = { id: number; kind: 'P' | 'E'; usage: number }

export type Battery = {
  percent: number
  charging: boolean
  acAttached: boolean
  watts: number | null
  adapterW: number | null
  cycleCount: number | null
  healthPct: number | null
  timeRemainingMin: number | null
  chargeHeld: boolean
}

export type Llm = {
  runtime: 'ollama' | 'lmstudio'
  models: { name: string; sizeBytes: number | null; vramBytes: number | null }[]
  tokensPerSec: number | null
}

export type Sample = {
  type: 'sample'
  t: number
  cpu: { cores: Core[]; pFreqMHz: number | null; eFreqMHz: number | null }
  gpu: { usage: number | null; freqMHz: number | null }
  power: {
    cpuW: number | null
    gpuW: number | null
    aneW: number | null
    dramW: number | null
    systemW: number | null
  }
  memory: {
    totalBytes: number
    wiredBytes: number
    activeBytes: number
    inactiveBytes: number
    compressedBytes: number
    freeBytes: number
    appBytes: number | null
    swapUsedBytes: number
    pressure: 'normal' | 'warn' | 'critical'
    bandwidthGBs: number | null
  }
  topCpu: { pid: number; name: string; cpu: number }[]
  topMem: { pid: number; name: string; bytes: number }[]
  disk: { readBps: number; writeBps: number }
  net: { rxBps: number; txBps: number; iface: string | null }
  thermal: {
    state: 'nominal' | 'fair' | 'serious' | 'critical'
    cpuTempC: number | null
    gpuTempC: number | null
    batteryTempC: number | null
  }
  fans: { rpm: number; minRpm: number | null; maxRpm: number | null }[]
  battery: Battery | null
  llm: Llm | null
  /** Optional: readers older than the sensors round send none. Read it through sensorsOf(). */
  sensors?: Sensors
  /** Optional: readers older than the media round send none. Read it through mediaOf(). */
  media?: Media
  /** Optional: readers older than the paging round send none. */
  paging?: Paging | null
  /** Optional: readers older than the Wi-Fi round send none. Null when Wi-Fi is off or not joined. */
  wifi?: WiFi | null
  /** Optional: readers older than the cores and threads round send none. */
  sched?: Sched
}

/** Per-core residency and interrupts, and the busiest threads. See CONTRACT.md. */
export type Sched = {
  cores: { id: number; active: number | null; freqMHz: number | null; res: number[] | null; irqs: number | null; ipis: number | null }[]
  eStatesMHz: number[]
  pStatesMHz: number[]
  threads: SchedThread[]
  contextSwitches: number | null
  runnable: number
  threadsSeen: number
  systemThreads: number | null
  systemTasks: number | null
  loadAvg: number | null
}

export type SchedThread = {
  pid: number
  proc: string
  name: string
  cpu: number
  pri: number
  basePri: number
  state: 'run' | 'wait' | 'uninterruptible' | 'stopped' | 'halted'
  policy: 'timeshare' | 'rr' | 'fifo'
}

/** The Wi-Fi link's quality. Signal and noise in dBm. */
export type WiFi = {
  rssiDbm: number
  noiseDbm: number | null
  txRateMbps: number | null
  channel: number | null
  bandGHz: 2.4 | 5 | 6 | null
  widthMHz: number | null
}

/** Virtual memory activity since the previous sample. Rates are pages per second. */
export type Paging = {
  pageBytes: number
  compressorStoredBytes: number
  faults: number | null
  zeroFills: number | null
  pageins: number | null
  pageouts: number | null
  compressions: number | null
  decompressions: number | null
  swapins: number | null
  swapouts: number | null
}

/** DRAM traffic of the video and camera blocks, GB/s. */
export type Media = {
  decodeGBs: number | null
  encodeGBs: number | null
  scalerGBs: number | null
  ispGBs: number | null
}

export type Sensors = {
  lidAngleDeg: number | null
  cameraInUse: boolean | null
  micInUse: boolean | null
  audioPlaying: boolean | null
  displayBrightness: number | null
  keyboardBacklight: number | null
}

export type Finger = { id: number; x: number; y: number; size: number }

/** Up to 30 a second while the lid or a finger moves. A null lid angle means unchanged or no sensor. */
export type Fast = { type: 'fast'; t: number; lidAngleDeg: number | null; fingers: Finger[] | null }

export type Message = Hello | Sample | Fast
