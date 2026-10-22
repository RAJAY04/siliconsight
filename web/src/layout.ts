import type { Hardware } from './types.ts'

// Every layer is drawn top-down in a 600 x 420 local box (close to the 1.41:1 footprint of Apple's notebooks),
// then CSS 3D tilts and stacks them.
export const W = 600
export const D = 420

export type Rect = { x: number; y: number; w: number; h: number }
/** [x0, y0, x1, y1] as fractions of the footprint: x left to right, y hinge to front, seen from above. */
export type Frac = [number, number, number, number]

/** n tiles filling r, with rows and columns chosen so tiles stay close to square whatever the core count. */
export function grid(n: number, r: Rect, gap = 2.5): Rect[] {
  const rows = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * r.h) / Math.max(1, r.w)))))
  const cols = Math.max(1, Math.ceil(n / rows))
  const w = Math.max(0, (r.w - gap * (cols - 1)) / cols)
  const h = Math.max(0, (r.h - gap * (rows - 1)) / rows)
  return Array.from({ length: n }, (_, i) => ({ x: r.x + (i % cols) * (w + gap), y: r.y + Math.floor(i / cols) * (h + gap), w, h }))
}
export const box = ([x0, y0, x1, y1]: Frac): Rect => ({ x: x0 * W, y: y0 * D, w: (x1 - x0) * W, h: (y1 - y0) * D })
/** A box inside another, from fractions of the outer one. */
export const sub = (r: Rect, [x0, y0, x1, y1]: Frac): Rect => ({ x: r.x + x0 * r.w, y: r.y + y0 * r.h, w: (x1 - x0) * r.w, h: (y1 - y0) * r.h })

/** MacBook Air 13", M2 to M5 chassis, from docs/teardown-reference.md. Fanless, so heat goes through the shield into the case. */
export const AIR = {
  board: [0.1, 0.04, 0.62, 0.3],
  shield: [0.1, 0.04, 0.36, 0.3],
  pmic: [0.2, 0.1, 0.34, 0.24],
  soc: [0.38, 0.1, 0.47, 0.22],
  nand: [0.5, 0.1, 0.55, 0.17],
  radio: [0.56, 0.06, 0.61, 0.12],
  battConn: [0.4, 0.27, 0.46, 0.31],
  sideBoards: [
    [0, 0.08, 0.08, 0.36],
    [0.93, 0.08, 1, 0.2],
  ],
  // MagSafe 3 at the back, then two USB-C, all on the left edge.
  ports: [
    [0, 0.09, 0.02, 0.16],
    [0, 0.19, 0.02, 0.24],
    [0, 0.26, 0.02, 0.31],
  ],
  jack: [0.96, 0.11, 0.99, 0.17],
  // Both speakers fire into the hinge gap.
  speakers: [
    [0.1, 0, 0.3, 0.06],
    [0.68, 0, 0.9, 0.06],
  ],
  antennas: [0.35, 0, 0.65, 0.03],
  // Three-mic array beside the left speaker at the hinge (estimated; the teardown table does not place it).
  mics: [0.305, 0.012, 0.345, 0.04],
  // Horseshoe around the trackpad: thick outer cells to the front edge, thin cells between board and trackpad.
  cells: [
    [0.03, 0.36, 0.28, 0.96],
    [0.29, 0.33, 0.49, 0.56],
    [0.51, 0.33, 0.71, 0.56],
    [0.72, 0.36, 0.97, 0.96],
  ],
  keyboard: [0.05, 0.07, 0.95, 0.52],
  trackpad: [0.3, 0.58, 0.7, 0.95],
  panel: [0.025, 0.03, 0.975, 0.95],
  notch: [0.448, 0.03, 0.552, 0.06],
} satisfies Record<string, Frac | Frac[]>

/** Below this hinge angle the lid reads as nearly closed. */
export const LID_NEARLY_CLOSED = 20
/**
 * Drawn tilt of the display layer, in degrees, for a real hinge angle. The drawn display is the lid opened flat
 * (180 degrees, notch at the back), so it folds up toward the viewer as the real lid closes. The fold is a fifth
 * of the real one so the stack stays readable: 110 degrees draws 14, and it stops at 32 when nearly closed.
 * A shut lid (clamshell mode) lies flat again, so the board stays in view.
 */
export const lidTilt = (deg: number) => (deg < 1 ? 0 : (180 - Math.min(180, Math.max(LID_NEARLY_CLOSED, deg))) / 5)
/** A shut lid while the page is being looked at means clamshell mode on an external display. */
export const lidLabel = (deg: number) =>
  deg < 1 ? 'Lid closed, using an external display' : deg < LID_NEARLY_CLOSED ? `Lid nearly closed, ${Math.round(deg)}°` : `Lid ${Math.round(deg)}°`

export type Lane = { pts: [number, number][]; kind: 'gpu' | 'cpu' | 'disk1' | 'disk2' | 'net'; len: number; segs: number[] }
function lane(kind: Lane['kind'], pts: [number, number][]): Lane {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  return { kind, pts, segs, len: segs.reduce((a, b) => a + b, 0) }
}

// Relative key widths per row, function row first (Touch ID last); the bottom row holds the space bar and arrows.
const ones = (n: number) => Array<number>(n).fill(1)
export const KEY_ROWS = [ones(14), [...ones(13), 1.5], [1.5, ...ones(13)], [1.8, ...ones(11), 1.8], [2.3, ...ones(10), 2.3], [1, 1, 1, 1.3, 5.2, 1.3, 1, 3]]

