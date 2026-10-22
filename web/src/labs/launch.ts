import type { Sample } from '../types.ts'

// The app launch lab's watcher: start it, open an app, and see what the launch cost this Mac.

type Snap = Pick<Sample, 't' | 'topMem' | 'topCpu' | 'disk' | 'paging'>

export type Watch = {
  seconds: number
  /** Pages read in from files, summed over the samples since the start. Null when the reader sends no paging. */
  pageinBytes: number | null
  peakPageins: number | null
  peakReadBps: number
  /** Processes in the top memory list that weren't in either top list when watching began, biggest first. */
  arrivals: { pid: number; name: string; bytes: number }[]
}

export function watchLaunch(start: Snap, since: Snap[]): Watch {
  const known = new Set([...start.topMem, ...start.topCpu].map((p) => p.pid))
  const arrivals = new Map<number, { pid: number; name: string; bytes: number }>()
  let pageinBytes: number | null = null
  let peakPageins: number | null = null
  let peakReadBps = 0
  for (const s of since) {
    // Each sample's rates cover about one second since the previous one.
    const pi = s.paging?.pageins
    if (pi != null && s.paging) {
      pageinBytes = (pageinBytes ?? 0) + pi * s.paging.pageBytes
      peakPageins = Math.max(peakPageins ?? 0, pi)
    }
    peakReadBps = Math.max(peakReadBps, s.disk.readBps)
    for (const p of s.topMem) {
      if (known.has(p.pid)) continue
      const was = arrivals.get(p.pid)
      if (!was || p.bytes > was.bytes) arrivals.set(p.pid, { pid: p.pid, name: p.name, bytes: p.bytes })
    }
  }
  const last = since.at(-1)
  return {
    seconds: last ? Math.max(0, Math.round((last.t - start.t) / 1000)) : 0,
    pageinBytes,
    peakPageins,
    peakReadBps,
    arrivals: [...arrivals.values()].sort((a, b) => b.bytes - a.bytes),
  }
}
