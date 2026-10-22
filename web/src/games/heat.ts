// Pure parts of Heat Race: spotting the moment the clock drops or the fans spin up, scoring a prediction, and a
// simulated Mac for ?demo shaped like the measured run in lesson 5.

/** The page's own load stops itself after this many seconds. */
export const LOAD_S = 60
/** After the load, the run keeps watching the cool-down this long. */
export const COOL_S = 20
/** A prediction of "not within the minute" is scored as if it said this many seconds. */
export const NEVER = LOAD_S + 10
/** A clock below this share of its peak so far counts as throttled. */
export const DROP = 0.9
/** Fans count as spun up this many rpm above where they started. */
export const FAN_RISE = 400

export type Point = { t: number; pMHz: number | null; tempC: number | null; rpm: number | null; state: string }

/**
 * Seconds into the load when the P clock first sat below DROP of its highest value so far for two samples in a row.
 * The peak comes from the load itself, not from idle, because an idle P cluster runs well below its top step.
 */
export function throttleAt(pts: Point[]): number | null {
  let peak = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i].pMHz
    if (p == null) continue
    const next = pts[i + 1]?.pMHz
    if (peak > 0 && p < DROP * peak && next != null && next < DROP * peak) return pts[i].t
    peak = Math.max(peak, p)
  }
  return null
}

/** Seconds into the load when the fans first ran FAN_RISE above their starting speed. */
export function fanAt(pts: Point[]): number | null {
  const first = pts.find((p) => p.rpm != null)
  if (!first) return null
  const hit = pts.find((p) => p.rpm != null && p.rpm >= first.rpm! + FAN_RISE)
  return hit ? hit.t : null
}

/** 100 for the exact second, 4 fewer per second off, so 25 s off scores 0. Null means "not within the minute". */
export function predictScore(pred: number | null, actual: number | null): number {
  return Math.max(0, Math.round(100 - 4 * Math.abs((pred ?? NEVER) - (actual ?? NEVER))))
}

// Lesson 5's run on an M5 Air with every core busy: seconds, P clock in MHz, CPU temperature in °C.
const AIR: [number, number, number][] = [
  [0, 4464, 58],
  [15, 4210, 85],
  [30, 3941, 93],
  [75, 3717, 91],
]
const interp = (t: number, col: 1 | 2) => {
  let i = 0
  while (i < AIR.length - 2 && t >= AIR[i + 1][0]) i++
  const [a, b] = [AIR[i], AIR[i + 1]]
  const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])))
  return a[col] + (b[col] - a[col]) * k
}

/**
 * A simulated Mac at t seconds after the load started, cooling from `stop` on. The fanless curve follows lesson 5's
 * measured run; the fan curve is illustrative: the fans take the heat, so the clock holds while they speed up.
 */
export function simHeat(t: number, fans: boolean, stop: number, rand: () => number = Math.random): Omit<Point, 't'> {
  const n = () => (rand() - 0.5) * 40
  const loaded = t < stop
  const idleP = 2450
  if (fans) {
    const rpm = loaded ? Math.round(Math.min(4200, Math.max(0, (t - 10) * 220))) : Math.round(Math.max(0, 4200 - (t - stop) * 260))
    const temp = loaded ? 50 + 30 * (1 - Math.exp(-t / 9)) : 45 + 35 * Math.exp(-(t - stop) / 8)
    return { pMHz: loaded ? 4464 + n() : idleP, tempC: temp, rpm, state: 'nominal' }
  }
  if (loaded) return { pMHz: Math.round(interp(t, 1) + n()), tempC: interp(t, 2) + n() / 40, rpm: null, state: t > 45 ? 'fair' : 'nominal' }
  // Off the load the die drops fast, from where it was toward about 55 °C in half a minute, then slowly.
  const at = interp(stop, 2)
  return { pMHz: idleP, tempC: 50 + (at - 50) * Math.exp(-(t - stop) / 15), rpm: null, state: 'fair' }
}
