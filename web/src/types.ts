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
}

export type Message = Hello | Sample
