import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Hardware, Sample } from './types.ts'
import type { Lane } from './layout.ts'
import { clamp, memGB, rate, step, watts } from './format.ts'
import { clusterAvg, peakBandwidth, socW, usedBytes } from './story.ts'
import { drawTiles, useCanvasLoop, type Tile } from './loop.ts'
import { D, W, box, grid, sub, KEY_ROWS, type Geometry, type Rect, geometry, AIR } from './layout.ts'

const AIR_GEOMETRY = geometry(AIR)

export type View = 'chip' | 'memory' | 'battery' | 'io' | 'power'

// Scene box after projection, used to fit the stage.
const BOX_W = 740
const BOX_H = 556

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Maps a byte rate onto 0..1 on a log scale between lo and hi bytes per second. */
const logLevel = (bps: number, lo: number, hi: number) => (bps <= lo ? 0 : clamp(Math.log10(bps / lo) / Math.log10(hi / lo)))

function at(l: Lane, d: number): [number, number, number, number] {
  let i = 0
  while (i < l.segs.length - 1 && d > l.segs[i]) d -= l.segs[i++]
  const [a, b] = [l.pts[i], l.pts[i + 1]]
  const f = l.segs[i] ? clamp(d / l.segs[i]) : 0
  const dx = (b[0] - a[0]) / (l.segs[i] || 1)
  const dy = (b[1] - a[1]) / (l.segs[i] || 1)
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, dx, dy]
}

/** The SoC's core tiles for one sample. Colours are theme keys the canvas resolves: a accent, w GPU, b Neural Engine. */
function socTiles(g: Geometry, hw: Hardware, s: Sample): Tile[] {
  const tiles = (r: Rect, n: number, us: (number | null)[], color: string) => grid(n, r, 1).map((t, i) => ({ ...t, r: 0.8, u: us[i] ?? null, color }))
  return [
    ...tiles(g.GPU_R, hw.gpuCores ?? 1, Array(hw.gpuCores ?? 1).fill(s.gpu.usage), 'w'),
    ...tiles(g.P_R, hw.pCores, s.cpu.cores.filter((c) => c.kind === 'P').map((c) => c.usage), 'a'),
    ...tiles(g.E_R, hw.eCores, s.cpu.cores.filter((c) => c.kind === 'E').map((c) => c.usage), 'a'),
    ...tiles(g.ANE_R, hw.aneCores ?? 1, Array(hw.aneCores ?? 1).fill(s.power.aneW == null ? null : clamp(s.power.aneW / 4)), 'b'),
  ]
}

/** What the canvas loop reads each frame. Written once per sample. */
type Drive = { mem: number; llm: boolean; read: number; write: number; net: number; tiles: Tile[]; at: number; t: number }
type Particle = { l: Lane; d: number; v: number; back: boolean; a: number }

/**
 * Everything on the board that moves between samples: memory, disk and network particles, the SoC's
 * flickering cores and the NAND read and write flashes. One canvas, so the board's SVG stays static.
 */
