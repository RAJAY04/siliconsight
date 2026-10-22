import { PAD_ASPECT, type Pt } from '../games.ts'
import { clamp } from '../format.ts'

// Pure parts of Whack-a-Mole: which hole a tap lands in, when moles come up, scoring, and the electrode
// picture the round ends with. Points use the games' pad space: x 0..PAD_ASPECT, y 0..1 hinge to front.

export const COLS = 3
export const ROWS = 3
export const HOLES = COLS * ROWS
/** Seconds per round. */
export const ROUND_S = 40
/** Points lost for a tap on an empty hole, never below zero. */
export const WHIFF = 3

/** The pad splits into equal cells, so a tap anywhere over a hole's cell counts for that hole. */
export function holeAt(p: Pt): number {
  const c = clamp(Math.floor((p.x / PAD_ASPECT) * COLS), 0, COLS - 1)
  const r = clamp(Math.floor(p.y * ROWS), 0, ROWS - 1)
  return r * COLS + c
}

export const holeCenter = (i: number): Pt => ({ x: (((i % COLS) + 0.5) / COLS) * PAD_ASPECT, y: (Math.floor(i / COLS) + 0.5) / ROWS })

/**
 * How fast the round runs at t seconds in: how long a mole stays up, the wait before the next one, and how
 * many may be up at once. Everything speeds up in a straight line from the start to the end of the round.
 */
export function pace(t: number) {
  const k = clamp(t / ROUND_S)
  return { upMs: Math.round(1600 - 850 * k), gapMs: Math.round(1100 - 650 * k), maxUp: k < 0.35 ? 1 : k < 0.7 ? 2 : 3 }
}

/** A random free hole, avoiding the last one used when anything else is free. Null when every hole is busy. */
export function pickHole(busy: number[], last: number, rand: () => number = Math.random): number | null {
  const free = Array.from({ length: HOLES }, (_, i) => i).filter((i) => !busy.includes(i))
  const fresh = free.filter((i) => i !== last)
  const from = fresh.length ? fresh : free
  return from.length ? from[Math.min(from.length - 1, Math.floor(rand() * from.length))] : null
}

/** 10 for any hit, up to 10 more for speed: a whack the instant it appears scores 20, one at the last moment 10. */
export const hitPoints = (reactionMs: number, upMs: number) => 10 + Math.round(10 * clamp(1 - reactionMs / upMs))

/**
 * Fingers that touched down since the last frame. The trackpad gives each contact an id for as long as it stays
 * down, so a held finger is one whack, not thirty a second; a fresh tap arrives with an id not seen last frame.
 */
export function touchDowns<F extends { id: number }>(before: ReadonlySet<number>, now: F[]): F[] {
  return now.filter((f) => !before.has(f.id))
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// The lesson at the end: a finger seen by a grid of electrodes.

export const GRID_X = 12
export const GRID_Y = 8

/**
 * How strongly each electrode under the glass senses a fingertip at p, 0..1, row by row. A fingertip is wider
 * than the electrode pitch, so its signal spreads over several neighbours, falling off with distance.
 */
export function proximity(p: Pt, spread = 0.09): number[] {
  const out: number[] = []
  for (let r = 0; r < GRID_Y; r++) {
    for (let c = 0; c < GRID_X; c++) {
      const e = electrode(c, r)
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2
      out.push(Math.exp(-d2 / (2 * spread * spread)))
    }
  }
  return out
}
export const electrode = (c: number, r: number): Pt => ({ x: ((c + 0.5) / GRID_X) * PAD_ASPECT, y: (r + 0.5) / GRID_Y })

/** The proximity-weighted centre of the electrodes, ignoring readings under `floor` as noise. */
export function centroid(prox: number[], floor = 0.05): Pt | null {
  let z = 0
  let x = 0
  let y = 0
  prox.forEach((v, i) => {
    if (v < floor) return
    const e = electrode(i % GRID_X, Math.floor(i / GRID_X))
    z += v
    x += v * e.x
    y += v * e.y
  })
  return z ? { x: x / z, y: y / z } : null
}

/** The single strongest electrode's centre: what you would get without weighting, stuck to the grid. */
export function strongest(prox: number[]): Pt {
  const i = prox.indexOf(Math.max(...prox))
  return electrode(i % GRID_X, Math.floor(i / GRID_X))
}
