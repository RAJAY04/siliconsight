// A tiny two-level cache simulator for the Caches lab: set-associative, least recently used, with an optional
// stride prefetcher. Pure, so it runs under node:test.

export type Pattern = 'seq' | 'random' | 'stride'

export type CacheSpec = { bytes: number; ways: number }

export type SimInput = {
  pattern: Pattern
  arrayBytes: number
  /** Element size in bytes; every access reads one element. */
  elemBytes: number
  /** Elements to jump between reads, for 'stride'. */
  strideElems: number
  reads: number
  lineBytes: number
  l1: CacheSpec
  l2: CacheSpec
  prefetch: boolean
  seed: number
}

export type SimResult = {
  reads: number
  l1Hits: number
  l2Hits: number
  dram: number
  /** Lines the prefetcher brought in ahead of a demand read. */
  prefetched: number
  /** Distinct lines the walk touched. */
  lines: number
  /** Where each of the first TRACE reads was found: 0 L1, 1 L2, 2 DRAM. */
  trace: number[]
}

export const TRACE = 160

/** Pointer-chase latencies measured on this Mac (M5, see the lab's fine print), nanoseconds. */
export const LAT_NS = { l1: 0.7, l2: 8, slc: 19, dram: 88 }

class Cache {
  sets: number
  tags: Float64Array
  used: Float64Array
  ways: number
  clock = 0
  constructor(spec: CacheSpec, lineBytes: number) {
    this.ways = spec.ways
    this.sets = Math.max(1, Math.floor(spec.bytes / lineBytes / spec.ways))
    this.tags = new Float64Array(this.sets * spec.ways).fill(-1)
    this.used = new Float64Array(this.sets * spec.ways)
  }
  /** True on a hit. Hits refresh the line's age; misses do nothing. */
  has(line: number): boolean {
    const base = (line % this.sets) * this.ways
    for (let w = 0; w < this.ways; w++)
      if (this.tags[base + w] === line) {
        this.used[base + w] = ++this.clock
        return true
      }
    return false
  }
  /** Puts a line in, evicting the least recently used line of its set. */
  fill(line: number) {
    const base = (line % this.sets) * this.ways
    let victim = base
    for (let w = 0; w < this.ways; w++) {
      if (this.tags[base + w] === line) return
      if (this.used[base + w] < this.used[victim]) victim = base + w
    }
    this.tags[victim] = line
    this.used[victim] = ++this.clock
  }
}

/** The element index of read n. Strides wrap around the array, as a loop over a 2D array's column would. */
export function addressOf(pattern: Pattern, n: number, elems: number, stride: number, rand: () => number): number {
  if (pattern === 'seq') return n % elems
  if (pattern === 'stride') {
    // Each pass starts one element further on, so a stride that divides the array still reaches every element.
    const perPass = Math.ceil(elems / stride)
    return ((n % perPass) * stride + Math.floor(n / perPass)) % elems
  }
  return Math.floor(rand() * elems)
}

/** A seeded generator so a run is the same every time. */
export const seeded = (s: number) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)

export function simulate(p: SimInput): SimResult {
  const l1 = new Cache(p.l1, p.lineBytes)
  const l2 = new Cache(p.l2, p.lineBytes)
  const rand = seeded(p.seed)
  const elems = Math.max(1, Math.floor(p.arrayBytes / p.elemBytes))
  const stride = Math.max(1, Math.floor(p.strideElems))
  const seen = new Set<number>()
  const out: SimResult = { reads: p.reads, l1Hits: 0, l2Hits: 0, dram: 0, prefetched: 0, lines: 0, trace: [] }
  const pf = new Set<number>()
  let lastLine = -1
  let lastDelta = 0
  for (let n = 0; n < p.reads; n++) {
    const line = Math.floor((addressOf(p.pattern, n, elems, stride, rand) * p.elemBytes) / p.lineBytes)
    seen.add(line)
    let level = 0
    if (l1.has(line)) out.l1Hits++
    else if (l2.has(line)) {
      out.l2Hits++
      l1.fill(line)
      level = 1
    } else {
      out.dram++
      l2.fill(line)
      l1.fill(line)
      level = 2
    }
    if (n < TRACE) out.trace.push(level)
    if (pf.delete(line)) out.prefetched++
    if (p.prefetch && line !== lastLine) {
      // Two equal steps in a row look like a pattern: fetch the next two lines on it before they're asked for.
      // Real prefetchers stay inside a page, so this one does too: 16 KB is 128 lines of 128 bytes.
      const d = line - lastLine
      if (lastLine >= 0 && d === lastDelta && Math.abs(d) * p.lineBytes <= 16384)
        for (const ahead of [line + d, line + 2 * d]) {
          if (ahead < 0 || ahead * p.lineBytes >= elems * p.elemBytes) continue
          if (!l1.has(ahead)) pf.add(ahead)
          l2.fill(ahead)
          l1.fill(ahead)
        }
      lastDelta = d
      lastLine = line
    }
  }
  out.lines = seen.size
  return out
}

/** Every read waits for the one before, like a linked list, so this is the slow end. Independent reads overlap. */
export const estimateNs = (r: Pick<SimResult, 'l1Hits' | 'l2Hits' | 'dram'>) => r.l1Hits * LAT_NS.l1 + r.l2Hits * LAT_NS.l2 + r.dram * LAT_NS.dram

/** A duration at human scale, where one clock cycle lasts one second. */
export function humanTime(ns: number, ghz: number): string {
  const s = ns * ghz
  if (s < 1.5) return '1 second'
  if (s < 90) return `${Math.round(s)} seconds`
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes`
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hours`
  if (s < 60 * 86400) return `${Math.round(s / 86400)} days`
  return `${Math.round(s / (365 * 86400) * 10) / 10} years`
}