function useBoardCanvas(canvas: React.RefObject<HTMLCanvasElement | null>, drive: React.RefObject<Drive>, g: Geometry, paused: boolean, stamp: number) {
  const st = useRef({ parts: [] as Particle[], rings: [] as { r: number; max: number }[], acc: new Map<Lane, number>(), ringAcc: 0, colors: { a: '', b: '', w: '' } })
  useCanvasLoop(
    canvas,
    W,
    (ctx, t, dt, still) => {
      const S = st.current
      const dr = drive.current
      // Theme colours change rarely; reading them every couple of seconds is enough.
      if (still || !S.colors.a || Math.floor(t / 2) !== Math.floor((t - dt) / 2)) {
        const cs = getComputedStyle(ctx.canvas)
        S.colors = { a: cs.getPropertyValue('--accent').trim(), b: cs.getPropertyValue('--accent-hi').trim(), w: cs.getPropertyValue('--accent-alt').trim() }
      }
      if (still) S.parts = []
      for (const l of g.LANES) {
        let r = 0
        let v = 60
        if (l.kind === 'gpu' || l.kind === 'cpu') {
          // Nothing at idle: display refresh and background work keep DRAM at roughly 5 to 15 GB/s, under 12% of peak.
          r = Math.max(0, dr.mem - 0.12) * 38 * (dr.llm ? (l.kind === 'gpu' ? 1.7 : 0.35) : 1)
          v = 28 + dr.mem * 70
        } else if (l.kind === 'net') {
          // Like memory, background chatter (under ~50 KB/s or ~1 MB/s of disk) sends nothing.
          r = Math.max(0, dr.net - 0.3) * 26
          v = 110
        } else {
          r = Math.max(0, dr.read + dr.write - 0.25) * 22
          v = 150
        }
        if (still) {
          // Reduced motion: a frozen, evenly spaced set of dots shows where data flows and how much.
          const count = Math.min(14, Math.round((r * l.len) / v))
          for (let k = 0; k < count; k++) S.parts.push({ l, d: ((k + 0.5) / count) * l.len, v: 0, back: false, a: 0.8 })
          continue
        }
        let n = (S.acc.get(l) ?? 0) + r * dt
        while (n >= 1) {
          n -= 1
          const back =
            l.kind === 'disk1' || l.kind === 'disk2'
              ? Math.random() < dr.read / (dr.read + dr.write + 1e-9) // reads flow NAND -> SoC
              : l.kind === 'net'
                ? Math.random() < 0.5
                : Math.random() < 0.3 // memory: more reads than writes
          S.parts.push({ l, d: 0, v: v * (0.8 + Math.random() * 0.4), back, a: 0.5 + Math.random() * 0.5 })
        }
        S.acc.set(l, n)
      }
      if (!still) {
        // Rings only for real traffic (about 50 KB/s and up), not background chatter.
        S.ringAcc += dt * (dr.net > 0.3 ? 0.4 + dr.net * 2.2 : 0)
        if (S.ringAcc >= 1) {
          S.ringAcc = 0
          S.rings.push({ r: 4, max: 22 + dr.net * 46 })
        }
      }

      ctx.clearRect(0, 0, W, D)
      drawTiles(ctx, dr.tiles.map((k) => ({ ...k, color: S.colors[k.color as 'a' | 'b' | 'w'] })), t, still)
      // NAND flashes fade over 0.9 s after each sample; held at their level under reduced motion.
      // Only real disk work flashes (about 1 MB/s and up); the background trickle stays dark.
      const fade = still ? 1 : Math.max(0, 1 - (performance.now() - dr.at) / 900)
      let flashing = false
      for (const [lvl, color] of [
        [dr.read, S.colors.a],
        [dr.write * 0.8, S.colors.w],
      ] as const) {
        if (lvl < 0.25 || lvl * fade < 0.01) continue
        flashing = true
        ctx.globalAlpha = lvl * fade
        ctx.fillStyle = color
        ctx.fillRect(g.NAND.x + 2, g.NAND.y + 2, g.NAND.w - 4, g.NAND.h - 12)
      }
      ctx.lineCap = 'round'
      S.parts = S.parts.filter((p) => (p.d += p.v * dt) < p.l.len)
      for (const p of S.parts) {
        const [x, y, dx, dy] = at(p.l, p.back ? p.l.len - p.d : p.d)
        const s = p.back ? -1 : 1
        const hot = dr.llm && p.l.kind === 'gpu'
        ctx.strokeStyle = hot ? S.colors.b : p.l.kind === 'cpu' || p.l.kind === 'gpu' ? S.colors.a : S.colors.w
        ctx.globalAlpha = p.a * (hot ? 1 : 0.8)
        ctx.lineWidth = hot ? 1.8 : 1.4
        ctx.beginPath()
        ctx.moveTo(x - dx * s * 5, y - dy * s * 5)
        ctx.lineTo(x, y)
        ctx.stroke()
      }
      const cx = g.WIFI.x + g.WIFI.w / 2
      const cy = g.WIFI.y + g.WIFI.h / 2
      S.rings = S.rings.filter((r) => (r.r += dt * 26) < r.max)
      ctx.lineWidth = 1.2
      for (const r of S.rings) {
        ctx.globalAlpha = 0.7 * (1 - r.r / r.max)
        ctx.strokeStyle = S.colors.w
        ctx.beginPath()
        ctx.ellipse(cx, cy, r.r * 1.3 + 20, r.r + 10, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // Particles, rings or a fading flash need smooth frames; flicker alone does not.
      return S.parts.length > 0 || S.rings.length > 0 || flashing
    },
    paused,
    stamp,
  )
}

function Hit({ view, label, r, onOpen, children }: { view: View; label: string; r: Rect; onOpen: Props['onOpen']; children?: React.ReactNode }) {
  // Mouse target only; keyboard users reach the same view through the billboard tag button.
  return (
    <g className="hit" onClick={(e) => onOpen(view, e.currentTarget)} aria-label={label}>
      {children}
      <rect className="hl" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={7} />
    </g>
  )
}

/** Warmth the SoC pushes into whatever it touches. Fanless Airs dump heat through the shield into the case. */
function HeatSpread({ g, rx, ry }: { g: Geometry; rx: number; ry: number }) {
  return <ellipse cx={g.PKG.x + g.PKG.w / 2} cy={g.PKG.y + g.PKG.h / 2} rx={rx} ry={ry} fill="url(#heat-spread)" className="heat-spread" />
}

const BottomCase = memo(function BottomCase({ g }: { g: Geometry }) {
  return (
    <g>
      <defs>
        <linearGradient id="alu" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--alu-1)" />
          <stop offset="1" stopColor="var(--alu-2)" />
        </linearGradient>
        {/* Drop shadows are drawn inside the SVG, so they are painted with the layer instead of being
            re-filtered by the compositor on every canvas frame. */}
        <filter id="layer-shadow" x="-10%" y="-10%" width="120%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <radialGradient id="heat-spread">
          <stop offset="0" stopColor="var(--heat-2)" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="var(--heat-1)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--heat-1)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="17" width={W - 2} height={D - 2} rx="20" fill="#000" opacity="0.45" filter="url(#layer-shadow)" />
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" fill="url(#alu)" stroke="var(--alu-edge)" />
      <rect x="9" y="9" width={W - 18} height={D - 18} rx="14" fill="none" stroke="var(--alu-edge)" opacity="0.6" />
      {[[36, 30], [W - 36, 30], [36, D - 30], [W - 36, D - 30]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="14" ry="10" fill="var(--alu-foot)" />
      ))}
      <HeatSpread g={g} rx={200} ry={150} />
    </g>
  )
})

const BoardStatic = memo(function BoardStatic({ g, chipShort, pCores, eCores, gpuCores, aneCores }: { g: Geometry; chipShort: string; pCores: number; eCores: number; gpuCores: number | null; aneCores: number | null }) {
  const ant = box(g.L.antennas)
  const jack = box(g.L.jack)
  return (
    <g>
      <defs>
        <linearGradient id="pcb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pcb-1)" />
          <stop offset="1" stopColor="var(--pcb-2)" />
        </linearGradient>
        <linearGradient id="spreader" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--die-1)" />
          <stop offset="0.5" stopColor="var(--die-2)" />
          <stop offset="1" stopColor="var(--die-1)" />
        </linearGradient>
        <linearGradient id="can" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--can-1)" />
          <stop offset="1" stopColor="var(--can-2)" />
        </linearGradient>
        <pattern id="vias" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.8" fill="var(--trace)" />
        </pattern>
        <pattern id="grille" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" fill="var(--alu-edge)" />
        </pattern>
        <pattern id="graphite" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--pcb-edge)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={g.BOARD.x} y={g.BOARD.y + 16} width={g.BOARD.w} height={g.BOARD.h} rx="5" fill="#000" opacity="0.45" filter="url(#layer-shadow)" />
      {/* Speakers fire into the hinge gap; the antennas sit behind the hinge cover between them. */}
      {g.L.speakers.map(box).map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y + 3} width={r.w} height={r.h - 3} rx="5" fill="var(--port)" stroke="var(--pcb-edge)" />
          <rect x={r.x + 4} y={r.y + 6} width={r.w - 8} height={r.h - 9} rx="3" fill="url(#grille)" />
        </g>
      ))}
      <rect x={ant.x} y={ant.y + 2} width={ant.w} height={ant.h - 2} rx="2" fill="none" stroke="var(--antenna)" strokeWidth="1.2" />
      {/* Port and audio daughterboards at the case edges. */}
      {g.L.sideBoards.map(box).map((r, i) => (
        <rect key={i} x={r.x + 2} y={r.y} width={r.w - 4} height={r.h} rx="4" fill="var(--side-board)" stroke="var(--pcb-edge)" />
      ))}
      {g.L.ports.map(box).map((r, i) => (
        <rect key={i} x={r.x - 2} y={r.y} width={r.w + 4} height={r.h} rx="3" fill="var(--port)" stroke="var(--chip-edge)" />
      ))}
      <circle cx={jack.x + jack.w / 2} cy={jack.y + jack.h / 2} r={Math.min(jack.w, jack.h) / 2} fill="var(--port)" stroke="var(--chip-edge)" />
      <rect x={g.BOARD.x} y={g.BOARD.y} width={g.BOARD.w} height={g.BOARD.h} rx="5" fill="url(#pcb)" stroke="var(--pcb-edge)" strokeWidth="1.2" />
      <rect x={g.BOARD.x} y={g.BOARD.y} width={g.BOARD.w} height={g.BOARD.h} rx="5" fill="url(#vias)" opacity="0.6" />
      <rect x={g.BOARD.x} y={g.BOARD.y} width={g.BOARD.w} height={g.BOARD.h} rx="5" fill="none" className="board-rim" />
      {/* Power: two PMICs, the charger and a bank of inductors. */}
      {grid(2, sub(g.PMU, [0.04, 0.06, 0.62, 0.46]), 5).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="2" fill="var(--chip)" stroke="var(--chip-edge)" />
      ))}
      <rect {...rectProps(sub(g.PMU, [0.68, 0.06, 0.96, 0.4]))} rx="2" fill="var(--chip)" stroke="var(--chip-edge)" />
      {grid(8, sub(g.PMU, [0.04, 0.56, 0.96, 0.96]), 4).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="2" fill="var(--inductor)" stroke="var(--chip-edge)" />
      ))}
      {/* Thin shield with graphite tape, no heatsink. */}
      <rect {...rectProps(box(g.L.shield))} rx="4" fill="url(#graphite)" className="shield" />
      {/* Lanes the particles travel; drawn faintly so the path is visible at rest. */}
      <g stroke="var(--lane)" strokeWidth="1" fill="none">
        {g.LANES.map((l, i) => (
          <polyline key={i} points={l.pts.map((p) => p.join(',')).join(' ')} />
        ))}
      </g>
      <rect x={g.NAND.x} y={g.NAND.y} width={g.NAND.w} height={g.NAND.h} rx="2.5" fill="var(--chip)" stroke="var(--chip-edge)" />
      <text x={g.NAND.x + g.NAND.w / 2} y={g.NAND.y + g.NAND.h - 5} className="etch" textAnchor="middle">
        NAND
      </text>
      <rect x={g.WIFI.x} y={g.WIFI.y} width={g.WIFI.w} height={g.WIFI.h} rx="2.5" fill="url(#can)" stroke="var(--chip-edge)" />
      <text x={g.WIFI.x + g.WIFI.w / 2} y={g.WIFI.y + g.WIFI.h / 2 + 2.5} className="etch" textAnchor="middle">
        N1
      </text>
      <rect x={g.CONN.x} y={g.CONN.y} width={g.CONN.w} height={g.CONN.h} rx="2" fill="var(--port)" stroke="var(--chip-edge)" />
      {/* SoC package: die toward the hinge, two DRAM packages in front of it on one substrate. */}
      <rect x={g.PKG.x} y={g.PKG.y} width={g.PKG.w} height={g.PKG.h} rx="5" fill="var(--substrate)" stroke="var(--chip-edge)" />
      {g.DRAM.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="2.5" fill="var(--chip)" stroke="var(--chip-edge)" />
          <text x={r.x + r.w / 2} y={r.y + r.h - 4} className="etch small" textAnchor="middle">
            LPDDR5X
          </text>
        </g>
      ))}
      <rect x={g.DIE.x - 1.5} y={g.DIE.y - 1.5} width={g.DIE.w + 3} height={g.DIE.h + 3} rx="3" fill="url(#spreader)" stroke="var(--chip-edge)" />
      {g.DIE_STATIC.map((r, i) => (
        <rect key={i} x={r.x + 0.6} y={r.y + 0.6} width={r.w - 1.2} height={r.h - 1.2} rx="1" className="die-block" />
      ))}
      {[
        // An unknown core count is drawn as one block, not a guessed number of cores.
        { r: g.GPU_R, n: gpuCores ?? 1, cls: 'tile gpu' },
        { r: g.P_R, n: pCores, cls: 'tile p' },
        { r: g.E_R, n: eCores, cls: 'tile e' },
        { r: g.ANE_R, n: aneCores ?? 1, cls: 'tile ane' },
      ].map(({ r, n, cls }) =>
        grid(n, r, 1).map((t, i) => <rect key={cls + i} className="tile-base" x={t.x} y={t.y} width={t.w} height={t.h} rx="0.8" />),
      )}
      <text x={g.PKG.x + g.PKG.w - 3} y={g.PKG.y + 6} className="etch small" textAnchor="end">
        {chipShort}
      </text>
    </g>
  )
})

