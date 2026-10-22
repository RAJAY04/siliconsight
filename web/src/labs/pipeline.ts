// Pure models behind the CPU pipeline lab: the loop's registers, a 5-stage pipeline timeline, a small
// out-of-order core, and the 2-bit branch predictor with the branch streams for the guessing game.

/** The loop body clang -O1 emits for `for (i = 0; i < n; i++) s += a[i];` on this Mac. */
export const LOOP = ['ldr  x9, [x0], #8', 'add  x8, x9, x8', 'subs x1, x1, #1', 'b.ne loop'] as const

export type Regs = { x0: number; x1: number; x8: number; x9: number; z: boolean }

/** Runs the loop one instruction at a time, returning the registers after each one. */
export function runLoop(a: number[], base = 0x1000): { pc: number; regs: Regs; loaded: number | null }[] {
  const r: Regs = { x0: base, x1: a.length, x8: 0, x9: 0, z: false }
  const out: { pc: number; regs: Regs; loaded: number | null }[] = []
  if (a.length === 0) return out
  for (;;) {
    const v = a[(r.x0 - base) / 8]
    r.x9 = v
    r.x0 += 8
    out.push({ pc: 0, regs: { ...r }, loaded: v })
    r.x8 += r.x9
    out.push({ pc: 1, regs: { ...r }, loaded: null })
    r.x1 -= 1
    r.z = r.x1 === 0
    out.push({ pc: 2, regs: { ...r }, loaded: null })
    out.push({ pc: 3, regs: { ...r }, loaded: null })
    if (r.z) return out
  }
}

// ---- The classic 5-stage pipeline ----

export const STAGES = ['F', 'D', 'X', 'M', 'W'] as const
export type Stage = (typeof STAGES)[number]
export type Ins = { text: string; dst?: string[]; src?: string[]; load?: boolean; /** Fetched down a wrongly guessed path. */ wrong?: boolean; /** A branch that turns out to be guessed wrong. */ mispredicted?: boolean }
/** One row of a pipeline diagram: what stage the instruction is in at each cycle, 'stall' while it waits. */
export type Row = { text: string; cells: (Stage | 'stall' | null)[]; flushed: boolean; wrong: boolean }

/**
 * Cycle-by-cycle timing for a simple in-order pipeline with forwarding. An ALU result reaches the next
 * instruction in time; a load's value arrives one cycle late, so a use right after it stalls one cycle.
 * Branches resolve in X: instructions fetched after a mispredicted branch are flushed and fetch restarts.
 * `serial` runs each instruction to the end before fetching the next; `deps: false` ignores hazards.
 */
export function schedule(prog: Ins[], mode: 'serial' | 'pipelined', deps = true): Row[] {
  type T = { f: number; d: number; x: number; end: number | null }
  const t: T[] = []
  const ready = new Map<string, number>()
  let flushAt: number | null = null
  let redirect: number | null = null
  for (let i = 0; i < prog.length; i++) {
    const p = prog[i]
    const prev = t[i - 1]
    const inOrder = mode === 'pipelined' && prev && prev.end == null
    let f = 0
    if (prev && mode === 'serial') f = prev.x + 3
    else if (prev) f = prev.f + 1
    // Only one instruction per stage: wait for the one ahead to move on.
    if (inOrder) f = Math.max(f, prev.d)
    if (!p.wrong && redirect != null) {
      f = redirect
      redirect = null
    }
    let d = f + 1
    if (inOrder) d = Math.max(d, prev.x)
    let x = d + 1
    if (inOrder) x = Math.max(x, prev.x + 1)
    if (deps) for (const s of p.src ?? []) x = Math.max(x, ready.get(s) ?? 0)
    // A wrong-path instruction never gets past the cycle its branch resolves.
    const end = p.wrong && flushAt != null ? flushAt : null
    t.push({ f, d, x, end })
    if (!p.wrong) for (const r of p.dst ?? []) ready.set(r, x + (p.load && r !== 'x0' ? 2 : 1))
    if (p.mispredicted) {
      flushAt = x
      redirect = x + 1
    }
  }
  const last = Math.max(...t.map((r) => (r.end ?? r.x + 2) + 1))
  return t.map((r, i) => {
    const cells: Row['cells'] = Array(last).fill(null)
    const put = (c: number, s: Row['cells'][number]) => {
      if (r.end != null && c > r.end) return
      cells[c] = s
    }
    for (let c = r.f; c < r.d; c++) put(c, c === r.f ? 'F' : 'stall')
    for (let c = r.d; c < r.x; c++) put(c, c === r.d ? 'D' : 'stall')
    put(r.x, 'X')
    put(r.x + 1, 'M')
    put(r.x + 2, 'W')
    return { text: prog[i].text, cells, flushed: r.end != null, wrong: !!prog[i].wrong }
  })
}

