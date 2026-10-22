// Pure models behind the GPU lab: per-pixel rules, SIMD groups of 32, and how long a serial painter and a
// grid of lockstep groups take to paint the same picture.

/** Apple GPUs run threads in SIMD-groups of 32 (Apple, WWDC22; threadExecutionWidth is 32 on this Mac). */
export const SIMD = 32
/** Each group covers an 8 by 4 block of pixels. */
export const GW = 8
export const GH = 4

export type Shade = { v: number; work: number }
export type PresetId = 'gradient' | 'circle' | 'checker' | 'mandel'
export const MAX_IT = 48

export const PRESETS: { id: PresetId; label: string; plain: string; code: string; shade: (x: number, y: number, w: number, h: number) => Shade }[] = [
  {
    id: 'gradient',
    label: 'Gradient',
    plain: 'Fade',
    code: 'color = x / width',
    shade: (x, _y, w) => ({ v: x / (w - 1), work: 1 }),
  },
  {
    id: 'circle',
    label: 'Circle',
    plain: 'Circle',
    code: 'color = (dx*dx + dy*dy < r*r) ? 1 : 0',
    shade: (x, y, w, h) => {
      const dx = x + 0.5 - w / 2
      const dy = y + 0.5 - h / 2
      const r = Math.min(w, h) * 0.4
      return { v: dx * dx + dy * dy < r * r ? 1 : 0, work: 1 }
    },
  },
  {
    id: 'checker',
    label: 'Checkerboard',
    plain: 'Checks',
    code: 'color = ((x / 8) + (y / 8)) % 2',
    shade: (x, y) => ({ v: (Math.floor(x / 8) + Math.floor(y / 8)) % 2, work: 1 }),
  },
  {
    id: 'mandel',
    label: 'Mandelbrot',
    plain: 'Mandelbrot',
    code: `z = 0; for (i = 0; i < ${MAX_IT} && |z| < 2; i++) z = z*z + c; color = i / ${MAX_IT}`,
    shade: (x, y, w, h) => {
      const cr = -2.2 + (3 * (x + 0.5)) / w
      const ci = -1.2 + (2.4 * (y + 0.5)) / h
      let zr = 0
      let zi = 0
      let i = 0
      for (; i < MAX_IT && zr * zr + zi * zi < 4; i++) {
        const t = zr * zr - zi * zi + cr
        zi = 2 * zr * zi + ci
        zr = t
      }
      return { v: i / MAX_IT, work: Math.max(1, i) }
    },
  },
]

export function render(id: PresetId, w: number, h: number): Shade[] {
  const p = PRESETS.find((x) => x.id === id)!
  const out: Shade[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(p.shade(x, y, w, h))
  return out
}

/** Pixel indices of each 8 x 4 group, groups in row-major order. Width and height must be multiples of 8 and 4. */
export function groups(w: number, h: number): number[][] {
  if (w % GW || h % GH) throw new Error('size must be a multiple of the group shape')
  const out: number[][] = []
  for (let gy = 0; gy < h; gy += GH)
    for (let gx = 0; gx < w; gx += GW) {
      const g: number[] = []
      for (let y = gy; y < gy + GH; y++) for (let x = gx; x < gx + GW; x++) g.push(y * w + x)
      out.push(g)
    }
  return out
}

/** One painter, one pixel at a time: each pixel finishes after all the work before it. */
export function serial(work: number[]): { finish: number[]; total: number } {
  let t = 0
  const finish = work.map((w) => (t += w))
  return { finish, total: t }
}

/**
 * Groups of 32 lanes in lockstep, `cores` groups at a time, handed out in order to whichever core frees up
 * first. A group takes as long as its slowest lane; the others sit masked off until it is done.
 * `issued` counts lane-ticks the hardware spent, `useful` the ones that did real work.
 */
export function parallel(work: number[], w: number, h: number, cores: number): { finish: number[]; total: number; useful: number; issued: number } {
  const free = Array(Math.max(1, cores)).fill(0)
  const finish = Array(work.length).fill(0)
  let useful = 0
  let issued = 0
  for (const g of groups(w, h)) {
    const cost = Math.max(...g.map((i) => work[i]))
    const c = free.indexOf(Math.min(...free))
    const end = free[c] + cost
    free[c] = end
    for (const i of g) finish[i] = end
    useful += g.reduce((a, i) => a + work[i], 0)
    issued += cost * g.length
  }
  return { finish, total: Math.max(0, ...free), useful, issued }
}

export type Pt = [number, number]
/** Is a point inside the triangle? Edge functions, the test a rasterizer runs at each pixel centre. */
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const e = (u: Pt, v: Pt) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0])
  const d1 = e(a, b)
  const d2 = e(b, c)
  const d3 = e(c, a)
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)
}

/** Lanes of a group that take the `if` side and the `else` side, and the passes the group needs. */
export function diverge(cond: boolean[]): { yes: number; no: number; passes: number } {
  const yes = cond.filter(Boolean).length
  const no = cond.length - yes
  return { yes, no, passes: (yes ? 1 : 0) + (no ? 1 : 0) }
}