const rectProps = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

function Board({ g, hw, s, llm, onOpen }: { g: Geometry; hw: Hardware; s: Sample; llm: boolean; onOpen: Props['onOpen'] }) {
  const chipShort = hw.chip.replace(/^Apple\s+/, '')
  const w = socW(s)
  // Without power numbers, glow from CPU and GPU usage instead.
  const glow = step(w != null ? w / 22 : ((clusterAvg(s, 'P') ?? 0) + (s.gpu.usage ?? 0)) / 1.6)
  const memRatio = step(usedBytes(s) / s.memory.totalBytes, 50)
  const cx = g.PKG.x + g.PKG.w / 2
  const cy = g.PKG.y + g.PKG.h / 2

  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg">
      <defs>
        <radialGradient id="glow">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <BoardStatic g={g} chipShort={chipShort} pCores={hw.pCores} eCores={hw.eCores} gpuCores={hw.gpuCores} aneCores={hw.aneCores} />
      <ellipse cx={cx} cy={cy} rx={g.PKG.w * 1.1} ry={g.PKG.h * 1.1} fill="url(#glow)" style={{ opacity: 0.12 + glow * 0.6 }} />
      {/* Core tiles and disk flashes are drawn on the board canvas; these change once per sample. */}
      <g className="live">
        {/* Memory packages fill with how much memory is in use. */}
        {g.DRAM.map((r, i) => (
          <rect key={i} x={r.x + 2} y={r.y + 2} width={(r.w - 4) * memRatio} height={r.h - 12} rx="1.5" className={`mem-fill ${llm ? 'hot' : ''}`} />
        ))}
        <rect {...rectProps(sub(g.PMU, [0.04, 0.06, 0.62, 0.46]))} rx="2" className="pmu-fill" style={{ opacity: step((s.power.systemW ?? w ?? 0) / 30) }} />
      </g>
      {llm && <rect className="llm-path" x={g.GPU_R.x - 2} y={g.GPU_R.y - 2} width={g.GPU_R.w + 4} height={g.DRAM[0].y + g.DRAM[0].h - g.GPU_R.y + 4} rx="3" />}
      <ellipse cx={cx} cy={cy} rx={g.PKG.w * 0.75} ry={g.PKG.h * 0.75} fill="url(#heat-spread)" className="haze" />
      <Hit view="chip" label={`${hw.chip} chip`} r={g.DIE} onOpen={onOpen} />
      {g.DRAM.map((r, i) => (
        <Hit key={i} view="memory" label="Unified memory" r={r} onOpen={onOpen} />
      ))}
      <Hit view="io" label="SSD storage" r={g.NAND} onOpen={onOpen} />
      <Hit view="io" label="Wi-Fi" r={g.WIFI} onOpen={onOpen} />
      <Hit view="power" label="Power delivery" r={g.PMU} onOpen={onOpen} />
    </svg>
  )
}

