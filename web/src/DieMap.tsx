import { useRef, type CSSProperties } from 'react'
import type { Hardware, Sample } from './types.ts'
import { NA, clamp, gpuMhz, mhz, num, pct, step } from './format.ts'
import { grid, sub, type Frac, type Rect } from './layout.ts'
import { peakBandwidth } from './story.ts'
import { drawTiles, useCanvasLoop, type Tile } from './loop.ts'
import { InfoButton } from './Learn.tsx'
import { useSimple } from './simple.ts'

// Base M-series die block plan from docs/teardown-reference.md (estimated, after Apple's M3/M4 renders).
// Die-local fractions, about 1.25:1, memory interfaces along the bottom edge facing the DRAM.
const VW = 600
const VH = 480
const DIE: Rect = { x: 0, y: 0, w: VW, h: VH }
const PLAN = {
  gpu: [0, 0, 0.45, 0.62],
  tiler: [0, 0.62, 0.45, 0.7],
  p: [0.47, 0, 0.75, 0.3],
  e: [0.77, 0, 1, 0.22],
  slc: [0.47, 0.32, 0.8, 0.52],
  ane: [0.8, 0.24, 1, 0.52],
  media: [0.47, 0.54, 0.7, 0.7],
  display: [0.7, 0.54, 0.85, 0.7],
  secure: [0.85, 0.54, 1, 0.7],
  memA: [0, 0.72, 0.5, 1],
  memB: [0.5, 0.72, 0.85, 1],
  io: [0.85, 0.72, 1, 1],
} satisfies Record<string, Frac>
/** Which explainer each block's info button opens (panel mode only; the inset is too small for them). */
const BLOCK_TOPICS: { k: keyof typeof PLAN; topic: string }[] = [
  { k: 'gpu', topic: 'gpu' },
  { k: 'p', topic: 'p-cores' },
  { k: 'e', topic: 'e-cores' },
  { k: 'ane', topic: 'neural-engine' },
  { k: 'slc', topic: 'system-cache' },
  { k: 'media', topic: 'media-engine' },
  { k: 'display', topic: 'display-engine' },
  { k: 'secure', topic: 'secure-enclave' },
  { k: 'memA', topic: 'memory-interface' },
  { k: 'io', topic: 'io-block' },
]
const GAP = 6
const block = (f: Frac): Rect => {
  const r = sub(DIE, f)
  return { x: r.x + GAP / 2, y: r.y + GAP / 2, w: r.w - GAP, h: r.h - GAP }
}
const inner = (r: Rect, top: number): Rect => ({ x: r.x + 8, y: r.y + top, w: r.w - 16, h: r.h - top - 8 })

/** Tiles above this count are too small to print a percentage on; the tooltip and label still carry it. */
const MAX_PRINTED = 16

type Core = Sample['cpu']['cores'][number]
type Props = {
  hw: Hardware
  s: Sample
  /** Panel mode: cores become focusable and report themselves; percentages and clocks are printed. */
  onCore?: (text: string | null) => void
  /** Stops the flicker loop, for example while the inset is hidden behind an open panel. */
  paused?: boolean
}
/** Short block names for the small inset, where the full ones would not fit at a readable size. */
const SHORT: Record<string, string> = { 'System cache': 'Cache', 'Memory interface': 'Memory', Display: 'Disp.', Secure: 'SE', 'Shared shelf': 'Shelf', 'Door to Desk Space': 'Desk', 'AI team': 'AI' }
const short = (title: string) => {
  const base = title.replace(/ × \d+$/, '')
  return SHORT[base] ?? base
}

/** Tile colours come from the --die-* tokens, so the die follows the light and dark themes. */
type Hue = 'p' | 'e' | 'gpu' | 'ane'

/**
 * The die, drawn from the block plan, with every core flickering at its own load. Used by the overview inset
 * and the chip panel. Blocks and labels are SVG and change once per sample; the flickering fills are drawn on
 * a canvas above them by the shared paced loop in loop.ts. In panel mode a second SVG on top carries the focusable
 * cores and their percentages.
 */