/** Cycles until the last instruction that counts has written back. */
export const cyclesOf = (rows: Row[]) => Math.max(...rows.filter((r) => !r.flushed).map((r) => r.cells.lastIndexOf('W') + 1))

const LD: Ins = { text: LOOP[0], dst: ['x9', 'x0'], src: ['x0'], load: true }
const ADD: Ins = { text: LOOP[1], dst: ['x8'], src: ['x9', 'x8'] }
const SUBS: Ins = { text: LOOP[2], dst: ['x1', 'nzcv'], src: ['x1'] }
const BNE: Ins = { text: LOOP[3], src: ['nzcv'] }
/** One trip round the loop, as the pipeline sees it. */
export const ITER: Ins[] = [LD, ADD, SUBS, BNE]
/** The last trip: the branch was guessed taken but falls through, so the next trip's first two get flushed. */
export const EXIT: Ins[] = [LD, ADD, SUBS, { ...BNE, mispredicted: true }, { ...LD, wrong: true }, { ...ADD, wrong: true }, { text: 'mov  x0, x8', dst: ['x0'], src: ['x8'] }, { text: 'ret', src: [] }]

// ---- A small out-of-order core ----

export type Op = 'ldr' | 'add' | 'subs' | 'b.ne' | 'mov' | 'ret'
export type Uop = {
  n: number
  op: Op
  iter: number
  wrong: boolean
  /** Physical register this uop writes, as rename hands it out. */
  phys: number
  dec: number
  issue: number | null
  done: number | null
  retire: number | null
  flushed: number | null
}
export type OooOpts = { iters: number; width?: number; rob?: number; slowIter?: number; slowLat?: number; mispredictLast?: boolean }
/** Unit pools, after Dougall Johnson's measurements of the M1 P core: 6 integer, 3 that load, 2 that branch. */
export const UNITS = { alu: 6, load: 3, branch: 2 }
const LAT: Record<Op, number> = { ldr: 4, add: 1, subs: 1, 'b.ne': 1, mov: 1, ret: 1 }
const REGS: Record<Op, { dst: string[]; src: string[] }> = {
  ldr: { dst: ['x9', 'x0'], src: ['x0'] },
  add: { dst: ['x8'], src: ['x9', 'x8'] },
  subs: { dst: ['x1', 'nzcv'], src: ['x1'] },
  'b.ne': { dst: [], src: ['nzcv'] },
  mov: { dst: ['x0'], src: ['x8'] },
  ret: { dst: [], src: [] },
}
const BODY: Op[] = ['ldr', 'add', 'subs', 'b.ne']

/**
 * Cycle by cycle: decode up to `width` uops in order, stopping after a taken branch (one per cycle) or when
 * the reorder buffer is full; issue any waiting uop whose inputs are ready, oldest first, within the unit
 * pools; retire finished uops in order from the head. With `mispredictLast`, the final branch is guessed
 * taken, so another trip is fetched down the wrong path until the branch executes and flushes it.
 */