function BatteryLayer({ g, b, onOpen }: { g: Geometry; b: NonNullable<Sample['battery']>; onOpen: Props['onOpen'] }) {
  const f = clamp(b.percent / 100)
  const state = b.percent < 20 && !b.acAttached ? 'low' : b.chargeHeld ? 'held' : b.charging ? 'charging' : ''
  return (
    <g>
      <defs>
        <linearGradient id="cell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--cell-1)" />
          <stop offset="1" stopColor="var(--cell-2)" />
        </linearGradient>
      </defs>
      <rect {...rectProps(g.TRAY)} rx="12" fill="none" stroke="var(--cell-edge)" strokeDasharray="3 4" opacity="0.7" />
      {/* Trackpad cable from the board connector to the trackpad. */}
      <rect x={g.CONN.x + g.CONN.w / 2 - 6} y={g.CONN.y + g.CONN.h} width="12" height={box(g.L.trackpad).y - g.CONN.y - g.CONN.h} fill="var(--flex)" />
      <g className="hit" onClick={(e) => onOpen('battery', e.currentTarget)} aria-label="Battery">
        {g.CELLS.map((r, i) => {
          // Fill along the long side: tall outer cells fill from the front edge, wide inner cells from the left.
          const tall = r.h > r.w
          const fill = tall
            ? { x: r.x + 5, y: r.y + 5 + (r.h - 10) * (1 - f), w: r.w - 10, h: (r.h - 10) * f }
            : { x: r.x + 5, y: r.y + 5, w: (r.w - 10) * f, h: r.h - 10 }
          const cap = tall ? { x: r.x + 7, y: fill.y - 1.5, w: r.w - 14, h: 3 } : { x: fill.x + fill.w - 1.5, y: r.y + 7, w: 3, h: r.h - 14 }
          const mx = r.x + r.w / 2
          const my = r.y + r.h / 2
          return (
            <g key={i}>
              <rect {...rectProps(r)} rx="9" fill="url(#cell)" stroke="var(--cell-edge)" />
              <rect {...rectProps(fill)} rx="5" className={`cell-fill ${state}`} />
              <rect {...rectProps(cap)} rx="1.5" className={`cell-cap ${state}`} />
              {b.charging &&
                [0, 1, 2].map((k) => (
                  <path
                    key={k}
                    d={tall ? `M ${mx - 9} ${my + 22 - k * 16} l 9 -9 l 9 9` : `M ${r.x + 18 + k * 16} ${my - 9} l 9 9 l -9 9`}
                    className="chev"
                    style={{ animationDelay: `${k * 0.25}s` }}
                  />
                ))}
            </g>
          )
        })}
        <rect className="hl" x={g.TRAY.x - 3} y={g.TRAY.y - 3} width={g.TRAY.w + 6} height={g.TRAY.h + 6} rx="14" />
      </g>
    </g>
  )
}

