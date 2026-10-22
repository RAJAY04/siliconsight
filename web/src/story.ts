import type { Hardware, Sample, Sensors } from './types.ts'
import { bytes } from './format.ts'

export type StoryKind = 'llm' | 'compile' | 'video' | 'indexing' | 'idle' | 'busy'

export type Story = {
  kind: StoryKind
  title: string
  text: string
  /** A secondary line, such as a model that is loaded but not generating. */
  note?: string
  /** Set while an app has the camera or microphone open. */
  inUse?: string
  /** Only for kind 'llm' when the model size is known. Peak bandwidth and the ceiling are null for chips not in the table. */
  formula?: { peakGBs: number | null; modelGB: number; maxTokS: number | null; observedTokS: number | null }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/**
 * Mean of the last n non-null readings, or null when there are none. For counters the reader reports
 * noisily (total system power, DRAM bandwidth) so the number does not flicker every second.
 */
export function recentAvg(history: Sample[], pick: (s: Sample) => number | null, n = 3): number | null {
  const xs = history.slice(-n).map(pick).filter((v): v is number => v != null)
  return xs.length ? avg(xs) : null
}

/** Mean load of one cluster, or null when the sample has no cores of that kind. */
export function clusterAvg(s: Sample, kind: 'P' | 'E'): number | null {
  const xs = s.cpu.cores.filter((c) => c.kind === kind).map((c) => c.usage)
  return xs.length ? avg(xs) : null
}
/** Mean load across every core, the figure Activity Monitor's CPU graph shows. */
export const allCoreAvg = (s: Sample): number | null => (s.cpu.cores.length ? avg(s.cpu.cores.map((c) => c.usage)) : null)
/** Memory in use: everything except free pages and reclaimable file cache. */
export const usedBytes = (s: Sample) => s.memory.totalBytes - s.memory.freeBytes - s.memory.inactiveBytes
/** Chip power (CPU + GPU + Neural Engine), or null when the reader saw none of them. */
export const socW = (s: Sample): number | null =>
  s.power.cpuW == null && s.power.gpuW == null && s.power.aneW == null ? null : (s.power.cpuW ?? 0) + (s.power.gpuW ?? 0) + (s.power.aneW ?? 0)

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
/** The sample's sensors with every missing or malformed field as null; an older reader sends none at all. */
export function sensorsOf(s: Sample): Sensors {
  const x: Partial<Record<keyof Sensors, unknown>> = typeof s.sensors === 'object' && s.sensors !== null ? s.sensors : {}
  const level = (v: unknown) => {
    const n = num(v)
    return n == null ? null : Math.min(1, Math.max(0, n))
  }
  return {
    lidAngleDeg: num(x.lidAngleDeg),
    cameraInUse: bool(x.cameraInUse),
    micInUse: bool(x.micInUse),
    audioPlaying: bool(x.audioPlaying),
    displayBrightness: level(x.displayBrightness),
    keyboardBacklight: level(x.keyboardBacklight),
  }
}

/** Apple's published peak unified-memory bandwidth, GB/s. For binned Max chips the faster variant. */
const PEAK_GBS: Record<string, number> = {
  'Apple M1': 68, 'Apple M1 Pro': 200, 'Apple M1 Max': 400, 'Apple M1 Ultra': 800,
  'Apple M2': 100, 'Apple M2 Pro': 200, 'Apple M2 Max': 400, 'Apple M2 Ultra': 800,
  'Apple M3': 100, 'Apple M3 Pro': 150, 'Apple M3 Max': 400, 'Apple M3 Ultra': 819,
  'Apple M4': 120, 'Apple M4 Pro': 273, 'Apple M4 Max': 546,
  'Apple M5': 153,
}
export const peakBandwidth = (chip: string): number | null => PEAK_GBS[chip] ?? null

/** The largest loaded model, so its name and size always describe the same model. */
export function largestModel(s: Sample): { name: string; bytes: number | null } | null {
  const ms = s.llm?.models ?? []
  if (!ms.length) return null
  const size = (m: (typeof ms)[number]) => m.sizeBytes ?? m.vramBytes
  const m = ms.reduce((a, b) => ((size(b) ?? -1) > (size(a) ?? -1) ? b : a))
  return { name: m.name, bytes: size(m) }
}

/**
 * Narrates the last few samples (oldest first). Uses the median of a ~5 s window so a single
 * spike does not flip the story back and forth every second.
 */
export function detectStory(history: Sample[], chip = ''): Story {
  const last = history[history.length - 1]
  if (!last) return { kind: 'idle', title: 'Waiting for data', text: 'No samples yet.' }
  const story = loadStory(history, chip)
  const { cameraInUse: cam, micInUse: mic } = sensorsOf(last)
  if (cam || mic) story.inUse = `Something is using the ${cam && mic ? 'camera and the microphone' : cam ? 'camera' : 'microphone'}.`
  return story
}

function loadStory(history: Sample[], chip: string): Story {
  const win = history.slice(-5)
  const last = win[win.length - 1]

  const p = median(win.map((s) => clusterAvg(s, 'P') ?? 0))
  const e = median(win.map((s) => clusterAvg(s, 'E') ?? 0))
  const gpu = median(win.map((s) => s.gpu.usage ?? 0))
  const gpuKnown = last.gpu.usage != null
  const model = largestModel(last)
  const modelText = model && `${model.name}${model.bytes ? ` (${bytes(model.bytes)})` : ''}`

  // Memory jump: app memory grew by more than 2 GB within the last 30 s.
  const back = history[Math.max(0, history.length - 30)]
  const app = (s: Sample) => s.memory.appBytes ?? s.memory.activeBytes + s.memory.wiredBytes
  const memJump = app(last) - app(back) > 2e9
  // Only a model that is producing tokens is the story; a loaded, idle one is a footnote.
  const generating =
    last.llm != null && (last.llm.tokensPerSec != null || (model != null && gpuKnown && gpu > 0.5) || (gpuKnown && gpu > 0.6 && memJump))

  if (generating) {
    const story: Story = {
      kind: 'llm',
      title: 'Local LLM running',
      text: `${modelText ?? 'A local language model'} is generating. Each new token reads the whole model out of memory, so generation speed is limited by memory bandwidth, not by the GPU.`,
    }
    if (model?.bytes) {
      const modelGB = model.bytes / 1e9
      const peak = peakBandwidth(chip)
      story.formula = { peakGBs: peak, modelGB, maxTokS: peak == null ? null : peak / modelGB, observedTokS: last.llm?.tokensPerSec ?? null }
    }
    return story
  }
  const story = cpuStory(win, history, p, e, gpu, gpuKnown, last)
  if (modelText) story.note = `${modelText} is loaded and idle.`
  return story
}

function cpuStory(win: Sample[], history: Sample[], p: number, e: number, gpu: number, gpuKnown: boolean, last: Sample): Story {
  // The process with the most CPU across the window, so a burst that just ended is still credited.
  const byName = new Map<string, number>()
  for (const s of win) for (const x of s.topCpu) byName.set(x.name, (byName.get(x.name) ?? 0) + x.cpu)
  const name = [...byName].sort((a, b) => b[1] - a[1])[0]?.[0]
  // Process names like "claude" or "node" read as words mid-sentence, so call them processes.
  const top = name && `the ${name} process`
  const pNow = clusterAvg(last, 'P') ?? 0
  if (p > 0.6 && pNow > 0.6) {
    // "Clocks at their highest" only when the P-cluster clock is near the top this session has seen.
    const f = last.cpu.pFreqMHz
    const fMax = Math.max(0, ...history.map((s) => s.cpu.pFreqMHz ?? 0))
    const flatOut = pNow > 0.85 && f != null && f >= 0.9 * fMax
    return {
      kind: 'compile',
      title: 'Heavy CPU work',
      text: flatOut
        ? `The performance cores are near full${top ? `, mostly for ${top}` : ''}. This is what a compile or export looks like: every P-core busy, clocks at their highest.`
        : `The performance cores are busy${top ? `, mostly with ${top}` : ''}. Compiles, exports and big builds look like this.`,
    }
  }
  if (gpuKnown && gpu > 0.5 && p + e < 0.6) {
    return {
      kind: 'video',
      title: 'GPU busy, CPU calm',
      text: 'The GPU is doing most of the work while the CPU stays light. Video export, games and image tools look like this.',
    }
  }
  if (e > 0.3 && p < 0.15) {
    return {
      kind: 'indexing',
      title: 'Background work',
      text: `The efficiency cores are handling background jobs${top ? ` such as ${top}` : ''} while the performance cores sleep to save power.`,
    }
  }
  if (p < 0.12 && e < 0.3 && gpu < 0.2) {
    return {
      kind: 'idle',
      title: 'Mostly idle',
      text: 'Little is running. The performance cores are parked and the efficiency cores tick over at low clocks.',
    }
  }
  return {
    kind: 'busy',
    title: 'Mixed load',
    text: `Work is spread across both core clusters${top ? `, led by ${top}` : ''}.`,
  }
}

/** One plain sentence for the chip view, driven by which cluster is busy now. */
export function chipLine(s: Sample, hw: Hardware, simple = false): string {
  const p = clusterAvg(s, 'P') ?? 0
  const e = clusterAvg(s, 'E') ?? 0
  if (simple) {
    if (p > 0.5) return 'Something big is running. The Fast Workers are doing most of the work while the Eco Workers keep small jobs going.'
    if (e > 0.25 && p < 0.15) return 'Small background jobs are on the Eco Workers. The Fast Workers are resting until something big comes along.'
    if (p < 0.1 && e < 0.25) return 'Almost nothing is happening. The Eco Workers handle the little bits and the Fast Workers sleep.'
    return 'Both kinds of workers are sharing the job. Small tasks go to the Eco Workers and big ones to the Fast Workers.'
  }
  const E = `${hw.eCores} efficiency cores`
  const P = `${hw.pCores} performance cores`
  if (p > 0.5) return `A heavy burst is running. The ${P} are awake and doing most of the work while the ${E} keep background jobs going.`
  if (e > 0.25 && p < 0.15) return `Background work stays on the ${E}. The ${P} are resting and wake for heavy bursts.`
  if (p < 0.1 && e < 0.25) return `Almost nothing is running. The ${E} handle the trickle and the ${P} are parked.`
  return `Both clusters share the load. macOS puts short, light tasks on the ${E} and hands bursts to the ${P}.`
}

/**
 * Merges processes that share a name (Chrome or Electron apps run many helpers under one name), so the list
 * shows apps rather than five identical rows. Largest first.
 */
export function byApp<T extends { name: string }>(list: T[], value: (p: T) => number): { name: string; n: number; v: number }[] {
  const m = new Map<string, { name: string; n: number; v: number }>()
  for (const p of list) {
    const e = m.get(p.name) ?? { name: p.name, n: 0, v: 0 }
    e.n++
    e.v += value(p)
    m.set(p.name, e)
  }
  return [...m.values()].sort((a, b) => b.v - a.v)
}
