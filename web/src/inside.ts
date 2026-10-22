import type { Media, Sample } from './types.ts'

// Pure helpers behind the sensor map, the signal paths and the media engine card.

/** Below this a block is idle: the PMP histogram's lowest bin reads a few MB/s even when nothing runs. */
export const ACTIVE_GBS = 0.05

/** The sample's media traffic with every missing, negative or malformed field as null; old readers send none. */
export function mediaOf(s: Sample): Media {
  const x: Partial<Record<keyof Media, unknown>> = typeof s.media === 'object' && s.media !== null ? s.media : {}
  const gbs = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  return { decodeGBs: gbs(x.decodeGBs), encodeGBs: gbs(x.encodeGBs), scalerGBs: gbs(x.scalerGBs), ispGBs: gbs(x.ispGBs) }
}

/** Live, idle or not readable, for one traffic figure. */
export const busy = (gbs: number | null): boolean | null => (gbs == null ? null : gbs >= ACTIVE_GBS)

// --- Video coding illustration ---

/** One group of pictures in display order, the common IBBP pattern. */
export const GOP = 'IBBPBBPBBPBB'

/**
 * Which frames a frame is predicted from, by index in GOP. I uses none; P uses the anchor (I or P) before it;
 * B uses the anchors on both sides, and the last B frames point at the next group's I frame (index GOP.length).
 */
export function frameRefs(i: number): number[] {
  const t = GOP[i]
  if (t === 'I') return []
  let prev = i - 1
  while (prev >= 0 && GOP[prev] === 'B') prev--
  if (t === 'P') return [prev]
  let next = i + 1
  while (next < GOP.length && GOP[next] === 'B') next++
  return [prev, next]
}

/** Typical relative sizes after compression, for drawing only: an I frame is several times a P frame. */
export const FRAME_SIZE: Record<string, number> = { I: 1, P: 0.38, B: 0.16 }

export type Block = { col: number; row: number; dx: number; dy: number }

/**
 * Where a ball moving across a cols x rows macroblock grid was one frame ago, as motion vectors: every block the
 * ball covers now points back to where that content sat in the previous frame. Blocks it does not cover are skipped
 * (copied unchanged), which is most of the frame. Units are blocks.
 */
export function motionField(t: number, cols: number, rows: number, radius = 1.3): { ball: [number, number]; blocks: Block[] } {
  const pos = (u: number): [number, number] => [radius + ((cols - 2 * radius) * (0.5 - 0.5 * Math.cos(u * 0.9))), rows / 2 + (rows / 2 - radius) * Math.sin(u * 1.7)]
  const [x, y] = pos(t)
  const [px, py] = pos(t - 0.15)
  const blocks: Block[] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const cx = col + 0.5
      const cy = row + 0.5
      if (Math.hypot(cx - x, cy - y) <= radius + 0.35) blocks.push({ col, row, dx: px - x, dy: py - y })
    }
  return { ball: [x, y], blocks }
}

// --- Sensor map projection ---

/** World millimetres: x left to right, y hinge (-107.5) to front (+107.5), z up from the desk. */
export type P3 = [number, number, number]

export const BASE = { w: 304.1, d: 215, h: 11.3 }
const HINGE_Y = -BASE.d / 2

/**
 * A point on the lid: x across, v from the hinge (0) to the lid's top edge (215), at the live lid angle.
 * Closed (0 degrees) the lid lies on the base with its top edge at the front; at 90 it stands upright.
 */
export function lidPoint(x: number, v: number, angleDeg: number): P3 {
  const a = (angleDeg * Math.PI) / 180
  return [x, HINGE_Y + v * Math.cos(a), BASE.h + v * Math.sin(a)]
}

/** The display's outward normal at a lid angle: straight down when closed, toward the viewer at 90. */
export function lidNormal(angleDeg: number): P3 {
  const a = (angleDeg * Math.PI) / 180
  return [0, Math.sin(a), -Math.cos(a)]
}

export type View = { yaw: number; pitch: number; scale: number; cx: number; cy: number; dist: number }

/** Screen position and depth (larger is nearer the viewer) of a world point, with mild perspective. */
export function project([X, Y, Z]: P3, v: View): [number, number, number] {
  const x1 = X * Math.cos(v.yaw) - Y * Math.sin(v.yaw)
  const y1 = X * Math.sin(v.yaw) + Y * Math.cos(v.yaw)
  const depth = y1 * Math.cos(v.pitch) + Z * Math.sin(v.pitch)
  const f = v.dist / (v.dist - depth)
  return [v.cx + x1 * f * v.scale, v.cy + (y1 * Math.sin(v.pitch) - Z * Math.cos(v.pitch)) * f * v.scale, depth]
}

/** True when the display side of the lid faces the viewer. */
export function screenFacing(angleDeg: number, v: View): boolean {
  const [, ny, nz] = lidNormal(angleDeg)
  return ny * Math.cos(v.yaw) * Math.cos(v.pitch) + nz * Math.sin(v.pitch) > 0
}
