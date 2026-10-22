// A small flash translation layer: page-mapped, log-structured, greedy garbage collection and dynamic wear
// levelling, in the shape OSTEP's chapter on flash SSDs describes. The SSD lab's scene and its simulator both run on it.

export type PageState = 'free' | 'live' | 'stale'
export type Page = { state: PageState; lpn: number | null }
export type FtlEvent =
  | { kind: 'program'; ppn: number; lpn: number; gc: boolean }
  | { kind: 'stale'; ppn: number }
  | { kind: 'erase'; block: number }

export type Ftl = {
  blocks: number
  perBlock: number
  pages: Page[]
  /** Logical page number to physical page number, or null when the logical page holds nothing. */
  map: (number | null)[]
  erases: number[]
  active: number | null
  next: number
  hostWrites: number
  programs: number
  gcCopies: number
  log: FtlEvent[]
}

/** Erased blocks kept back so garbage collection always has somewhere to copy live pages to. */
const RESERVE = 1
/** How far apart erase counts may drift before long-lived data is moved off its little-worn block. */
export const WEAR_GAP = 6

export function makeFtl(blocks: number, perBlock: number, logical: number): Ftl {
  if (logical > (blocks - RESERVE - 1) * perBlock) throw new Error('needs at least two spare blocks')
  return {
    blocks,
    perBlock,
    pages: Array.from({ length: blocks * perBlock }, () => ({ state: 'free' as PageState, lpn: null })),
    map: Array(logical).fill(null),
    erases: Array(blocks).fill(0),
    active: null,
    next: 0,
    hostWrites: 0,
    programs: 0,
    gcCopies: 0,
    log: [],
  }
}

export const cloneFtl = (f: Ftl): Ftl => ({ ...f, pages: f.pages.map((p) => ({ ...p })), map: [...f.map], erases: [...f.erases], log: [...f.log] })

const blockPages = (f: Ftl, b: number) => f.pages.slice(b * f.perBlock, (b + 1) * f.perBlock)
export const liveIn = (f: Ftl, b: number) => blockPages(f, b).filter((p) => p.state === 'live').length
const isErased = (f: Ftl, b: number) => b !== f.active && blockPages(f, b).every((p) => p.state === 'free')
const erasedBlocks = (f: Ftl) => Array.from({ length: f.blocks }, (_, b) => b).filter((b) => isErased(f, b))

function stale(f: Ftl, lpn: number) {
  const old = f.map[lpn]
  if (old == null) return
  f.pages[old].state = 'stale'
  f.map[lpn] = null
  f.log.push({ kind: 'stale', ppn: old })
}

/** The next free page in the block being filled. Opens the least-worn erased block when that one is full. */
function nextPage(f: Ftl, inGc: boolean): number {
  if (f.active != null && f.next === f.perBlock) f.active = null
  // Collecting copies live pages into a newly opened block, which then takes the next writes too.
  if (!inGc) while (f.active == null && erasedBlocks(f).length <= RESERVE) collect(f)
  if (f.active == null) {
    const free = erasedBlocks(f)
    if (!free.length) throw new Error('no erased block left')
    f.active = free.reduce((a, b) => (f.erases[b] < f.erases[a] ? b : a))
    f.next = 0
  }
  return f.active * f.perBlock + f.next++
}

function program(f: Ftl, lpn: number, gc: boolean) {
  const ppn = nextPage(f, gc)
  f.pages[ppn] = { state: 'live', lpn }
  f.map[lpn] = ppn
  f.programs++
  f.log.push({ kind: 'program', ppn, lpn, gc })
}

const usedBlocks = (f: Ftl) => Array.from({ length: f.blocks }, (_, b) => b).filter((b) => b !== f.active && !isErased(f, b))

/**
 * Greedy garbage collection: the full block with the fewest live pages; its live pages move, then it is erased.
 * Wear levelling passes `victim` to move a block of long-lived data, even a block with no stale pages at all.
 */
export function collect(f: Ftl, victim?: number) {
  if (victim == null) {
    const used = usedBlocks(f)
    if (!used.length) throw new Error('nothing to collect')
    victim = used.reduce((a, b) => (liveIn(f, b) < liveIn(f, a) || (liveIn(f, b) === liveIn(f, a) && f.erases[b] < f.erases[a]) ? b : a))
    if (liveIn(f, victim) === f.perBlock) throw new Error('every block is full of live data')
  }
  for (const p of blockPages(f, victim)) {
    if (p.state !== 'live' || p.lpn == null) continue
    const lpn = p.lpn
    stale(f, lpn)
    program(f, lpn, true)
    f.gcCopies++
  }
  for (let i = 0; i < f.perBlock; i++) f.pages[victim * f.perBlock + i] = { state: 'free', lpn: null }
  f.erases[victim]++
  f.log.push({ kind: 'erase', block: victim })
}

