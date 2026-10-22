import type { Fast, Finger, Hello, Sample } from './types.ts'
import { clamp } from './format.ts'

// Synthetic stream with the contract's exact shape, modelled on an Apple M5 MacBook Air.

const GiB = 2 ** 30
const TOTAL = 16 * GiB
const P = 4
const E = 6
const LLM_PERIOD = 60_000
const LLM_LEN = 22_000

export const demoHello: Hello = {
  type: 'hello',
  version: 1,
  hardware: {
    model: 'Mac17,3',
    chip: 'Apple M5',
    pCores: P,
    eCores: E,
    gpuCores: 8,
    aneCores: null,
    memBytes: TOTAL,
    hasBattery: true,
    fanCount: 0,
    macosVersion: '27.0',
  },
}

// Sensor episodes, timed from page load (the state starts 88 s before it): a two-finger scroll every 14 s,
// the lid easing between 100 and 120 degrees once a minute, a video call every two minutes, music now and then.
const LOAD = 88_000
type Episode = { period: number; at: number; len: number }
const SCROLL: Episode = { period: 14_000, at: 3_000, len: 1_400 }
const LID: Episode = { period: 60_000, at: 7_000, len: 3_500 }
const CALL: Episode = { period: 120_000, at: 15_000, len: 30_000 }
const MUSIC: Episode = { period: 75_000, at: 50_000, len: 30_000 }
/** A video playing through the hardware decoder now and then, on top of whatever else runs. */
const VIDEO: Episode = { period: 100_000, at: 30_000, len: 25_000 }
/** Milliseconds into the episode's current cycle at elapsed time el. */
const into = (el: number, e: Episode) => (((el - LOAD - e.at) % e.period) + e.period) % e.period
const cycle = (el: number, e: Episode) => Math.floor((el - LOAD - e.at) / e.period)
const on = (el: number, e: Episode) => into(el, e) < e.len
const smooth = (u: number) => u * u * (3 - 2 * u)

export function demoLid(el: number): number {
  const u = clamp(into(el, LID) / LID.len)
  const [a, b] = cycle(el, LID) & 1 ? [120, 100] : [100, 120]
  return a + (b - a) * smooth(u)
}

/** Two fingers side by side flicking toward the hinge, then back the other way next time. */
export function demoFingers(el: number): Finger[] {
  if (!on(el, SCROLL)) return []
  const u = into(el, SCROLL) / SCROLL.len
  const k = smooth(cycle(el, SCROLL) & 1 ? 1 - u : u)
  const y = 0.28 + 0.46 * k
  return [
    { id: 1, x: 0.43 + 0.02 * k, y, size: 0.42 },
    { id: 2, x: 0.57 + 0.02 * k, y: y - 0.04, size: 0.38 },
  ]
}

const PAGE = 16384
const jitter = (amp: number) => (Math.random() - 0.5) * 2 * amp
const ease = (x: number, k: number) => x + (k - x) * 0.35

type State = {
  start: number
  e: number[]
  p: number[]
  burst: number // seconds of P-core burst left
  burstLevel: number
  app: number
  wired: number
  compressed: number
  gpu: number
  bw: number
  swap: number
  temp: number
  diskR: number
  diskW: number
}

function makeState(now: number): State {
  return {
    // Offset so the primed history holds one LLM episode and the next starts ~10 s after load.
    start: now - 88_000,
    e: Array(E).fill(0.15),
    p: Array(P).fill(0.03),
    burst: 0,
    burstLevel: 0,
    app: 5.2 * GiB,
    wired: 2.4 * GiB,
    compressed: 0.6 * GiB,
    gpu: 0.05,
    bw: 6,
    swap: 0,
    temp: 44,
    diskR: 0,
    diskW: 0,
  }
}

// User-level processes only: the reader skips root ones such as WindowServer, kernel_task and mds_stores.
const BASE_PROCS = [
  { pid: 1022, name: 'Safari', cpu: 6, mem: 1.4 },
  { pid: 1650, name: 'Code Helper (Renderer)', cpu: 4, mem: 0.9 },
  { pid: 1388, name: 'photoanalysisd', cpu: 12, mem: 0.12 },
  { pid: 2201, name: 'Slack', cpu: 2, mem: 0.62 },
  { pid: 2318, name: 'Xcode', cpu: 3, mem: 0.85 },
  { pid: 1803, name: 'Spotify', cpu: 1, mem: 0.21 },
  { pid: 1999, name: 'Finder', cpu: 0.5, mem: 0.15 },
  { pid: 2440, name: 'clang', cpu: 0, mem: 0.3 },
]