const Deck = memo(function Deck({ g }: { g: Geometry }) {
  const tp = box(g.L.trackpad)
  const touchId = g.KEYS[KEY_ROWS[0].length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg ghost">
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" className="ghost-body" />
      {/* The top case is the heatsink: the SoC warms it through a thermal pad. */}
      <HeatSpread g={g} rx={150} ry={110} />
      {g.KEYS.map((k, i) => (
        <rect key={i} {...rectProps(k)} rx="3" className="ghost-key" />
      ))}
      <circle cx={touchId.x + touchId.w / 2} cy={touchId.y + touchId.h / 2} r={touchId.h / 2 - 2.5} className="ghost-line" />
      <rect {...rectProps(tp)} rx="12" className="ghost-line trackpad" />
    </svg>
  )
})

const Display = memo(function Display({ g }: { g: Geometry }) {
  const panel = box(g.L.panel)
  const n = box(g.L.notch)
  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg ghost">
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" className="ghost-body" />
      <rect {...rectProps(panel)} rx="10" className="ghost-line" />
      <path d={`M ${n.x} ${n.y} h ${n.w} v ${n.h - 5} q 0 5 -5 5 h ${-(n.w - 10)} q -5 0 -5 -5 z`} className="notch" />
    </svg>
  )
})

type Props = { hw: Hardware; s: Sample; systemW: number | null; llm: boolean; onOpen: (v: View, el: Element) => void; hidden?: boolean }