/** The host writes one logical page. The old copy, if any, goes stale; the new one lands in a fresh page. */
export function write(f: Ftl, lpn: number) {
  if (lpn < 0 || lpn >= f.map.length) throw new RangeError(`logical page ${lpn} out of range`)
  f.hostWrites++
  stale(f, lpn)
  program(f, lpn, false)
  level(f)
}

/**
 * Static wear levelling. Writes only ever land in erased blocks, so a block holding data that never changes is
 * never erased and never shares the wear. When it falls too far behind, its data moves and the block rejoins.
 */
function level(f: Ftl) {
  const used = usedBlocks(f)
  if (!used.length || !erasedBlocks(f).length) return
  const cold = used.reduce((a, b) => (f.erases[b] < f.erases[a] ? b : a))
  if (Math.max(...f.erases) - f.erases[cold] > WEAR_GAP && f.erases[cold] === Math.min(...f.erases)) collect(f, cold)
}

/** TRIM: the host says this logical page holds nothing it needs, so garbage collection can skip it. */
export function trim(f: Ftl, lpn: number) {
  stale(f, lpn)
}

/** Flash writes per host write. 1 means no extra copying; null before anything is written. */
export const amplification = (f: Ftl) => (f.hostWrites ? f.programs / f.hostWrites : null)

// A toy file system on top, so the simulator can write, overwrite and delete whole files.

export type FileOp = { op: 'write'; name: string; pages: number } | { op: 'rewrite'; name: string } | { op: 'delete'; name: string }
export type Disk = { ftl: Ftl; files: { name: string; lpns: number[] }[]; freeLpns: number[]; trim: boolean }

export function makeDisk(blocks: number, perBlock: number, logical: number, useTrim: boolean): Disk {
  return { ftl: makeFtl(blocks, perBlock, logical), files: [], freeLpns: Array.from({ length: logical }, (_, i) => i), trim: useTrim }
}

/**
 * Applies one file operation. Returns false, changing nothing, when it can't apply: no room, an unknown file or a
 * name already in use. Freed logical pages go to the back of the queue, the way a file system tends not to reuse
 * the space it just freed at once.
 */
export function apply(d: Disk, o: FileOp): boolean {
  const file = d.files.find((x) => x.name === o.name)
  if (o.op === 'write') {
    if (file || o.pages < 1 || o.pages > d.freeLpns.length) return false
    const lpns = d.freeLpns.splice(0, o.pages)
    d.files.push({ name: o.name, lpns })
    lpns.forEach((l) => write(d.ftl, l))
    return true
  }
  if (!file) return false
  if (o.op === 'rewrite') file.lpns.forEach((l) => write(d.ftl, l))
  else {
    d.files = d.files.filter((x) => x !== file)
    d.freeLpns.push(...file.lpns)
    // Without TRIM the SSD never hears about the delete: those pages stay live until something overwrites them.
    if (d.trim) file.lpns.forEach((l) => trim(d.ftl, l))
  }
  return true
}

/** The same history from an empty disk, for comparing TRIM on and off. */
export function replay(blocks: number, perBlock: number, logical: number, useTrim: boolean, ops: FileOp[]): Disk {
  const d = makeDisk(blocks, perBlock, logical, useTrim)
  for (const o of ops) apply(d, o)
  return d
}

/** What the scene draws: the pages, wear and counters, without the map or the log. */
export type View = { pages: Page[]; erases: number[]; hostWrites: number; programs: number }
export const viewOf = (f: Ftl): View => ({ pages: f.pages.map((p) => ({ ...p })), erases: [...f.erases], hostWrites: f.hostWrites, programs: f.programs })

/** Replays the first `n` events onto a view, so an animation can show the log one event at a time. */
export function fold(v: View, events: FtlEvent[], n: number, perBlock: number): View {
  const out: View = { pages: v.pages.map((p) => ({ ...p })), erases: [...v.erases], hostWrites: v.hostWrites, programs: v.programs }
  for (const e of events.slice(0, n)) {
    if (e.kind === 'program') {
      out.pages[e.ppn] = { state: 'live', lpn: e.lpn }
      out.programs++
      if (!e.gc) out.hostWrites++
    } else if (e.kind === 'stale') out.pages[e.ppn] = { ...out.pages[e.ppn], state: 'stale' }
    else {
      for (let i = 0; i < perBlock; i++) out.pages[e.block * perBlock + i] = { state: 'free', lpn: null }
      out.erases[e.block]++
    }
  }
  return out
}
