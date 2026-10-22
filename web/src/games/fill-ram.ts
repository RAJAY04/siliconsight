import type { Sample } from '../types.ts'
import { RAM, WIRED, simulate, type Sim } from '../labs/compress-sim.ts'

// Fill the RAM: turns the memory readings taken during a round into goals, a score and a timeline.

/** The memory numbers one sample gives, in bytes. */
export type MemPoint = {
  t: number
  total: number
  wired: number
  app: number | null
  compressed: number
  stored: number | null
  cached: number
  free: number
  swap: number
  pressure: 'normal' | 'warn' | 'critical'
  compressions: number | null
  swapouts: number | null
}

export const pointOf = (s: Sample): MemPoint => {
  const m = s.memory
  return {
    t: s.t,
    total: m.totalBytes,
    wired: m.wiredBytes,
    app: m.appBytes,
    compressed: m.compressedBytes,
    stored: s.paging?.compressorStoredBytes ?? null,
    cached: m.inactiveBytes,
    free: m.freeBytes,
    swap: m.swapUsedBytes,
    pressure: m.pressure,
    compressions: s.paging?.compressions ?? null,
    swapouts: s.paging?.swapouts ?? null,
  }
}

const MiB = 2 ** 20
/** Free memory under this share of RAM counts as a full desk. */
export const TIGHT = 0.05
/** Growth over the round's first reading that counts as the compressor or swap joining in. */
export const COMPRESS_GROW = 256 * MiB
export const SWAP_GROW = 64 * MiB

export type Goal = 'tight' | 'compress' | 'swap' | 'warn'
export const GOALS: { id: Goal; points: number }[] = [
  { id: 'tight', points: 10 },
  { id: 'compress', points: 20 },
  { id: 'swap', points: 30 },
  { id: 'warn', points: 40 },
]

export type Event =
  | { kind: 'start'; at: number; p: MemPoint }
  | { kind: Goal; at: number; p: MemPoint }
  | { kind: 'critical'; at: number; p: MemPoint }
  | { kind: 'calm'; at: number; p: MemPoint }

export type Round = {
  events: Event[]
  reached: Set<Goal>
  score: number
  peak: { pressure: MemPoint['pressure']; compressed: number; swap: number; minFree: number } | null
}

const RANK = { normal: 0, warn: 1, critical: 2 }

/**
 * Walks the readings in order. The first reading is the baseline, so swap or compressed memory left over from
 * earlier counts for nothing; only growth during the round scores. Each goal fires once.
 */
export function round(points: MemPoint[]): Round {
  const events: Event[] = []
  const reached = new Set<Goal>()
  if (!points.length) return { events, reached, score: 0, peak: null }
  const base = points[0]
  const at = (p: MemPoint) => (p.t - base.t) / 1000
  events.push({ kind: 'start', at: 0, p: base })
  const peak = { pressure: base.pressure, compressed: base.compressed, swap: base.swap, minFree: base.free }
  let high = RANK[base.pressure]
  let critical = base.pressure === 'critical'
  const hit = (g: Goal, p: MemPoint) => {
    if (reached.has(g)) return
    reached.add(g)
    events.push({ kind: g, at: at(p), p })
  }
  for (const p of points) {
    if (p.free < p.total * TIGHT) hit('tight', p)
    if (p.compressed - base.compressed >= COMPRESS_GROW) hit('compress', p)
    if (p.swap - base.swap >= SWAP_GROW) hit('swap', p)
    if (p.pressure !== 'normal') hit('warn', p)
    if (p.pressure === 'critical' && !critical) {
      critical = true
      events.push({ kind: 'critical', at: at(p), p })
    }
    // Back to normal after a warning: the Mac recovered, usually because apps were closed.
    if (p.pressure === 'normal' && high > 0) events.push({ kind: 'calm', at: at(p), p })
    high = p.pressure === 'normal' ? 0 : Math.max(high, RANK[p.pressure])
    if (RANK[p.pressure] > RANK[peak.pressure]) peak.pressure = p.pressure
    peak.compressed = Math.max(peak.compressed, p.compressed)
    peak.swap = Math.max(peak.swap, p.swap)
    peak.minFree = Math.min(peak.minFree, p.free)
  }
  const score = GOALS.reduce((s, g) => s + (reached.has(g.id) ? g.points : 0), 0)
  return { events, reached, score, peak }
}

/**
 * A reading for demo mode, from the lab's toy Mac scaled up to `total` bytes. Swap and the compressor start
 * from small leftovers, as on a real Mac that has been on a while.
 */
export function demoPoint(apps: number, t: number, total: number): MemPoint {
  const sim: Sim = simulate(apps, 'mixed')
  const frame = total / RAM
  const n = (k: string) => sim.slots.filter((s) => s.k === k).length
  return {
    t,
    total,
    wired: WIRED * frame,
    app: n('app') * frame,
    compressed: 0.3 * 2 ** 30 + sim.cmpSlots * frame,
    stored: 0.6 * 2 ** 30 + sim.inCompressor * frame,
    cached: n('cache') * frame,
    free: n('free') * frame,
    swap: 0.1 * 2 ** 30 + sim.swapUnits * frame,
    pressure: sim.pressure,
    compressions: null,
    swapouts: null,
  }
}
