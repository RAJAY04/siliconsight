import type { Hello, Sample } from './types.ts'
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
  }
}

/** Calls onHello once, then onSample every second. Returns a stop function. */
export function startDemo(onHello: (h: Hello) => void, onSample: (s: Sample) => void): () => void {
  const state = makeState(Date.now())
  onHello(demoHello)
  // Prime 60 s of history so sparklines are not empty on first paint.
  const now = Date.now()
  for (let i = 60; i > 0; i--) onSample(demoSample(state, now - i * 1000))
  const id = setInterval(() => onSample(demoSample(state, Date.now())), 1000)
  return () => clearInterval(id)
}