/** A real SoC package is about 26 x 32 mm, too small to show per-core activity, so it is drawn this much larger around its true centre. */
const SOC_ZOOM = 1.6

/** Every rectangle the scene draws, derived once per layout. */
export function geometry(L: typeof AIR) {
  const r = box(L.soc)
  const PKG = { x: r.x + (r.w * (1 - SOC_ZOOM)) / 2, y: r.y + (r.h * (1 - SOC_ZOOM)) / 2, w: r.w * SOC_ZOOM, h: r.h * SOC_ZOOM }
  // Package and die floorplans from the reference (estimated, after Apple's M3/M4 renders): die toward the hinge, DRAM in front.
  const DIE = sub(PKG, [0.1, 0.08, 0.9, 0.5])
  const DRAM = [sub(PKG, [0.08, 0.58, 0.47, 0.94]), sub(PKG, [0.53, 0.58, 0.92, 0.94])]
  const GPU_R = sub(DIE, [0.02, 0.04, 0.45, 0.62])
  const P_R = sub(DIE, [0.47, 0.04, 0.75, 0.3])
  const E_R = sub(DIE, [0.77, 0.04, 0.98, 0.22])
  const ANE_R = sub(DIE, [0.8, 0.26, 0.98, 0.52])
  // Blocks with no live counter, drawn dim for texture: SLC, media, display, secure enclave, memory PHYs, I/O.
  const DIE_STATIC = (
    [
      [0.47, 0.32, 0.78, 0.52],
      [0.47, 0.54, 0.7, 0.7],
      [0.7, 0.54, 0.85, 0.7],
      [0.85, 0.54, 1, 0.7],
      [0, 0.72, 0.5, 1],
      [0.5, 0.72, 0.85, 1],
      [0.85, 0.72, 1, 1],
    ] as Frac[]
  ).map((f) => sub(DIE, f))
  const NAND = box(L.nand)
  const WIFI = box(L.radio)
  const dramTop = DRAM[0].y + DRAM[0].h * 0.6
  const up = (R: Rect, f: number): [number, number][] => [
    [R.x + R.w * f, dramTop],
    [R.x + R.w * f, R.y + 2],
  ]
  const LANES: Lane[] = [
    // Memory traffic runs up from the DRAM packages into the blocks they feed.
    ...[0.12, 0.3, 0.48, 0.66, 0.84].map((f) => lane('gpu', up(GPU_R, f))),
    ...[0.15, 0.5, 0.85].map((f) => lane('cpu', up(P_R, f))),
    ...[0.3, 0.75].map((f) => lane('cpu', up(E_R, f))),
    lane('disk1', [[DIE.x + DIE.w - 3, DIE.y + DIE.h * 0.8], [NAND.x + NAND.w / 2, DIE.y + DIE.h * 0.8], [NAND.x + NAND.w / 2, NAND.y + NAND.h / 2]]),
    lane('disk2', [[DIE.x + DIE.w - 3, DIE.y + DIE.h * 0.9], [NAND.x + NAND.w * 0.75, DIE.y + DIE.h * 0.9], [NAND.x + NAND.w * 0.75, NAND.y + NAND.h / 2]]),
    lane('net', [[DIE.x + DIE.w - 3, DIE.y + 4], [WIFI.x + WIFI.w / 2, DIE.y + 4], [WIFI.x + WIFI.w / 2, WIFI.y + WIFI.h / 2]]),
  ]
  const KB = box(L.keyboard)
  const KEYS: Rect[] = KEY_ROWS.flatMap((row, ri) => {
    const gap = 4
    const fnH = 14
    const rowH = (KB.h - fnH - gap * (KEY_ROWS.length - 1)) / (KEY_ROWS.length - 1)
    const unit = (KB.w - (row.length - 1) * gap) / row.reduce((a, b) => a + b, 0)
    const y = ri === 0 ? KB.y : KB.y + fnH + gap + (ri - 1) * (rowH + gap)
    let x = KB.x
    return row.map((k) => {
      const k1 = { x, y, w: k * unit, h: ri === 0 ? fnH : rowH }
      x += k * unit + gap
      return k1
    })
  })
  const cells = L.cells.map(box)
  const tray = {
    x: Math.min(...cells.map((c) => c.x)),
    y: Math.min(...cells.map((c) => c.y)),
    w: Math.max(...cells.map((c) => c.x + c.w)) - Math.min(...cells.map((c) => c.x)),
    h: Math.max(...cells.map((c) => c.y + c.h)) - Math.min(...cells.map((c) => c.y)),
  }
  return {
    L,
    PKG,
    DIE,
    DRAM,
    GPU_R,
    P_R,
    E_R,
    ANE_R,
    DIE_STATIC,
    BOARD: box(L.board),
    PMU: box(L.pmic),
    NAND,
    WIFI,
    CONN: box(L.battConn),
    CELLS: cells,
    TRAY: tray,
    LANES,
    KEYS,
    SPEAKERS: L.speakers.map(box),
    TRACKPAD: box(L.trackpad),
  }
}
export type Geometry = ReturnType<typeof geometry>

/** r shrunk by d on every side. */
export const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) })

/** A zigzag of n legs up and down r: strain-gauge foil, a coil seen from the side, a meander antenna. */
export function serpentine(r: Rect, n: number): string {
  const legs = Math.max(2, n)
  const dx = r.w / (legs - 1)
  let d = `M ${r.x} ${r.y + r.h}`
  for (let i = 0; i < legs; i++) d += ` V ${i % 2 ? r.y + r.h : r.y}${i < legs - 1 ? ` H ${r.x + (i + 1) * dx}` : ''}`
  return d
}