export function ooo({ iters, width = 8, rob = 24, slowIter = -1, slowLat = 20, mispredictLast = false }: OooOpts): { uops: Uop[]; cycles: number } {
  const uops: Uop[] = []
  // Program order: correct path, with the wrong path spliced in after the last branch when it is guessed wrong.
  const stream: { op: Op; iter: number; wrong: boolean }[] = []
  for (let i = 0; i < iters; i++) for (const op of BODY) stream.push({ op, iter: i, wrong: false })
  const wrongPath = mispredictLast ? [0, 1, 2, 3].flatMap((k) => BODY.map((op) => ({ op, iter: iters + k, wrong: true }))) : []
  const exit = [{ op: 'mov' as Op, iter: iters, wrong: false }, { op: 'ret' as Op, iter: iters, wrong: false }]
  let next = 0
  let path: 'main' | 'wrong' | 'exit' = 'main'
  let wi = 0
  let ei = 0
  const ready = (u: Uop, reg: string) => {
    for (let k = u.n - 1; k >= 0; k--) {
      const p = uops[k]
      if (p.flushed != null || !REGS[p.op].dst.includes(reg)) continue
      if (p.done == null) return Infinity
      // The pointer bump of a post-indexed load is ready a cycle after it issues.
      return p.op === 'ldr' && reg === 'x0' ? (p.issue ?? 0) + 1 : p.done
    }
    return 0
  }
  let c = 0
  for (; c < 500; c++) {
    const live = uops.filter((u) => u.flushed == null && u.retire == null)
    // Retire in order, up to width a cycle.
    let r = 0
    for (const u of live) {
      if (r >= width || u.done == null || u.done > c) break
      u.retire = c
      r++
    }
    // Issue.
    const used = { alu: 0, load: 0, branch: 0 }
    for (const u of live) {
      if (u.issue != null || u.dec >= c) continue
      if (REGS[u.op].src.some((s) => ready(u, s) > c)) continue
      const pool = u.op === 'ldr' ? 'load' : u.op === 'b.ne' || u.op === 'ret' ? 'branch' : 'alu'
      if (used[pool] >= UNITS[pool] || (pool === 'branch' && used.alu >= UNITS.alu)) continue
      used[pool]++
      if (pool === 'branch') used.alu++
      u.issue = c
      u.done = c + (u.op === 'ldr' && u.iter === slowIter && !u.wrong ? slowLat : LAT[u.op])
    }
    // A wrong guess is found when the branch finishes: everything younger goes.
    const bad = uops.find((u) => mispredictLast && u.op === 'b.ne' && u.iter === iters - 1 && u.done != null && u.done <= c && path === 'wrong')
    if (bad) {
      for (const u of uops) if (u.n > bad.n && u.flushed == null) u.flushed = c
      path = 'exit'
    }
    // Decode.
    const inRob = uops.filter((u) => u.flushed == null && (u.retire == null || u.retire > c)).length
    let room = Math.min(width, rob - inRob)
    while (room > 0) {
      let s: (typeof stream)[number] | undefined
      if (path === 'main') s = stream[next]
      else if (path === 'wrong') s = wrongPath[wi]
      else s = exit[ei]
      if (!s) break
      const n = uops.length
      uops.push({ n, ...s, phys: 32 + n, dec: c, issue: null, done: null, retire: null, flushed: null })
      room--
      if (path === 'main') {
        next++
        if (next === stream.length) path = mispredictLast ? 'wrong' : 'exit'
      } else if (path === 'wrong') wi++
      else ei++
      // At most one taken branch a cycle ends the fetch group. The final branch falls through unless guessed taken.
      if (s.op === 'b.ne' && (s.iter < iters - 1 || s.wrong || mispredictLast)) break
      if (s.op === 'ret') break
    }
    if (uops.length && uops.every((u) => u.flushed != null || u.retire != null) && path === 'exit' && ei >= exit.length) break
  }
  return { uops, cycles: c + 1 }
}

// ---- Branch prediction ----

/** A 2-bit saturating counter: 0 and 1 predict not taken, 2 and 3 predict taken. */
export const predictTaken = (c: number) => c >= 2
export const train = (c: number, taken: boolean) => (taken ? Math.min(3, c + 1) : Math.max(0, c - 1))

/** Runs the counter over a stream, from weakly not taken. Returns each guess and the final count right. */
export function runPredictor(stream: boolean[], start = 1): { guesses: boolean[]; states: number[]; right: number } {
  let c = start
  const guesses: boolean[] = []
  const states: number[] = []
  let right = 0
  for (const t of stream) {
    states.push(c)
    const g = predictTaken(c)
    guesses.push(g)
    if (g === t) right++
    c = train(c, t)
  }
  return { guesses, states, right }
}

/** A seeded generator, so a round can be replayed and tested. */
export const seeded = (s: number) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)

export type StreamId = 'loop' | 'sorted' | 'random' | 'pattern'
export const STREAMS: { id: StreamId; label: string; plain: string; code: string; gen: (n: number, r: () => number) => boolean[] }[] = [
  {
    id: 'loop',
    label: 'Loop of 6',
    plain: 'A loop of 6',
    code: 'for (i = 0; i < 6; i++) ...  // b.ne at the bottom: taken 5 times, then falls through',
    gen: (n) => Array.from({ length: n }, (_, i) => i % 6 !== 5),
  },
  {
    id: 'sorted',
    label: 'Sorted data',
    plain: 'Sorted numbers',
    code: 'if (a[i] >= 128) ...  // a[] sorted: all the small ones first, then all the big ones',
    gen: (n, r) => {
      const a = Array.from({ length: n }, () => Math.floor(r() * 256)).sort((x, y) => x - y)
      return a.map((v) => v >= 128)
    },
  },
  {
    id: 'random',
    label: 'Random data',
    plain: 'Random numbers',
    code: 'if (a[i] >= 128) ...  // a[] holds random bytes',
    gen: (n, r) => Array.from({ length: n }, () => r() >= 0.5),
  },
  {
    id: 'pattern',
    label: 'Every third',
    plain: 'Every third one',
    code: 'if (i % 3 == 2) ...  // not taken, not taken, taken, again and again',
    gen: (n) => Array.from({ length: n }, (_, i) => i % 3 === 2),
  },
]