// The DVFS tables an M5 reports, in MHz.
const E_STATES = [972, 1152, 1584, 1992, 2352, 2700, 2964, 3048]
const P_STATES = [1308, 1608, 1932, 2220, 2508, 2820, 3072, 3300, 3516, 3720, 3876, 4020, 4176, 4248, 4272, 4332, 4428, 4416, 4464]

/** Spreads a core's active time over the two table states either side of its clock. */
function residency(active: number, mhz: number, table: number[]): number[] {
  const res = table.map(() => 0)
  const hi = Math.max(1, table.findIndex((f) => f >= mhz))
  const k = clamp((mhz - table[hi - 1]) / (table[hi] - table[hi - 1]))
  res[hi - 1] = Math.round(active * (1 - k) * 1000) / 1000
  res[hi] = Math.round(active * k * 1000) / 1000
  return res
}

function demoSched(usage: number[], eMHz: number, pMHz: number, procs: { pid: number; name: string; cpu: number }[]): NonNullable<Sample['sched']> {
  const threads = procs
    .filter((p) => p.cpu > 0.5)
    .flatMap((p) => {
      const ui = ['Safari', 'Slack', 'Xcode', 'Finder', 'FaceTime', 'Spotify'].includes(p.name)
      const bg = p.name === 'photoanalysisd'
      const split = p.name === 'clang' ? [1] : [0.6, 0.25]
      return split.map((f, i) => ({
        pid: p.pid,
        proc: p.name,
        name: ui && i === 0 ? 'main' : p.name === 'ollama' && i === 0 ? 'ggml-metal' : '',
        cpu: Math.round(p.cpu * f * 10) / 10,
        pri: bg ? 4 : ui && i === 0 ? 47 : p.name === 'clang' ? 31 : 37,
        basePri: bg ? 4 : ui && i === 0 ? 47 : p.name === 'clang' ? 31 : 37,
        state: (Math.random() < Math.min(0.9, (p.cpu * f) / 100) ? 'run' : 'wait') as 'run' | 'wait',
        policy: 'timeshare' as const,
      }))
    })
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 12)
  const busy = usage.reduce((a, b) => a + b, 0)
  return {
    cores: usage.map((u, id) => {
      const e = id < E
      const active = Math.round(clamp(u + 0.02 + jitter(0.01)) * 1000) / 1000
      const mhz = Math.round((e ? eMHz : pMHz) + jitter(60))
      return { id, active, freqMHz: mhz, res: residency(active, mhz, e ? E_STATES : P_STATES), irqs: Math.round(400 + u * 2500 + jitter(150)), ipis: Math.round(300 + u * 1800 + jitter(100)) }
    }),
    eStatesMHz: E_STATES,
    pStatesMHz: P_STATES,
    threads,
    contextSwitches: Math.round(9000 + busy * 4000 + jitter(800)),
    runnable: Math.max(1, Math.round(busy)),
    threadsSeen: 2900 + Math.round(jitter(30)),
    systemThreads: 4200 + Math.round(jitter(40)),
    systemTasks: 620,
    loadAvg: Math.round((2 + busy * 0.8) * 100) / 100,
  }
}

