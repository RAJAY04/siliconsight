// A small model of how macOS places threads on a chip with P and E cores, for the scheduler lab, plus the QoS band
// a thread's base priority implies. The rules come from XNU's scheduler and Howard Oakley's measurements (see the
// lab's sources); the model leaves out everything else the real scheduler weighs.

export type Qos = 'ui' | 'initiated' | 'default' | 'utility' | 'background'
export const QOS_ORDER: Qos[] = ['ui', 'initiated', 'default', 'utility', 'background']

/**
 * Base priority (XNU thread_qos_policy_params) and time slice (sched_clutch_thread_quantum_us on macOS, in ms)
 * for each class.
 */
export const QOS: Record<Qos, { pri: number; quantum: number; tech: string; plain: string }> = {
  ui: { pri: 46, quantum: 10, tech: 'User interactive', plain: 'Right now' },
  initiated: { pri: 37, quantum: 10, tech: 'User initiated', plain: 'Waiting on it' },
  default: { pri: 31, quantum: 10, tech: 'Default', plain: 'Normal' },
  utility: { pri: 20, quantum: 4, tech: 'Utility', plain: 'Long job' },
  background: { pri: 4, quantum: 2, tech: 'Background', plain: 'Whenever' },
}

/**
 * The QoS band a base priority falls in. A class can lower its threads' priority within the band down to the next
 * class, and an app's main thread sits at 47, so bands are ranges. 'above' is real-time or fixed priority work.
 */
export function qosOfPriority(basePri: number): Qos | 'above' {
  if (basePri > 47) return 'above'
  if (basePri > QOS.initiated.pri) return 'ui'
  if (basePri > QOS.default.pri) return 'initiated'
  if (basePri > QOS.utility.pri) return 'default'
  if (basePri > QOS.background.pri) return 'utility'
  return 'background'
}

export type SimThread = { id: number; qos: Qos; /** ms of work at the P cores' top clock */ work: number; /** ms */ arrive: number }
export type SimConfig = {
  p: number
  e: number
  pMHz: number
  eMHz: number
  /** The E cluster's clock while it runs only background work. */
  eBgMHz: number
}
export type SimFrame = { cores: (number | null)[]; ready: number[]; eFast: boolean }
export type SimOutcome = { id: number; start: number | null; finish: number | null; waited: number; onP: number; onE: number }
export type SimResult = {
  /** ms until the last thread finished, or the limit. */
  end: number
  /** One frame per simulated ms; cores 0..p-1 are P, then the E cores. */
  frames: SimFrame[]
  threads: SimOutcome[]
  switches: number
}

/**
 * Runs the threads to completion in 1 ms steps. Each step: the highest priority ready threads get cores, P first
 * unless they are background, which only ever gets E cores. A thread that used up its time slice goes to the back
 * of its queue. A thread keeps its core when it can, so it only moves when it must.
 * ponytail: speed scales with clock only; real E cores also do less per clock, so real E cores are slower still.
 */
