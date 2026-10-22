// A toy Mac with 48 frames of RAM, for the "Try it" card in the compression and swap lab and for the Fill the
// RAM game's demo mode. It opens apps one page at a time and, when no frame is free, reclaims one the way macOS
// does: drop a cached file page, else compress the coldest app page, else write a compressor segment to swap.
// The sizes and thresholds are toy numbers, chosen so every stage shows up within 16 apps.

export type Data = 'text' | 'zeros' | 'random'
export type Mix = Data | 'mixed'

export const RAM = 48
export const WIRED = 6
export const CACHE0 = 14
/** macOS keeps a few file pages even when short; the toy keeps two. */
export const CACHE_MIN = 2
export const APP_PAGES = 5
export const MAX_APPS = 16
/** Frames the compressor may hold before it starts writing segments to swap. */
export const COMP_MAX = 10
/** Swap space, in frames. */
export const SWAP_MAX = 24

/**
 * Compressed size as a fraction of a page. Text-like data at about half, as Apple said in 2013 and as vm_stat
 * shows on this Mac. A page of one repeated 32-bit value is stored as 4 bytes, and data the codecs cannot shrink
 * is kept whole, both per vm_compressor.c.
 */
export const SIZE: Record<Data, number> = { text: 0.5, zeros: 4 / 16384, random: 1 }
const MIXED: Data[] = ['text', 'zeros', 'random']

export type Slot = { k: 'wired' } | { k: 'free' } | { k: 'cache' } | { k: 'cmp' } | { k: 'app'; app: number; data: Data; hot: boolean }
export type Pressure = 'normal' | 'warn' | 'critical'

export type Sim = {
  slots: Slot[]
  /** Pages held by the compressor in RAM, and the fraction of a frame each takes. */
  inCompressor: number
  compUnits: number
  cmpSlots: number
  /** Swap used, in frames, and the pages it holds. */
  swapUnits: number
  swapPages: number
  drops: number
  compressions: number
  swapouts: number
  /** Apps that opened fully. Fewer than asked for means the toy ran out of memory. */
  opened: number
  oom: boolean
  pressure: Pressure
}

export const dataOf = (mix: Mix, app: number): Data => (mix === 'mixed' ? MIXED[app % 3] : mix)

export function simulate(apps: number, mix: Mix): Sim {
  const slots: Slot[] = Array.from({ length: RAM }, (_, i) => (i < WIRED ? { k: 'wired' } : i < WIRED + CACHE0 ? { k: 'cache' } : { k: 'free' }))
  // Oldest first, so a swap-out writes the oldest segment, as the compressor's age queue does.
  const queue: { data: Data; size: number }[] = []
  const st = { compUnits: 0, swapUnits: 0, swapPages: 0, drops: 0, compressions: 0, swapouts: 0 }
  const count = (k: Slot['k']) => slots.filter((s) => s.k === k).length

  /** Frees one frame, or returns false when nothing more can be reclaimed. */
  const reclaim = (current: number): boolean => {
    for (let guard = 0; guard < 10 * RAM; guard++) {
      if (slots.some((s) => s.k === 'free')) return true
      if (count('cache') > CACHE_MIN) {
        slots[slots.findIndex((s) => s.k === 'cache')] = { k: 'free' }
        st.drops++
        continue
      }
      // The coldest page: the lowest-numbered app that is not the one opening now.
      let cold = -1
      for (let i = 0; i < RAM; i++) {
        const s = slots[i]
        if (s.k === 'app' && s.app !== current && (cold < 0 || s.app < (slots[cold] as { app: number }).app)) cold = i
      }
      if (cold >= 0 && count('cmp') < COMP_MAX) {
        const data = (slots[cold] as { data: Data }).data
        queue.push({ data, size: SIZE[data] })
        st.compUnits += SIZE[data]
        st.compressions++
        // The compressed bytes live in RAM too: the page's frame becomes compressor storage when the compressor
        // needs another frame, and is freed otherwise.
        slots[cold] = Math.ceil(st.compUnits - 1e-9) > count('cmp') ? { k: 'cmp' } : { k: 'free' }
        continue
      }
      if (queue.length && st.swapUnits < SWAP_MAX - 1e-9) {
        // Write out one frame's worth of the oldest compressed pages.
        let out = 0
        while (queue.length && out < 1 - 1e-9) {
          const p = queue.shift()!
          out += p.size
          st.swapPages++
          st.swapouts++
        }
        st.compUnits = Math.max(0, st.compUnits - out)
        st.swapUnits += out
        let extra = count('cmp') - Math.ceil(st.compUnits - 1e-9)
        for (let i = RAM - 1; i >= 0 && extra > 0; i--) {
          if (slots[i].k === 'cmp') {
            slots[i] = { k: 'free' }
            extra--
          }
        }
        continue
      }
      return false
    }
    return false
  }

  let opened = 0
  let oom = false
  for (let a = 0; a < Math.min(apps, MAX_APPS) && !oom; a++) {
    const data = dataOf(mix, a)
    for (let p = 0; p < APP_PAGES; p++) {
      if (!reclaim(a)) {
        oom = true
        break
      }
      slots[slots.findIndex((s) => s.k === 'free')] = { k: 'app', app: a, data, hot: false }
    }
    if (!oom) opened++
  }
  const newest = opened - 1
  for (const s of slots) if (s.k === 'app') s.hot = s.app >= newest

  const cmpSlots = count('cmp')
  const pressure: Pressure = oom || st.swapUnits >= SWAP_MAX * 0.75 ? 'critical' : st.swapUnits > 0 || cmpSlots >= COMP_MAX / 2 ? 'warn' : 'normal'
  return { slots, inCompressor: queue.length, cmpSlots, opened, oom, pressure, ...st }
}

/** Original size over the space it takes: what vm_stat's "stored" over "occupied" gives on a real Mac. */
export const ratio = (sim: Sim): number | null => (sim.cmpSlots ? sim.inCompressor / sim.cmpSlots : null)