export function DieMap({ hw, s, onCore, paused = false }: Props) {
  const detail = onCore != null
  const simple = useSimple()
  const p = s.cpu.cores.filter((c) => c.kind === 'P')
  const e = s.cpu.cores.filter((c) => c.kind === 'E')
  const bw = s.memory.bandwidthGBs
  const peak = peakBandwidth(hw.chip) ?? 140
  const B = Object.fromEntries(Object.entries(PLAN).map(([k, f]) => [k, block(f)])) as Record<keyof typeof PLAN, Rect>
  const ane = s.power.aneW == null ? null : clamp(s.power.aneW / 4)

  const label = (r: Rect, title: string, value?: string) => (
    <text x={r.x + 10} y={r.y + (detail ? 20 : 26)} className="dm-title">
      {detail ? title : short(title)}
      {detail && value != null && (
        <tspan className={value === NA ? 'dm-na' : 'dm-value'} dx="7">
          {value}
        </tspan>
      )}
    </text>
  )
  // Unknown core counts draw one block; unknown load draws dim and still, not idle.
  const gpuTiles = grid(hw.gpuCores ?? 1, inner(B.gpu, 34), 6).map((t) => ({ ...t, r: 4, u: s.gpu.usage, color: 'gpu' }))
  const pTiles = grid(p.length, inner(B.p, 32), 6).map((t, i) => ({ ...t, r: 5, u: p[i].usage, color: 'p' }))
  const eTiles = grid(e.length, inner(B.e, 32), 6).map((t, i) => ({ ...t, r: 5, u: e[i].usage, color: 'e' }))
  const aneTiles = grid(hw.aneCores ?? 1, inner(B.ane, 32), 4).map((t) => ({ ...t, r: 4, u: ane, color: 'ane' }))
  const tiles: Tile[] = [...gpuTiles, ...pTiles, ...eTiles, ...aneTiles]
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const canvas = useRef<HTMLCanvasElement>(null)
  const colors = useRef({ at: -1, c: {} as Record<Hue, string> })
  useCanvasLoop(
    canvas,
    VW + 12,
    (ctx, t, _dt, still) => {
      // Theme colours change rarely; reading them every couple of seconds is enough.
      if (still || t - colors.current.at > 2) {
        const cs = getComputedStyle(ctx.canvas)
        colors.current = { at: t, c: { p: cs.getPropertyValue('--die-p'), e: cs.getPropertyValue('--die-e'), gpu: cs.getPropertyValue('--die-gpu'), ane: cs.getPropertyValue('--die-ane') } }
      }
      ctx.clearRect(0, 0, VW + 12, VH + 12)
      ctx.save()
      ctx.translate(6, 6)
      drawTiles(ctx, tilesRef.current.map((k) => ({ ...k, color: colors.current.c[k.color as Hue] })), t, still)
      ctx.restore()
    },
    paused,
    s.t,
  )
  const count = (name: string, n: number | null) => (n == null ? name : `${name} × ${n}`)
  const core = (c: Core, t: Rect, kind: 'p' | 'e', freq: number | null, many: boolean) => {
    const name = `${kind === 'p' ? 'Performance' : 'Efficiency'} core ${c.id}`
    const text = `${name}: ${pct(c.usage)} busy, cluster at ${mhz(freq)}`
    return (
      <g
        key={c.id}
        className="core-g"
        tabIndex={0}
        aria-label={`${name}, ${pct(c.usage)}`}
        onMouseEnter={() => onCore?.(text)}
        onMouseLeave={() => onCore?.(null)}
        onFocus={() => onCore?.(text)}
        onBlur={() => onCore?.(null)}
      >
        <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="5" className="dm-hit" />
        {!many && (
          <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 5} textAnchor="middle" className="dm-pct">
            {pct(c.usage)}
          </text>
        )}
      </g>
    )
  }
  const box = `-6 -6 ${VW + 12} ${VH + 12}`

  return (
    <div className="die-wrap">
      <svg viewBox={box} className="die-map" role="img" aria-label={`${hw.chip} die, live`}>
        <rect x="-6" y="-6" width={VW + 12} height={VH + 12} rx="16" className="dm-die" />
        {(Object.keys(PLAN) as (keyof typeof PLAN)[]).map((k) => (
          <rect key={k} {...{ x: B[k].x, y: B[k].y, width: B[k].w, height: B[k].h }} rx="8" className="dm-block" />
        ))}
        {tiles.map((t, i) => (
          <rect key={i} x={t.x} y={t.y} width={t.w} height={t.h} rx={t.r} className="dm-base" />
        ))}
        {label(B.gpu, count(simple ? 'Graphics' : 'GPU', hw.gpuCores), s.gpu.usage == null ? NA : simple ? pct(s.gpu.usage) : `${pct(s.gpu.usage)} · ${gpuMhz(s.gpu.freqMHz)}`)}
        {label(B.p, `${simple ? 'Fast' : 'P'} × ${hw.pCores}`, simple ? undefined : mhz(s.cpu.pFreqMHz))}
        {label(B.e, `${simple ? 'Eco' : 'E'} × ${hw.eCores}`, simple ? undefined : mhz(s.cpu.eFreqMHz))}
        {label(B.ane, count(simple ? 'AI team' : 'ANE', hw.aneCores))}
        {label(B.slc, simple ? 'Shared shelf' : 'System cache')}
        {label(B.media, simple ? 'Video' : 'Media')}
        {label(B.display, simple ? 'Screen' : 'Display')}
        {label(B.secure, simple ? 'Safe' : 'Secure')}
        {label(B.io, simple ? 'Ports' : 'I/O')}
        {[B.memA, B.memB].map((r, i) => (
          <g key={i}>
            <rect x={r.x + 8} y={r.y + 30} width={r.w - 16} height={r.h - 38} rx="5" className="dm-phy" style={{ '--u': bw == null ? 0.05 : step(bw / peak) } as CSSProperties} />
            {label(r, simple ? 'Door to Desk Space' : 'Memory interface', i === 0 && !simple ? (bw == null ? NA : `${num(bw)} GB/s`) : undefined)}
          </g>
        ))}
      </svg>
      <canvas ref={canvas} className="die-canvas" aria-hidden />
      {detail && (
        <svg viewBox={box} className="die-cores">
          {pTiles.map((t, i) => core(p[i], t, 'p', s.cpu.pFreqMHz, p.length > MAX_PRINTED))}
          {eTiles.map((t, i) => core(e[i], t, 'e', s.cpu.eFreqMHz, e.length > MAX_PRINTED))}
        </svg>
      )}
      {/* Pinned to each block's top right corner, in the strip above its tiles. */}
      {detail &&
        BLOCK_TOPICS.map(({ k, topic }) => (
          <span
            key={k}
            className="die-info"
            style={{ left: `calc(${((B[k].x + B[k].w + 6) / (VW + 12)) * 100}% - 24px)`, top: `calc(${((B[k].y + 6) / (VH + 12)) * 100}% + 2px)` }}
          >
            <InfoButton topic={topic} />
          </span>
        ))}
    </div>
  )
}