type CalloutKey = 'power' | 'memory' | 'wifi' | 'ssd' | 'battery'
/** Which side of the scene each label sits on, in reading order; the chip has the magnified inset instead. */
const SIDES: { left: CalloutKey[]; right: CalloutKey[] } = { left: ['power', 'memory'], right: ['wifi', 'ssd', 'battery'] }
const PILL_W = 132
const PILL_H = 44
/** Room kept clear at each side of the scene for the labels; they may overlap the outer glass edges. */
const SIDE_ROOM = 64
/** Strip kept clear along the bottom for the LLM note and the hint, so neither sits on the laptop. */
const FOOT_ROOM = 60
type Pt = { x: number; y: number }

/** A zero-size point on a layer. Its projected screen position is where a leader line ends. */
function Anchor({ k, r }: { k: string; r: Pt }) {
  return <div className="anchor" data-anchor={k} style={{ left: r.x, top: r.y }} />
}
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Stacks one side's labels near their anchors' heights without overlapping. */
function stack(keys: CalloutKey[], at: Partial<Record<CalloutKey, Pt>>, h: number): Partial<Record<CalloutKey, number>> {
  const out: Partial<Record<CalloutKey, number>> = {}
  let next = 8
  for (const k of [...keys].sort((a, b) => (at[a]?.y ?? 0) - (at[b]?.y ?? 0))) {
    const y = Math.min(h - PILL_H - 8, Math.max(next, (at[k]?.y ?? 0) - PILL_H / 2))
    out[k] = y
    next = y + PILL_H + 10
  }
  return out
}

