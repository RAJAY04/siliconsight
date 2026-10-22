import { D, W } from './layout.ts'
import { clamp } from './format.ts'

/**
 * The camera on the exploded stack, written as one CSS transform on `.iso` (transform-origin 0 0):
 * the point (fx, fy, fz) of the stack is turned by spin around the stack's own vertical axis, tilted back by tilt,
 * scaled by zoom, and placed at (cx, cy). tilt 0 looks straight down, 90 is edge-on, 180 straight up at the bottom case.
 */
export type Cam = { tilt: number; spin: number; zoom: number; fx: number; fy: number; fz: number; cx: number; cy: number }

export const TILT_MIN = 0
export const TILT_MAX = 180
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
/** A close-up may go past what the wheel allows; small parts like the NAND need it. */
export const FOCUS_ZOOM_MAX = 6

/** Opened stack heights: [closed, open] in px, bottom case to lid. The slider's 1 is SPREAD times the open height. */
export const LAYER_Z = [
  [0, 0],
  [6, 55],
  [10, 175],
  [14, 255],
] as const
export const SPREAD = 1.6
/** Where the slider starts: the drawing's usual opened stack. */
export const DEFAULT_EXPLODE = 1 / SPREAD

export const layerZ = (i: number, e: number) => {
  const [zc, zo] = LAYER_Z[i]
  return zc + (zo - zc) * SPREAD * clamp(e)
}
/** The camera pivots on the middle of the stack, so pulling it apart grows evenly up and down. */
export const midZ = (e: number) => layerZ(LAYER_Z.length - 1, e) / 2

/** The three-quarter view the page opens on: tilted back 58 degrees and turned 16 so the hinge reads as the back edge. */
export const home = (e: number): Cam => ({ tilt: 58, spin: -16, zoom: 1, fx: W / 2, fy: D / 2, fz: midZ(e), cx: W / 2 + 15, cy: 118 })

export const clampTilt = (t: number) => clamp(t, TILT_MIN, TILT_MAX)
export const clampZoom = (z: number, max = ZOOM_MAX) => clamp(z, ZOOM_MIN, max)
/** Past edge-on, the bottom case faces the viewer. */
export const isUnder = (c: Cam) => c.tilt > 90

/** The same spin as `to`, picked within half a turn of `from`, so a tween never unwinds whole turns. */
export const nearestSpin = (from: number, to: number) => to + 360 * Math.round((from - to) / 360)

/**
 * Turns the stack over: the mirror tilt across edge-on (58 from above becomes 122 from below), and back.
 * Near edge-on the mirror would barely move, so it goes to the usual angle on the other side instead.
 */
export const flipped = (c: Cam): Cam => {
  const t = 180 - c.tilt
  return { ...c, tilt: Math.abs(t - 90) < 20 ? (isUnder(c) ? 58 : 122) : t }
}

export const mixCam = (a: Cam, b: Cam, t: number): Cam => {
  const out = { ...a }
  for (const k of Object.keys(a) as (keyof Cam)[]) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Drag speed left after dt ms of coasting; about a third of a second to stop. */
export const coast = (v: number, dt: number) => v * Math.exp(-dt / 320)

export const camCss = (c: Cam) =>
  `translate3d(${c.cx}px, ${c.cy}px, 0) scale(${c.zoom}) rotateX(${c.tilt}deg) rotateZ(${c.spin}deg) translate3d(${-c.fx}px, ${-c.fy}px, ${-c.fz}px)`

/** Pivot of the lid's tilt wrapper, as a fraction of its height (matches `.lid` transform-origin). */
export const LID_PIVOT = 0.8
/** Where a point drawn on the lid at height y ends up once the lid is tilted back by `tilt` degrees. */
export function lidPoint(y: number, tilt: number) {
  const dy = y - D * LID_PIVOT
  const r = (tilt * Math.PI) / 180
  return { y: D * LID_PIVOT + dy * Math.cos(r), z: -dy * Math.sin(r) }
}

/** Zoom that makes a part's long side take `fill` of `room`, both in .iso units (screen pixels over the stage's scale). */
export const fillZoom = (r: { w: number; h: number }, fill: number, room: number) => (fill * room) / Math.max(r.w, r.h)

/**
 * Close-up on a part: its centre goes to the screen point (cx, cy), zoomed so it fills a good share of the view,
 * looked at from above at a slightly flatter angle than home so the part reads face-on.
 */
export function focusCam(from: Cam, part: { x: number; y: number; z: number; zoom: number }, cx: number, cy: number): Cam {
  return {
    tilt: isUnder(from) ? 42 : clamp(from.tilt, 30, 50),
    spin: from.spin,
    zoom: clampZoom(part.zoom, FOCUS_ZOOM_MAX),
    fx: part.x,
    fy: part.y,
    fz: part.z,
    cx,
    cy,
  }
}
