import { box, AIR } from './layout.ts'
import { clamp } from './format.ts'

// Pure parts of the sensor games (Games.tsx): targets and scoring for the lid, shapes and scoring for the trackpad.

/** Trackpad width over depth, from the drawn MacBook Air, so shapes and traces keep the real proportions. */
export const PAD_ASPECT = (() => {
  const r = box(AIR.trackpad)
  return r.w / r.h
})()

export type GameId = 'lid' | 'pad' | 'mole' | 'fill-ram' | 'watts' | 'heat' | 'wifi'
export type GameMeta = { id: GameId; name: string; tech: string; blurb: string; plainBlurb: string }

/** The games list in the order shown. tech names the sensor; the blurbs say what you do. */
export const GAMES: GameMeta[] = [
  { id: 'lid', name: 'Lid Challenge', tech: 'hinge angle sensor', blurb: 'Set the lid to a target angle by eye; the hinge sensor scores you.', plainBlurb: 'You get an angle. Tilt the screen to match it, then see how close you got.' },
  { id: 'pad', name: 'Trackpad Drawing', tech: 'multitouch grid', blurb: 'Trace a shape on the trackpad; the raw touch grid scores the path.', plainBlurb: 'Draw the shape on the trackpad with one finger.' },
  { id: 'mole', name: 'Whack-a-Mole', tech: 'trackpad taps', blurb: 'Tap the trackpad where the mole pops up.', plainBlurb: 'Tap the trackpad where the mole pops up.' },
  { id: 'fill-ram', name: 'Fill the RAM', tech: 'memory pressure', blurb: 'Open apps until memory pressure rises, and watch swap and compression kick in.', plainBlurb: 'Open apps until the Desk Space runs out, and see what the Mac does next.' },
  { id: 'watts', name: 'Guess the Watts', tech: 'power sensors', blurb: 'Guess the power draw of a task, then measure it with the power sensors.', plainBlurb: 'Guess how much power something uses, then measure it.' },
  { id: 'heat', name: 'Heat Race', tech: 'temperature sensors', blurb: 'Load the CPU and guess when the chip starts throttling to stay cool.', plainBlurb: 'Make the chip work hard and guess when it slows down to stay cool.' },
  { id: 'wifi', name: 'Wi-Fi Hot and Cold', tech: 'radio signal strength', blurb: 'Walk around with the Mac and follow the RSSI to the strongest spot.', plainBlurb: 'Carry the Mac around and find where the Wi-Fi is strongest.' },
]

/** The game a #play/<id> hash opens, or null for the games list and anything else. */
export const gameAt = (hash: string): GameMeta | null => {
  const m = /^#?play\/([\w-]+)$/.exec(hash)
  return (m && GAMES.find((g) => g.id === m[1])) || null
}

// Lid Challenge

/** Targets stay where the screen can still be seen and the Mac won't sleep from a nearly shut lid. */
export const LID_MIN = 45
export const LID_MAX = 120
/** A new target is at least this far from where the lid is, so every round needs a real move. */
export const LID_GAP = 15

/** A whole-degree target between LID_MIN and LID_MAX, at least LID_GAP from the current angle. */
export function pickTarget(current: number | null, rand: () => number = Math.random): number {
  for (let i = 0; i < 20; i++) {
    const t = Math.round(LID_MIN + rand() * (LID_MAX - LID_MIN))
    if (current == null || Math.abs(t - current) >= LID_GAP) return t
  }
  // The range is 75 degrees wide, so the far end is always far enough.
  return current != null && current < (LID_MIN + LID_MAX) / 2 ? LID_MAX : LID_MIN
}

/** Points for a guess off by err degrees: full marks within a degree, then 5 fewer per degree, down to 0. */
export const lidPoints = (err: number) => Math.max(0, Math.round(100 - 5 * Math.max(0, Math.abs(err) - 1)))

export function lidVerdict(err: number): string {
  const e = Math.abs(err)
  return e <= 2 ? 'Spot on' : e <= 5 ? 'Very close' : e <= 10 ? 'Close' : 'Some way off'
}

// Trackpad Drawing

export type Pt = { x: number; y: number }
export type ShapeKey = 'circle' | 'square' | 'star' | 'm' | 'spiral'
export const SHAPES: { key: ShapeKey; name: string }[] = [
  { key: 'circle', name: 'Circle' },
  { key: 'square', name: 'Square' },
  { key: 'star', name: 'Star' },
  { key: 'm', name: 'Letter M' },
  { key: 'spiral', name: 'Spiral' },
]

/**
 * Shapes and traces share one space: x 0..PAD_ASPECT left to right, y 0..1 from the hinge edge to the front edge,
 * as drawn on screen. The reader's y runs front to back, so a finger at y maps to 1 - y here.
 */