export function Scene({ hw, s, systemW, llm, onOpen, hidden }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drive = useRef<Drive>({ mem: 0, llm: false, read: 0, write: 0, net: 0, tiles: [], at: 0, t: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [open, setOpen] = useState(reduced())
  const [at, setAt] = useState<Partial<Record<CalloutKey, Pt>>>({})
  const g = AIR_GEOMETRY
  const fit = Math.min((size.w - 2 * SIDE_ROOM) / BOX_W, (size.h - FOOT_ROOM) / BOX_H, 1.3)

  useLayoutEffect(() => {
    const el = stage.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (open) return
    const id = setTimeout(() => setOpen(true), 250)
    return () => clearTimeout(id)
  }, [open])
  // Anchors only move when the stage resizes or the layers finish sliding apart, so measure then, not every frame.
  useEffect(() => {
    const el = stage.current!
    const measure = () => {
      if (hidden) return
      const o = el.getBoundingClientRect()
      const next: Partial<Record<CalloutKey, Pt>> = {}
      for (const a of el.querySelectorAll<HTMLElement>('[data-anchor]')) {
        const r = a.getBoundingClientRect()
        next[a.dataset.anchor as CalloutKey] = { x: r.left - o.left, y: r.top - o.top }
      }
      setAt(next)
    }
    measure()
    el.addEventListener('transitionend', measure)
    return () => el.removeEventListener('transitionend', measure)
  }, [size, fit, open, hidden])

  // Bandwidth drives the memory particles; fall back to GPU, then CPU, when it is not available.
  const bw = s.memory.bandwidthGBs
  drive.current = {
    mem: bw != null ? clamp(bw / (peakBandwidth(hw.chip) ?? 140)) : (s.gpu.usage ?? clusterAvg(s, 'P') ?? 0),
    llm,
    read: logLevel(s.disk.readBps, 5e4, 3e9),
    write: logLevel(s.disk.writeBps, 5e4, 3e9),
    net: logLevel(s.net.rxBps + s.net.txBps, 2e3, 1e8),
    tiles: socTiles(g, hw, s),
    // The NAND flash fades from when this sample arrived, not from the last re-render.
    at: drive.current.t === s.t ? drive.current.at : performance.now(),
    t: s.t,
  }
  useBoardCanvas(canvas, drive, g, !!hidden, s.t)

  const b = s.battery
  const t = s.thermal.cpuTempC
  // Drives every heat layer through one CSS variable, so the static case and top case never re-render.
  const heat = t != null ? step((t - 45) / 50) : ({ nominal: 0.1, fair: 0.4, serious: 0.7, critical: 1 } as const)[s.thermal.state]
  const labels: Record<CalloutKey, { view: View; title: string; value: string } | null> = {
    power: { view: 'power', title: 'Power', value: watts(systemW ?? socW(s)) },
    memory: { view: 'memory', title: 'Memory', value: `${memGB(usedBytes(s))} / ${memGB(s.memory.totalBytes, 0)}` },
    wifi: { view: 'io', title: 'Wi-Fi', value: rate(s.net.rxBps + s.net.txBps) },
    ssd: { view: 'io', title: 'SSD', value: rate(s.disk.readBps + s.disk.writeBps) },
    battery: b ? { view: 'battery', title: 'Battery', value: `${Math.round(b.percent)}%${b.chargeHeld ? ' · held' : b.charging ? ' · charging' : ''}` } : null,
  }
  const ys = { ...stack(SIDES.left, at, size.h), ...stack(SIDES.right, at, size.h) }
  const ant = box(g.L.antennas)
  return (
    <div className={`stage ${hidden ? 'stage-hidden' : ''}`} ref={stage}>
      <div className="scene" style={{ width: BOX_W, height: BOX_H, transform: `translate(-50%, calc(-50% - ${FOOT_ROOM / 2}px)) scale(${Math.max(0.1, fit)})` }}>
        <div className={`iso ${open ? 'open' : ''} ${llm ? 'llm' : ''}`} style={{ width: W, height: D, '--heat': heat } as CSSProperties}>
          <div className="ground" />
          <div className="layer" style={{ '--zc': '0px', '--zo': '0px' } as CSSProperties}>
            <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg">
              <BottomCase g={g} />
              {b && <BatteryLayer g={g} b={b} onOpen={onOpen} />}
            </svg>
            <Anchor k="battery" r={centre(g.CELLS[3])} />
          </div>
          <div className="layer" style={{ '--zc': '6px', '--zo': '55px' } as CSSProperties}>
            <Board g={g} hw={hw} s={s} llm={llm} onOpen={onOpen} />
            <canvas ref={canvas} className="particles" style={{ width: W, height: D }} />
            <Anchor k="power" r={centre(g.PMU)} />
            <Anchor k="memory" r={centre(g.DRAM[0])} />
            <Anchor k="ssd" r={centre(g.NAND)} />
            <Anchor k="wifi" r={{ x: ant.x + ant.w, y: ant.y + ant.h / 2 }} />
            <Anchor k="soc" r={centre(g.PKG)} />
          </div>
          <div className="layer" style={{ '--zc': '10px', '--zo': '175px' } as CSSProperties}>
            <Deck g={g} />
          </div>
          <div className="layer" style={{ '--zc': '14px', '--zo': '255px' } as CSSProperties}>
            <Display g={g} />
          </div>
        </div>
      </div>
      {/* Labels sit at the sides with leader lines, so nothing covers the board or the chip. */}
      <div className={`callouts ${open ? 'open' : ''}`}>
        <svg className="leaders" width={size.w} height={size.h}>
          {(['left', 'right'] as const).flatMap((side) =>
            SIDES[side].map((k) => {
              const a = at[k]
              const y = ys[k]
              if (!a || y == null || !labels[k]) return null
              const x = side === 'left' ? 12 + PILL_W : size.w - 12 - PILL_W
              return (
                <g key={k}>
                  <path d={`M ${x} ${y + PILL_H / 2} H ${x + (side === 'left' ? 14 : -14)} L ${a.x} ${a.y}`} className="leader" />
                  <circle cx={a.x} cy={a.y} r="3" className="leader-dot" />
                </g>
              )
            }),
          )}
        </svg>
        {(['left', 'right'] as const).flatMap((side) =>
          // Top to bottom, so Tab follows what the eye sees.
          [...SIDES[side]].sort((a, b) => (ys[a] ?? 0) - (ys[b] ?? 0)).map((k) => {
            const l = labels[k]
            const y = ys[k]
            if (!l || y == null || !at[k]) return null
            return (
              <button
                key={k}
                className="callout"
                style={{ top: y, [side]: 12, width: PILL_W, height: PILL_H }}
                aria-label={`${l.title}, ${l.value}. Open details.`}
                onClick={(e) => onOpen(l.view, e.currentTarget)}
              >
                <span className="tag-title">{l.title}</span>
                <span className="tag-value">{l.value}</span>
              </button>
            )
          }),
        )}
      </div>
      {llm && <div className="llm-note">Highlighted path: model weights stream from memory into the GPU for every token.</div>}
    </div>
  )
}
