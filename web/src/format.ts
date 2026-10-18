// Unit formatting. Every formatter maps null/undefined/NaN to NA so the UI never shows a fake 0.

export const NA = 'n/a'

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Decimal units, matching what macOS shows in Finder and Activity Monitor. */
export function bytes(v: number | null | undefined, digits = 1): string {
  if (!ok(v)) return NA
  let i = 0
  let n = Math.abs(v)
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000
    i++
  }
  const s = i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : digits)
  return `${v < 0 ? '-' : ''}${s} ${UNITS[i]}`
}

/**
 * Memory sizes, in binary units as Activity Monitor shows them: 16 GB means 16 GiB. Used for every
 * resident size (totals, processes, swap) so they add up; below 1 GiB it switches to MB.
 */
export function memGB(v: number | null | undefined, digits = 1): string {
  if (!ok(v)) return NA
  if (Math.abs(v) < 2 ** 30) return `${Math.round(v / 2 ** 20)} MB`
  return `${(v / 2 ** 30).toFixed(digits)} GB`
}

export function rate(v: number | null | undefined): string {
  return ok(v) ? `${bytes(v)}/s` : NA
}

export function watts(v: number | null | undefined): string {
  if (!ok(v)) return NA
  return `${Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)} W`
}

export function pct(v: number | null | undefined, scale = 100): string {
  return ok(v) ? `${Math.round(v * scale)}%` : NA
}

export function mhz(v: number | null | undefined): string {
  if (!ok(v)) return NA
  return v >= 1000 ? `${(v / 1000).toFixed(2)} GHz` : `${Math.round(v)} MHz`
}

export function temp(v: number | null | undefined): string {
  return ok(v) ? `${Math.round(v)} °C` : NA
}

export function minutes(v: number | null | undefined): string {
  if (!ok(v)) return NA
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function num(v: number | null | undefined, digits = 0): string {
  return ok(v) ? v.toFixed(digits) : NA
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/**
 * Rounds a 0..1 level to steps of 1/n. Used for values that restyle large SVG layers, so small sample-to-sample
 * noise does not repaint the scene every second.
 */
export const step = (v: number, n = 20) => Math.round(clamp(v) * n) / n

/** GPU clock; the reader reports 0 MHz when the GPU is powered off. */
export const gpuMhz = (v: number | null | undefined) => (v === 0 ? 'off' : mhz(v))