export function demoSample(s: State, now: number): Sample {
  const el = now - s.start
  const phase = el % LLM_PERIOD
  const llmOn = phase > LLM_PERIOD - LLM_LEN
  const llmT = phase - (LLM_PERIOD - LLM_LEN)
  const loading = llmOn && llmT < 3000
  // Like Ollama, the model stays loaded for a while after the last token, so the GPU's wind-down still reads as the LLM.
  const listed = llmOn || phase < 8000

  // E-cores: steady background with slow drift, a little indexing wave.
  const wave = 0.18 + 0.12 * Math.sin(el / 17_000)
  s.e = s.e.map((u, i) => clamp(ease(u, wave + jitter(0.12) + (i < 2 ? 0.08 : 0)), 0.02, 0.95))

  // P-cores: mostly idle, bursts of 2-8 s (a compile) a few times a minute.
  if (s.burst <= 0 && !llmOn && Math.random() < 0.05) {
    s.burst = 2 + Math.random() * 6
    s.burstLevel = 0.6 + Math.random() * 0.4
  }
  const pTarget = s.burst > 0 ? s.burstLevel : llmOn ? 0.18 : 0.04
  s.burst -= 1
  s.p = s.p.map((u, i) => clamp(ease(u, pTarget + jitter(s.burst > 0 ? 0.08 : 0.03) - (s.burst > 0 ? 0 : i * 0.005)), 0, 1))

  // GPU and DRAM bandwidth are high while generating tokens.
  const generating = llmOn && !loading
  s.gpu = clamp(ease(s.gpu, generating ? 0.88 + jitter(0.06) : 0.04 + jitter(0.03)))
  s.bw = Math.max(1, ease(s.bw, generating ? 128 + jitter(10) : loading ? 40 : 6 + s.burstLevel * (s.burst > 0 ? 18 : 0) + jitter(2)))

  // Memory: slowly fills, the model takes a chunk while loaded.
  const model = 4.7e9
  s.app = Math.min(6.8 * GiB, s.app + 3e6 + jitter(2e6))
  const appNow = s.app + (llmOn ? Math.min(1, llmT / 2500) * model : 0)
  s.compressed = clamp(s.compressed + (appNow > 10 * GiB ? 2e7 : -5e6), 0.3 * GiB, 2.5 * GiB)
  const wired = s.wired + jitter(2e7)
  const used = wired + appNow + s.compressed
  const free = Math.max(0.15 * GiB, TOTAL - used - 2.2 * GiB)
  const inactive = Math.max(0, TOTAL - used - free)
  if (used > 13 * GiB) s.swap = Math.min(2 * GiB, s.swap + 4e7)
  const pressure = used > 14.5 * GiB ? 'critical' : used > 12.5 * GiB ? 'warn' : 'normal'

  // Disk: model load reads fast, background writes trickle.
  s.diskR = loading ? 2.6e9 + jitter(3e8) : Math.random() < 0.15 ? 20e6 * Math.random() : 0.2e6 * Math.random()
  s.diskW = Math.random() < 0.25 ? 8e6 * Math.random() : 0.1e6 * Math.random()

  const pAvg = s.p.reduce((a, b) => a + b, 0) / P
  const eAvg = s.e.reduce((a, b) => a + b, 0) / E
  const cpuW = 0.3 + pAvg * P * 3.2 + eAvg * E * 0.35
  const gpuW = 0.1 + s.gpu * 13
  const aneW = llmOn ? 0.05 : 0
  const dramW = 0.25 + s.bw * 0.022
  s.temp = ease(s.temp, 40 + (cpuW + gpuW) * 2.2)

  const procs = BASE_PROCS.map((p) => ({
    ...p,
    cpu: p.name === 'clang' ? (s.burst > 0 ? s.burstLevel * 340 : 0) : Math.max(0, p.cpu + jitter(p.cpu * 0.4)),
  }))
  if (llmOn) procs.push({ pid: 3100, name: 'ollama', cpu: generating ? 45 + jitter(10) : 90, mem: model / GiB })
  const call = on(el, CALL)
  if (call) procs.push({ pid: 3300, name: 'FaceTime', cpu: 22 + jitter(4), mem: 0.18 })

  const netBurst = Math.random() < 0.2

  return {
    type: 'sample',
    t: now,
    cpu: {
      cores: [
        ...s.e.map((usage, i) => ({ id: i, kind: 'E' as const, usage })),
        ...s.p.map((usage, i) => ({ id: E + i, kind: 'P' as const, usage })),
      ],
      pFreqMHz: Math.round(1260 + pAvg * 3200),
      eFreqMHz: Math.round(970 + eAvg * 1900),
    },
    gpu: { usage: s.gpu, freqMHz: Math.round(340 + s.gpu * 1100) },
    power: { cpuW, gpuW, aneW, dramW, systemW: cpuW + gpuW + aneW + dramW + 3.1 },
    memory: {
      totalBytes: TOTAL,
      wiredBytes: wired,
      activeBytes: appNow * 0.7,
      inactiveBytes: inactive,
      compressedBytes: s.compressed,
      freeBytes: free,
      appBytes: appNow,
      swapUsedBytes: s.swap,
      pressure,
      bandwidthGBs: s.bw,
    },
    topCpu: [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 8).map(({ pid, name, cpu }) => ({ pid, name, cpu })),
    topMem: [...procs].sort((a, b) => b.mem - a.mem).slice(0, 8).map(({ pid, name, mem }) => ({ pid, name, bytes: mem * GiB })),
    disk: { readBps: s.diskR, writeBps: s.diskW },
    net: {
      rxBps: netBurst ? 2e6 + Math.random() * 6e6 : 2e4 + Math.random() * 8e4,
      txBps: netBurst ? 2e5 + Math.random() * 6e5 : 5e3 + Math.random() * 2e4,
      iface: 'en0',
    },
    thermal: {
      state: s.temp > 85 ? 'serious' : s.temp > 70 ? 'fair' : 'nominal',
      cpuTempC: s.temp + jitter(1),
      gpuTempC: s.temp - 3 + s.gpu * 8,
      batteryTempC: 30.5 + jitter(0.2),
    },
    fans: [],
    battery: {
      percent: 80,
      charging: false,
      acAttached: true,
      watts: 0,
      adapterW: 70,
      cycleCount: 112,
      healthPct: 98,
      timeRemainingMin: null,
      chargeHeld: true,
    },
    llm: listed
      ? {
          runtime: 'ollama',
          models: [{ name: 'llama3.1:8b-instruct-q4_K_M', sizeBytes: model, vramBytes: model }],
          // An 8B Q4 model on a base M5 generates in the low 20s of tokens per second.
          tokensPerSec: generating ? 23 + jitter(1.5) : null,
        }
      : null,
    sensors: {
      lidAngleDeg: Math.round(demoLid(el) * 10) / 10,
      cameraInUse: call,
      micInUse: call,
      audioPlaying: call || on(el, MUSIC) || on(el, VIDEO),
      displayBrightness: 0.72,
      keyboardBacklight: 0.35,
    },
    // A call keeps the camera ISP and the encoder busy; a video keeps the decoder and scaler busy.
    media: {
      decodeGBs: on(el, VIDEO) ? 2.4 + jitter(0.2) : 0,
      encodeGBs: call ? 0.42 + jitter(0.03) : 0,
      scalerGBs: on(el, VIDEO) ? 1.9 + jitter(0.2) : call ? 0.12 : 0.01,
      ispGBs: call ? 4.1 + jitter(0.2) : 0,
    },
    // Per-second page counts, in 16 KB pages, that follow the story: the model load reads its file in,
    // the memory squeeze compresses, and swap grows only while it is filling.
    paging: {
      pageBytes: PAGE,
      compressorStoredBytes: s.compressed * 2.1,
      faults: Math.round((loading ? 60_000 : s.burst > 0 ? 9_000 : 2_500) * (1 + jitter(0.3))),
      zeroFills: Math.round((loading ? 12_000 : s.burst > 0 ? 5_000 : 1_200) * (1 + jitter(0.3))),
      pageins: Math.round(loading ? s.diskR / PAGE : Math.random() < 0.3 ? 40 + Math.random() * 300 : 0),
      pageouts: 0,
      compressions: appNow > 10 * GiB ? Math.round(2e7 / PAGE * 2.1 * (1 + jitter(0.2))) : Math.random() < 0.2 ? Math.round(Math.random() * 60) : 0,
      decompressions: Math.round(Math.random() < 0.4 ? 20 + Math.random() * 200 : 0),
      swapins: 0,
      swapouts: used > 13 * GiB && s.swap < 2 * GiB ? Math.round(4e7 / PAGE) : 0,
    },
    sched: demoSched([...s.e, ...s.p], 970 + eAvg * 1900, 1260 + pAvg * 3200, procs),
    // A laptop on a desk two rooms from the router: the signal wanders a few dB, the rate follows it.
    wifi: (() => {
      const rssiDbm = Math.round(-58 + 4 * Math.sin(el / 23_000) + jitter(2))
      return { rssiDbm, noiseDbm: -95, txRateMbps: rssiDbm > -60 ? 864 : 576, channel: 36, bandGHz: 5, widthMHz: 80 }
    })(),
  }
}