export const fromPad = (x: number, y: number): Pt => ({ x: clamp(x) * PAD_ASPECT, y: 1 - clamp(y) })

function corners(key: ShapeKey): { pts: Pt[]; closed: boolean } {
  const cx = PAD_ASPECT / 2
  const cy = 0.5
  const ring = (n: number, r: (i: number) => number, a0 = -Math.PI / 2) =>
    Array.from({ length: n }, (_, i) => ({ x: cx + r(i) * Math.cos(a0 + (i / n) * 2 * Math.PI), y: cy + r(i) * Math.sin(a0 + (i / n) * 2 * Math.PI) }))
  switch (key) {
    case 'circle':
      return { pts: ring(96, () => 0.36), closed: true }
    case 'square':
      return { pts: [{ x: cx - 0.34, y: cy - 0.34 }, { x: cx + 0.34, y: cy - 0.34 }, { x: cx + 0.34, y: cy + 0.34 }, { x: cx - 0.34, y: cy + 0.34 }], closed: true }
    case 'star':
      return { pts: ring(10, (i) => (i % 2 ? 0.17 : 0.4)), closed: true }
    case 'm':
      return { pts: [{ x: cx - 0.32, y: 0.85 }, { x: cx - 0.32, y: 0.15 }, { x: cx, y: 0.6 }, { x: cx + 0.32, y: 0.15 }, { x: cx + 0.32, y: 0.85 }], closed: false }
    case 'spiral': {
      const turns = 2.5
      return {
        pts: Array.from({ length: 160 }, (_, i) => {
          const u = i / 159
          const a = u * turns * 2 * Math.PI
          const r = 0.04 + 0.36 * u
          return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
        }),
        closed: false,
      }
    }
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
export const pathLength = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + dist(p[i - 1], q) : 0), 0)

/** n points evenly spaced by arc length along a polyline, so slow and fast parts of a stroke weigh the same. */
export function resample(p: Pt[], n: number): Pt[] {
  if (p.length < 2 || n < 2) return p.slice(0, 1)
  const total = pathLength(p)
  if (total === 0) return [p[0]]
  const out: Pt[] = [p[0]]
  let i = 1
  let walked = 0
  for (let k = 1; k < n; k++) {
    const want = (k / (n - 1)) * total
    while (i < p.length - 1 && walked + dist(p[i - 1], p[i]) < want) walked += dist(p[i - 1], p[i++])
    const seg = dist(p[i - 1], p[i])
    const f = seg ? clamp((want - walked) / seg) : 0
    out.push({ x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f })
  }
  return out
}

/** The shape's outline as evenly spaced points, closed shapes back to their start. */
export function outline(key: ShapeKey, n = 240): Pt[] {
  const { pts, closed } = corners(key)
  return resample(closed ? [...pts, pts[0]] : pts, n)
}

/** A stretch of outline counts as traced when the stroke came this close (in pad depths; the pad is 1 deep). */
export const COVER_R = 0.05
/** Mean distance at which accuracy reaches zero. */
export const MISS_DIST = 0.12

/** Marks every outline point within COVER_R of p. Shared by the live view and the final score. */
export function cover(covered: Uint8Array, out: Pt[], p: Pt) {
  for (let i = 0; i < out.length; i++) if (!covered[i] && dist(out[i], p) <= COVER_R) covered[i] = 1
}

export type Score = { score: number; accuracy: number; coverage: number; meanDist: number }

/**
 * Accuracy is how close the stroke stays to the outline: its mean distance to the nearest outline point, mapped so
 * 0 is perfect and MISS_DIST or worse is 0. Coverage is the share of the outline the stroke passed near. The score
 * multiplies them, so a perfect dab on one corner and a scribble over the whole pad both score low.
 */
export function scoreTrace(trace: Pt[], out: Pt[]): Score {
  const len = pathLength(trace)
  if (trace.length < 2 || len === 0 || !out.length) return { score: 0, accuracy: 0, coverage: 0, meanDist: Infinity }
  const t = resample(trace, Math.round(clamp(len / 0.01, 2, 600)))
  const covered = new Uint8Array(out.length)
  let sum = 0
  for (const p of t) {
    let best = Infinity
    for (const q of out) best = Math.min(best, dist(p, q))
    sum += best
    cover(covered, out, p)
  }
  const meanDist = sum / t.length
  const accuracy = clamp(1 - meanDist / MISS_DIST)
  const coverage = covered.reduce((a, b) => a + b, 0) / out.length
  return { score: Math.round(100 * accuracy * coverage), accuracy, coverage, meanDist }
}
