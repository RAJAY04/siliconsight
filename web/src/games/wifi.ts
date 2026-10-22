// Pure parts of Wi-Fi Hot and Cold: what a dBm reading means, which way the signal is moving, and the simulated
// flat that ?demo walks around in.

/** Seconds per hunt. */
export const HUNT_S = 90

/** Labels for a signal strength. -60 and -80 follow lesson 13; -75 dBm is where a Mac starts looking for a better access point. */
export function quality(dbm: number): { label: string; plain: string; tone: 'ok' | 'accent' | 'warn' | 'crit' } {
  if (dbm >= -50) return { label: 'excellent', plain: 'very strong', tone: 'ok' }
  if (dbm >= -60) return { label: 'good', plain: 'strong', tone: 'accent' }
  if (dbm >= -75) return { label: 'fair', plain: 'okay', tone: 'warn' }
  return { label: 'weak', plain: 'weak', tone: 'crit' }
}

/** 0 cold .. 1 hot, straight on the dB scale from -90 to -30 dBm. */
export const heat = (dbm: number) => Math.min(1, Math.max(0, (dbm + 90) / 60))

/** Milliwatts from dBm: 0 dBm is 1 mW, and every 10 dB is a factor of 10. */
export const milliwatts = (dbm: number) => 10 ** (dbm / 10)
/** How many times more power a is than b. */
export const powerRatio = (a: number, b: number) => 10 ** ((a - b) / 10)

/** Compared with the average of the readings before it, 3 dB or more is a real move, about double or half the power. */
export function trend(before: number[], now: number): 'warmer' | 'colder' | 'same' {
  if (!before.length) return 'same'
  const avg = before.reduce((a, b) => a + b, 0) / before.length
  return now - avg >= 3 ? 'warmer' : avg - now >= 3 ? 'colder' : 'same'
}

/** "1 in 4,000,000,000" style: how small a received signal is next to one milliwatt. */
export function fractionOfMilliwatt(dbm: number): string {
  const n = Math.round(1 / milliwatts(dbm))
  return n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n.toLocaleString('en-US')
}

// The simulated flat, in metres: x 0..12 left to right, y 0..8 top to bottom.

export type P = { x: number; y: number }
export type Material = 'wood' | 'glass' | 'brick' | 'concrete' | 'metal'
/**
 * Loss per crossing in dB. Illustrative values; the order follows Apple's table of interference potential: wood and
 * glass low, brick medium, concrete high, metal very high.
 */
export const LOSS: Record<Material, number> = { glass: 2, wood: 4, brick: 8, concrete: 13, metal: 22 }
export type Wall = { a: P; b: P; m: Material }

export const PLAN = {
  w: 12,
  h: 8,
  router: { x: 1.4, y: 1.4 } as P,
  microwave: { x: 10.6, y: 6.9 } as P,
  walls: [
    { a: { x: 5, y: 0 }, b: { x: 5, y: 3.2 }, m: 'brick' },
    { a: { x: 5, y: 4.4 }, b: { x: 5, y: 8 }, m: 'brick' },
    { a: { x: 0, y: 4.6 }, b: { x: 3.4, y: 4.6 }, m: 'wood' },
    { a: { x: 8.4, y: 0 }, b: { x: 8.4, y: 4.6 }, m: 'concrete' },
    { a: { x: 8.4, y: 4.6 }, b: { x: 12, y: 4.6 }, m: 'wood' },
    { a: { x: 9.2, y: 1.2 }, b: { x: 11.2, y: 1.2 }, m: 'metal' },
    { a: { x: 0, y: 6.6 }, b: { x: 0, y: 8 }, m: 'glass' },
  ] as Wall[],
  rooms: [
    { name: 'Hall', x: 2.5, y: 2.6 },
    { name: 'Bedroom', x: 2.5, y: 6.6 },
    { name: 'Living room', x: 6.7, y: 6.4 },
    { name: 'Study', x: 6.7, y: 1.6 },
    { name: 'Store room', x: 10.2, y: 2.9 },
    { name: 'Kitchen', x: 10.2, y: 5.6 },
  ],
}

const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
/** True when segment pq crosses segment ab. Touching at an end does not count. */
export function crosses(p: P, q: P, a: P, b: P): boolean {
  const d1 = cross(a, b, p)
  const d2 = cross(a, b, q)
  const d3 = cross(p, q, a)
  const d4 = cross(p, q, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * The simulated link at p. Free space and indoor clutter use the log-distance model, -30 dBm at 1 m falling 30 dB per
 * tenfold distance; each wall on the straight line to the router subtracts its loss. On 5 GHz free-space loss is
 * 20·log10(5/2.4), about 6.4 dB, higher. A running microwave oven leaks at 2.45 GHz, so it raises the noise on 2.4 GHz.
 */
export function simLink(p: P, band: 2.4 | 5, microwave: boolean, plan = PLAN): { rssi: number; noise: number; walls: Wall[] } {
  const d = Math.max(1, Math.hypot(p.x - plan.router.x, p.y - plan.router.y))
  const walls = plan.walls.filter((w) => crosses(plan.router, p, w.a, w.b))
  const loss = walls.reduce((a, w) => a + LOSS[w.m], 0) + (band === 5 ? 20 * Math.log10(5 / 2.4) : 0)
  const rssi = Math.round(-30 - 30 * Math.log10(d) - loss)
  const near = Math.hypot(p.x - plan.microwave.x, p.y - plan.microwave.y)
  const noise = band === 2.4 && microwave ? Math.round(Math.max(-95, -70 - 8 * near)) : -95
  return { rssi, noise, walls }
}