/**
 * Calls onHello once, then onSample every second, and onFast about 30 times a second while the lid or the
 * fingers move, like the reader. Returns a stop function.
 */
export function startDemo(onHello: (h: Hello) => void, onSample: (s: Sample) => void, onFast: (f: Fast) => void): () => void {
  const state = makeState(Date.now())
  onHello(demoHello)
  // Prime 60 s of history so sparklines are not empty on first paint.
  const now = Date.now()
  for (let i = 60; i > 0; i--) onSample(demoSample(state, now - i * 1000))

  // The fast timer runs only during an episode, so the idle page has no 30 Hz wake-ups.
  let fastId: ReturnType<typeof setInterval> | undefined
  let startId: ReturnType<typeof setTimeout> | undefined
  const fast = () => {
    const t = Date.now()
    const el = t - state.start
    const lid = on(el, LID)
    const fingers = demoFingers(el)
    onFast({ type: 'fast', t, lidAngleDeg: lid ? demoLid(el) : null, fingers })
    if (!lid && !fingers.length) {
      clearInterval(fastId)
      fastId = undefined
    }
  }
  const startFast = () => {
    if (fastId) return
    fastId = setInterval(fast, 33)
    fast()
  }
  const tick = () => {
    const t = Date.now()
    const el = t - state.start
    onSample(demoSample(state, t))
    if (on(el, SCROLL) || on(el, LID)) startFast()
    else {
      const next = Math.min(SCROLL.period - into(el, SCROLL), LID.period - into(el, LID))
      if (next < 1000) startId = setTimeout(startFast, next)
    }
  }
  const id = setInterval(tick, 1000)
  if (on(now - state.start, SCROLL) || on(now - state.start, LID)) startFast()
  return () => {
    clearInterval(id)
    clearInterval(fastId)
    clearTimeout(startId)
  }
}