export function simulate(threads: SimThread[], cfg: SimConfig, limit = 4000): SimResult {
  const n = cfg.p + cfg.e
  const isP = (c: number) => c < cfg.p
  const left = new Map(threads.map((t) => [t.id, t.work]))
  const out = new Map<number, SimOutcome>(threads.map((t) => [t.id, { id: t.id, start: null, finish: null, waited: 0, onP: 0, onE: 0 }]))
  const byId = new Map(threads.map((t) => [t.id, t]))
  let queue: number[] = []
  const enqueued = new Set<number>()
  let cores: (number | null)[] = Array(n).fill(null)
  const last: (number | null)[] = Array(n).fill(null)
  const slice: number[] = Array(n).fill(0)
  const frames: SimFrame[] = []
  let switches = 0
  let t = 0
  for (; t < limit; t++) {
    for (const th of threads) {
      if (th.arrive <= t && !enqueued.has(th.id)) {
        enqueued.add(th.id)
        queue.push(th.id)
      }
    }
    if (threads.every((th) => out.get(th.id)!.finish != null)) break
    // A thread whose slice ran out goes to the back of the queue; it keeps its core only if nobody else wants it.
    for (let c = 0; c < n; c++) {
      const id = cores[c]
      if (id != null && slice[c] >= QOS[byId.get(id)!.qos].quantum) {
        queue = [...queue.filter((x) => x !== id), id]
        slice[c] = 0
      }
    }
    const ready = queue.filter((id) => out.get(id)!.finish == null)
    const order = [...ready].sort((a, b) => QOS[byId.get(b)!.qos].pri - QOS[byId.get(a)!.qos].pri || ready.indexOf(a) - ready.indexOf(b))
    // Who runs, and on which kind of core.
    let freeP = cfg.p
    let freeE = cfg.e
    const kind = new Map<number, 'P' | 'E'>()
    for (const id of order) {
      const bg = byId.get(id)!.qos === 'background'
      if (!bg && freeP > 0) {
        kind.set(id, 'P')
        freeP--
      } else if (freeE > 0) {
        kind.set(id, 'E')
        freeE--
      }
    }
    // Where: keep the same core if it is the right kind, else take a free one.
    const next: (number | null)[] = Array(n).fill(null)
    const placed = new Set<number>()
    for (let c = 0; c < n; c++) {
      const id = cores[c]
      if (id != null && kind.get(id) === (isP(c) ? 'P' : 'E')) {
        next[c] = id
        placed.add(id)
      }
    }
    for (const id of order) {
      if (!kind.has(id) || placed.has(id)) continue
      const c = next.findIndex((x, i) => x == null && (isP(i) ? 'P' : 'E') === kind.get(id))
      next[c] = id
      placed.add(id)
    }
    const eFast = next.some((id, c) => id != null && !isP(c) && byId.get(id)!.qos !== 'background')
    frames.push({ cores: next, ready: order.filter((id) => !placed.has(id)), eFast })
    for (let c = 0; c < n; c++) {
      const id = next[c]
      if (id !== cores[c]) slice[c] = 0
      if (id == null) continue
      if (last[c] !== id) {
        if (last[c] != null) switches++
        last[c] = id
      }
      const o = out.get(id)!
      if (o.start == null) o.start = t
      const speed = isP(c) ? 1 : (eFast ? cfg.eMHz : cfg.eBgMHz) / cfg.pMHz
      left.set(id, left.get(id)! - speed)
      slice[c]++
      if (isP(c)) o.onP++
      else o.onE++
      if (left.get(id)! <= 1e-9) {
        o.finish = t + 1
        next[c] = null
      }
    }
    cores = next
  }
  for (const o of out.values()) {
    const th = byId.get(o.id)!
    o.waited = (o.finish ?? t) - Math.min(th.arrive, o.finish ?? t) - o.onP - o.onE
  }
  return { end: t, frames, threads: threads.map((th) => out.get(th.id)!), switches }
}

/** The frame at time t, holding the last one once the run is over. */
export const frameAt = (r: SimResult, t: number): SimFrame | null => r.frames[Math.max(0, Math.min(r.frames.length - 1, Math.floor(t)))] ?? null

/** Average usage per kind of core. */
export function clusterLoad(cores: { kind: 'P' | 'E'; usage: number }[]): { P: number | null; E: number | null } {
  const avg = (k: 'P' | 'E') => {
    const xs = cores.filter((c) => c.kind === k)
    return xs.length ? xs.reduce((a, c) => a + c.usage, 0) / xs.length : null
  }
  return { P: avg('P'), E: avg('E') }
}

/**
 * Which cluster took on new work between two readings, counted in cores' worth of extra load. A rise smaller than
 * a third of a core is noise. Null when neither rose.
 */
export function pickedUp(before: { kind: 'P' | 'E'; usage: number }[], after: { kind: 'P' | 'E'; usage: number }[]): 'P' | 'E' | 'both' | null {
  const rise = (k: 'P' | 'E') => after.filter((c) => c.kind === k).reduce((a, c) => a + c.usage, 0) - before.filter((c) => c.kind === k).reduce((a, c) => a + c.usage, 0)
  const p = rise('P') >= 0.33
  const e = rise('E') >= 0.33
  return p && e ? 'both' : p ? 'P' : e ? 'E' : null
}
