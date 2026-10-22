import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Hardware, Sample } from './types.ts'
import type { Lane } from './layout.ts'
import type { Live } from './useStream.ts'
import { clamp, memGB, rate, step, watts } from './format.ts'
import { clusterAvg, peakBandwidth, sensorsOf, socW, usedBytes } from './story.ts'
import { drawTiles, useCanvasLoop, type Tile } from './loop.ts'
import { InfoButton } from './Learn.tsx'
import { useSimple } from './simple.ts'
import { D, W, box, grid, sub, KEY_ROWS, LID_NEARLY_CLOSED, lidLabel, lidTilt, type Geometry, type Rect, geometry, AIR } from './layout.ts'
import { PARTS, type PartKey } from './parts.ts'
import { DEFAULT_EXPLODE } from './orbit.ts'
import { FocusCard, OrbitControls, useOrbit, useOrbitInput } from './Orbit.tsx'
import { BatteryDetail, BoardDetail, CameraDetail, ChargeFlow, DisplayDetail, TrackpadDetail } from './Detail.tsx'
import { mediaOf } from './inside.ts'

const AIR_GEOMETRY = geometry(AIR)

export type View = 'chip' | 'memory' | 'battery' | 'io' | 'power' | 'sensors' | 'learn' | 'play' | 'lesson' | 'labs'

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
type Drive = { mem: number; llm: boolean; read: number; write: number; net: number; tiles: Tile[]; at: number; t: number; audio: boolean }
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
      if (dr.audio) {
        // Speaker grilles breathe while audio plays; on the board's idle clock, so it costs no extra frames.
        ctx.globalAlpha = still ? 0.3 : 0.16 + 0.2 * (0.5 + 0.5 * Math.sin(t * 5.3))
        ctx.fillStyle = S.colors.b
        for (const r of g.SPEAKERS) {
          ctx.beginPath()
          ctx.roundRect(r.x + 3, r.y + 5, r.w - 6, r.h - 7, 3)
          ctx.fill()
        }
      }
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

/**
 * A pointer target for one part. The stage's pointer handler finds it by data-part (see useOrbitInput), so a press
 * can still become a drag. Keyboard users reach the same parts through the toolbar's part list and the labels.
 */
function Hit({ part, r, rx = 7 }: { part: PartKey; r: Rect; rx?: number }) {
  return (
    <g className="hit" data-part={part}>
      <rect className="hl" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={rx} />
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
  const simple = useSimple()
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
        {simple ? 'Storage' : 'NAND'}
      </text>
      <rect x={g.WIFI.x} y={g.WIFI.y} width={g.WIFI.w} height={g.WIFI.h} rx="2.5" fill="url(#can)" stroke="var(--chip-edge)" />
      <text x={g.WIFI.x + g.WIFI.w / 2} y={g.WIFI.y + g.WIFI.h / 2 + 2.5} className="etch" textAnchor="middle">
        {simple ? 'Radio' : 'N1'}
      </text>
      <rect x={g.CONN.x} y={g.CONN.y} width={g.CONN.w} height={g.CONN.h} rx="2" fill="var(--port)" stroke="var(--chip-edge)" />
      {/* SoC package: die toward the hinge, two DRAM packages in front of it on one substrate. */}
      <rect x={g.PKG.x} y={g.PKG.y} width={g.PKG.w} height={g.PKG.h} rx="5" fill="var(--substrate)" stroke="var(--chip-edge)" />
      {g.DRAM.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="2.5" fill="var(--chip)" stroke="var(--chip-edge)" />
          <text x={r.x + r.w / 2} y={r.y + r.h - 4} className="etch small" textAnchor="middle">
            {simple ? 'Desk Space' : 'LPDDR5X'}
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

function Board({ g, hw, s, llm, mic, focus }: { g: Geometry; hw: Hardware; s: Sample; llm: boolean; mic: boolean; focus: PartKey | null }) {
  const mics = box(g.L.mics)
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
      {/* Three-mic array by the hinge; orange while an app records, like the macOS indicator. */}
      <g className={`mics ${mic ? 'on' : ''}`}>
        {mic && <ellipse cx={mics.x + mics.w / 2} cy={mics.y + mics.h / 2} rx={mics.w} ry={mics.h * 1.4} className="mic-halo" />}
        {[0.15, 0.5, 0.85].map((f) => (
          <circle key={f} cx={mics.x + mics.w * f} cy={mics.y + mics.h / 2} r="2.2" className="mic" />
        ))}
      </g>
      {llm && <rect className="llm-path" x={g.GPU_R.x - 2} y={g.GPU_R.y - 2} width={g.GPU_R.w + 4} height={g.DRAM[0].y + g.DRAM[0].h - g.GPU_R.y + 4} rx="3" />}
      <ellipse cx={cx} cy={cy} rx={g.PKG.w * 0.75} ry={g.PKG.h * 0.75} fill="url(#heat-spread)" className="haze" />
      {focus && PARTS[focus].layer === 1 && <BoardDetail k={focus} g={g} hw={hw} s={s} />}
      <Hit part="soc" r={g.DIE} />
      {g.DRAM.map((r, i) => (
        <Hit key={i} part="memory" r={r} />
      ))}
      <Hit part="ssd" r={g.NAND} />
      <Hit part="wifi" r={g.WIFI} />
      <Hit part="power" r={g.PMU} />
      {g.SPEAKERS.map((r, i) => (
        <Hit key={i} part="speakers" r={r} />
      ))}
    </svg>
  )
}

function BatteryLayer({ g, b }: { g: Geometry; b: NonNullable<Sample['battery']> }) {
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
      <g className="hit" data-part="battery">
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

const Deck = memo(function Deck({ g, kb, detail }: { g: Geometry; kb: number; detail: boolean }) {
  const tp = g.TRACKPAD
  const touchId = g.KEYS[KEY_ROWS[0].length - 1]
  const kbr = box(g.L.keyboard)
  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg ghost" style={{ '--kb': kb } as CSSProperties}>
      <defs>
        <radialGradient id="backlight">
          <stop offset="0" stopColor="var(--key-glow)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--key-glow)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" className="ghost-body" />
      {/* The top case is the heatsink: the SoC warms it through a thermal pad. */}
      <HeatSpread g={g} rx={150} ry={110} />
      {kb > 0 && <ellipse cx={kbr.x + kbr.w / 2} cy={kbr.y + kbr.h / 2} rx={kbr.w * 0.6} ry={kbr.h * 0.75} fill="url(#backlight)" className="backlight" />}
      {g.KEYS.map((k, i) => (
        <rect key={i} {...rectProps(k)} rx="3" className="ghost-key" />
      ))}
      <circle cx={touchId.x + touchId.w / 2} cy={touchId.y + touchId.h / 2} r={touchId.h / 2 - 2.5} className="ghost-line" />
      <rect {...rectProps(tp)} rx="12" className="ghost-line trackpad" />
      {detail && <TrackpadDetail g={g} />}
      <Hit part="trackpad" r={tp} rx={14} />
    </svg>
  )
})

const Display = memo(function Display({
  g,
  glow,
  camera,
  mic,
  focus,
  isp,
}: {
  g: Geometry
  glow: number | null
  camera: boolean
  mic: boolean
  /** The focused part when it is on the lid; only then are the close-up drawings mounted. */
  focus: 'display' | 'camera' | null
  isp: number | null
}) {
  const panel = box(g.L.panel)
  const n = box(g.L.notch)
  const cx = n.x + n.w / 2
  const cy = n.y + n.h / 2
  // macOS shows one dot in the menu bar: green while the camera runs (with or without the mic), orange for the mic alone.
  const dot = camera ? 'cam' : mic ? 'mic' : null
  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg ghost">
      <defs>
        <linearGradient id="screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--screen-1)" />
          <stop offset="1" stopColor="var(--screen-2)" />
        </linearGradient>
        <radialGradient id="cam-halo">
          <stop offset="0" stopColor="var(--cam)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--cam)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" className="ghost-body" />
      {glow != null && <rect {...rectProps(panel)} rx="10" fill="url(#screen)" className="screen-glow" style={{ opacity: 0.05 + glow * 0.3 }} />}
      <rect {...rectProps(panel)} rx="10" className="ghost-line" />
      <path d={`M ${n.x} ${n.y} h ${n.w} v ${n.h - 5} q 0 5 -5 5 h ${-(n.w - 10)} q -5 0 -5 -5 z`} className="notch" />
      {camera && <circle cx={cx} cy={cy} r="14" fill="url(#cam-halo)" />}
      <circle cx={cx} cy={cy} r="3" className={`lens ${camera ? 'on' : ''}`} />
      {dot && <circle cx={n.x + n.w + 12} cy={cy} r="3.2" className={`menu-dot ${dot}`} />}
      {focus === 'display' && <DisplayDetail g={g} brightness={glow} />}
      {focus === 'camera' && <CameraDetail g={g} on={camera} isp={isp} />}
      <Hit part="display" r={panel} rx={12} />
      <Hit part="camera" r={n} rx={5} />
    </svg>
  )
})

const PAD = 14
const TRAIL_MS = 260
/** A finger with no fast message for this long counts as lifted: a backlogged socket can drop the lift message. */
const STALE_MS = 250

/**
 * The fast channel: trackpad fingers drawn on a small canvas over the drawn trackpad, and the lid eased toward its
 * reading. Runs on the shared loop at 36 fps while a finger is down, 18 while the lid moves, and sleeps otherwise.
 */
function useFastLayer(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  lidEl: React.RefObject<HTMLDivElement | null>,
  tag: React.RefObject<HTMLSpanElement | null>,
  live: Live,
  tp: Rect,
  paused: boolean,
  stamp: number,
) {
  const st = useRef({ lid: null as number | null, shown: '', seen: 0, drawn: false, trails: new Map<number, { x: number; y: number; t: number }[]>(), color: '', colorAt: -9 })
  const wake = useCanvasLoop(
    canvas,
    tp.w + 2 * PAD,
    (ctx, t, dt, still) => {
      const S = st.current
      const now = performance.now()
      const target = live.lid
      if (target == null || S.lid == null || still) S.lid = target
      else S.lid = Math.abs(target - S.lid) < 0.1 ? target : S.lid + (target - S.lid) * (1 - Math.exp(-dt * 7))
      // Touch the DOM only when the drawn tilt or the label text changes.
      const tilt = S.lid == null ? '' : lidTilt(S.lid).toFixed(2)
      const label = S.lid == null ? '' : lidLabel(S.lid)
      if (tilt + label !== S.shown) {
        S.shown = tilt + label
        if (lidEl.current) {
          lidEl.current.style.transform = tilt ? `rotateX(-${tilt}deg)` : ''
          lidEl.current.classList.toggle('closing', S.lid != null && S.lid < LID_NEARLY_CLOSED)
        }
        if (tag.current) tag.current.textContent = label || 'Sensors'
      }

      const fingers = now - live.at < STALE_MS ? (live.fingers ?? []) : []
      if (still) S.trails.clear()
      else {
        if (live.at !== S.seen) {
          S.seen = live.at
          for (const f of fingers) {
            const tr = S.trails.get(f.id) ?? []
            tr.push({ x: clamp(f.x), y: clamp(f.y), t: now })
            S.trails.set(f.id, tr)
          }
        }
        for (const [id, tr] of S.trails) {
          while (tr.length && now - tr[0].t > TRAIL_MS) tr.shift()
          if (!tr.length) S.trails.delete(id)
        }
      }
      if (!fingers.length && !S.trails.size) {
        if (S.drawn) ctx.clearRect(0, 0, tp.w + 2 * PAD, tp.h + 2 * PAD)
        S.drawn = false
        return target !== S.lid ? true : 'sleep'
      }
      if (still || t - S.colorAt > 2) {
        S.color = getComputedStyle(ctx.canvas).getPropertyValue('--finger').trim()
        S.colorAt = t
      }
      const X = (x: number) => PAD + clamp(x) * tp.w
      // The reader's y runs front to back; the drawing's runs from the hinge to the front.
      const Y = (y: number) => PAD + (1 - clamp(y)) * tp.h
      ctx.clearRect(0, 0, tp.w + 2 * PAD, tp.h + 2 * PAD)
      ctx.strokeStyle = ctx.fillStyle = S.color
      // The trackpad's outline lights up while it is touched.
      ctx.globalAlpha = fingers.length ? 0.45 : 0.2
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(PAD, PAD, tp.w, tp.h, 12)
      ctx.stroke()
      ctx.lineCap = 'round'
      for (const tr of S.trails.values()) {
        for (let i = 1; i < tr.length; i++) {
          const age = 1 - (now - tr[i].t) / TRAIL_MS
          ctx.globalAlpha = 0.45 * age
          ctx.lineWidth = 2 + 6 * age
          ctx.beginPath()
          ctx.moveTo(X(tr[i - 1].x), Y(tr[i - 1].y))
          ctx.lineTo(X(tr[i].x), Y(tr[i].y))
          ctx.stroke()
        }
      }
      for (const f of fingers) {
        const r = 5 + 9 * clamp(f.size)
        ctx.globalAlpha = 0.25
        ctx.beginPath()
        ctx.arc(X(f.x), Y(f.y), r + 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(X(f.x), Y(f.y), r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      S.drawn = true
      return 'fast'
    },
    paused,
    stamp,
  )
  useEffect(() => {
    live.onChange = wake
    wake()
    return () => {
      live.onChange = () => {}
    }
  }, [live, wake])
}

type Props = {
  hw: Hardware
  s: Sample
  live: Live
  systemW: number | null
  llm: boolean
  onOpen: (v: View, el: Element) => void
  /** The panel docked beside the scene, if any; the camera flies to its part and stays live. */
  panel: View | null
  /** With a lesson docked: the part it is about, or null for the whole Mac. */
  part?: PartKey | null
  hidden?: boolean
}

type CalloutKey = 'power' | 'memory' | 'wifi' | 'ssd' | 'battery'
/** Which side of the scene each label sits on, in reading order; the chip has the magnified inset instead. */
const SIDES: { left: CalloutKey[]; right: CalloutKey[] } = { left: ['power', 'memory'], right: ['wifi', 'ssd', 'battery'] }
const PILL_W = 120
const PILL_H = 42
/** Room kept clear at each side of the scene for the labels, so they sit beside the laptop and not on it. */
const SIDE_ROOM = PILL_W + 16
/** Size of the drawn stack at the home view with the lid up (measured), plus a little air; sets the scale. */
const LAPTOP_W = 720
const LAPTOP_H = 640
/** Strip kept clear along the bottom for the LLM note and the hint, so neither sits on the laptop. */
const FOOT_ROOM = 60
/** Where `.iso` sits in the scene box (styles.css); the camera's screen points are in its coordinates. */
const ISO_LEFT = 55
const ISO_TOP = 195
/** Width of the close-up caption card plus its margin, kept clear on the right when the stage is wide. */
const CARD_ROOM = 300
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

type Label = { view: View; topic: string; title: string; value: string }

/**
 * Side labels with leader lines to their parts. Its own component, so following the camera every frame
 * re-renders only the labels and not the scene.
 */
function Callouts({ stage, labels, size, open, onOpen, bus }: { stage: React.RefObject<HTMLDivElement | null>; labels: Record<CalloutKey, Label | null>; size: { w: number; h: number }; open: boolean; onOpen: Props['onOpen']; bus: React.RefObject<() => void> }) {
  const [at, setAt] = useState<Partial<Record<CalloutKey, Pt>>>({})
  bus.current = () => {
    const el = stage.current
    // Hidden from below and in a close-up (styles.css), so not worth measuring there.
    if (!el || el.hasAttribute('data-under') || el.dataset.focus) return
    const o = el.getBoundingClientRect()
    const next: Partial<Record<CalloutKey, Pt>> = {}
    for (const a of el.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const r = a.getBoundingClientRect()
      const p = { x: r.left - o.left, y: r.top - o.top }
      // A part zoomed or turned out of the stage loses its label rather than pointing off the edge.
      if (p.x > 0 && p.y > 0 && p.x < o.width && p.y < o.height) next[a.dataset.anchor as CalloutKey] = p
    }
    setAt(next)
  }
  useEffect(
    () => () => {
      bus.current = () => {}
    },
    [bus],
  )
  const ys = { ...stack(SIDES.left, at, size.h), ...stack(SIDES.right, at, size.h) }
  return (
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
            <div key={k} className="callout-wrap" style={{ top: y, [side]: 12, width: PILL_W, height: PILL_H }}>
              <button className="callout" aria-label={`${l.title}, ${l.value}. Open details.`} onClick={(e) => onOpen(l.view, e.currentTarget)}>
                <span className="tag-title">{l.title}</span>
                <span className="tag-value">{l.value}</span>
              </button>
              {/* Top right, beside the short title; the longer value runs below it. */}
              <InfoButton topic={l.topic} className="callout-info" />
            </div>
          )
        }),
      )}
    </div>
  )
}

/** The bottom case seen from below: plain aluminium, four feet, four pentalobe screws, no vents. */
const Underside = memo(function Underside({ g }: { g: Geometry }) {
  // Drawn mirrored (x becomes W - x) because the face is turned over with rotateY; seen from below it reads true.
  const heat = { x: W - (g.PKG.x + g.PKG.w / 2), y: g.PKG.y + g.PKG.h / 2 }
  return (
    <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg underside" aria-hidden>
      <defs>
        <linearGradient id="alu-under" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--alu-2)" />
          <stop offset="0.55" stopColor="var(--alu-1)" />
          <stop offset="1" stopColor="var(--alu-2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width={W - 2} height={D - 2} rx="20" fill="url(#alu-under)" stroke="var(--alu-edge)" />
      <ellipse cx={heat.x} cy={heat.y} rx={190} ry={140} fill="url(#heat-spread)" className="heat-spread" />
      {[
        [40, 34],
        [W - 40, 34],
        [40, D - 34],
        [W - 40, D - 34],
      ].map(([x, y], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx="16" ry="12" className="foot" />
          <circle cx={x + (x < W / 2 ? 30 : -30)} cy={y} r="2.6" className="screw" />
        </g>
      ))}
    </svg>
  )
})

/** Which part a panel is about, so opening one from a label or the rail flies the camera there. */
const VIEW_PART: Partial<Record<View, PartKey>> = { chip: 'soc', memory: 'memory', battery: 'battery', io: 'ssd', power: 'power', sensors: 'display' }

export function Scene({ hw, s, live, systemW, llm, onOpen, panel, part, hidden }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const iso = useRef<HTMLDivElement>(null)
  const layerEls = useRef<(HTMLDivElement | null)[]>([])
  const guideEls = useRef<(HTMLDivElement | null)[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const padCanvas = useRef<HTMLCanvasElement>(null)
  const lidEl = useRef<HTMLDivElement>(null)
  const lidTag = useRef<HTMLSpanElement>(null)
  const measure = useRef(() => {})
  const drive = useRef<Drive>({ mem: 0, llm: false, read: 0, write: 0, net: 0, tiles: [], at: 0, t: 0, audio: false })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [open, setOpen] = useState(reduced())
  const g = AIR_GEOMETRY
  // On a phone the side labels would cover the whole laptop; the rail below has the same readings.
  const compact = size.w < 560
  const fit = Math.max(0.1, Math.min((size.w - 2 * (compact ? 8 : SIDE_ROOM)) / LAPTOP_W, (size.h - FOOT_ROOM) / LAPTOP_H, 1.3))
  const view = useRef({ size, fit, panel })
  view.current = { size, fit, panel }

  const { api, focus, under } = useOrbit(
    { stage, iso, layers: layerEls, guides: guideEls },
    {
      lid: () => live.lid,
      // The middle of the free part of the stage in .iso coordinates, and its size: the caption card takes the
      // right side of a wide stage and the bottom of a narrow one. With a panel docked the card hides.
      screen: () => {
        const { size: z, fit: f, panel: p } = view.current
        let x = BOX_W / 2 - ISO_LEFT
        let y = BOX_H / 2 - ISO_TOP + FOOT_ROOM / 2 / f
        let [w, h] = [z.w, z.h - 90]
        if (p) {
          h -= 40
          // On phones the panel is a drawer over the bottom of the scene: frame the part in what still shows.
          const d = document.querySelector<HTMLElement>('.main.docked .detail')
          const s = stage.current?.getBoundingClientRect()
          // The toolbar sits under the drawer there, so only the lid row at the top needs room kept.
          if (d && s && matchMedia('(max-width: 820px)').matches) {
            const covered = Math.max(0, Math.min(z.h - 120, s.bottom - (innerHeight - d.offsetHeight)))
            y = BOX_H / 2 - ISO_TOP + (30 - covered / 2) / f
            h = z.h - covered - 60
          }
        } else if (z.w > 640) {
          x -= CARD_ROOM / 2 / f
          w -= CARD_ROOM
        } else {
          y -= (0.25 * z.h) / f
          h *= 0.5
        }
        return { x, y, room: Math.min(w, h) / f }
      },
      onFrame: () => {
        measure.current()
        stage.current?.dispatchEvent(new Event('scenemove', { bubbles: true }))
      },
      onRest: () => measure.current(),
    },
  )
  // With a part's panel docked, clicking another part swaps the panel to it as well; a lesson stays put.
  const swaps = (k: PartKey) => !!panel && panel !== 'lesson' && PARTS[k].view !== panel
  const focusPart = (k: PartKey | null, openPanel = false) => {
    if (k && openPanel) onOpen(PARTS[k].view, stage.current!)
    api.setFocus(k)
  }
  useOrbitInput(stage, api, (k, _x, _y, openNow) => {
    // From below only the bottom case shows; the parts behind it are not what was clicked.
    if (under) return
    if (!k) return api.focus() && focusPart(null)
    focusPart(k, openNow || swaps(k))
  })

  useLayoutEffect(() => {
    const el = stage.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (open) return api.setExplode(api.explode || DEFAULT_EXPLODE, false)
    const id = setTimeout(() => {
      setOpen(true)
      api.setExplode(DEFAULT_EXPLODE, true)
    }, 250)
    return () => clearTimeout(id)
  }, [open, api])
  // The labels follow every camera frame; besides that they only move when the stage resizes.
  useEffect(() => {
    if (!hidden) measure.current()
  }, [size, fit, open, hidden])
  useEffect(() => api.refocus(), [size.w, size.h, api])
  useEffect(() => {
    if (!panel) return
    const cur = api.focus()
    if (panel === 'lesson') {
      const to = part && (part !== 'battery' || s.battery) ? part : null
      if (to !== cur) api.setFocus(to)
      return
    }
    const k = VIEW_PART[panel]
    if (cur && PARTS[cur].view === panel) return
    if (k && (k !== 'battery' || s.battery)) api.setFocus(k)
    // Only when a panel or lesson opens or changes; closing it keeps the close-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, part, api])
  // Esc leaves the close-up; an open panel or explainer takes Esc first.
  useEffect(() => {
    if (!focus || panel || hidden) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      focusPart(null)
      stage.current?.focus({ preventScroll: true })
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  })

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return
    const keys: Record<string, () => void> = {
      ArrowLeft: () => api.turn(15, 0),
      ArrowRight: () => api.turn(-15, 0),
      ArrowUp: () => api.turn(0, 10),
      ArrowDown: () => api.turn(0, -10),
      '+': () => api.zoomBy(1.25),
      '=': () => api.zoomBy(1.25),
      '-': () => api.zoomBy(0.8),
      _: () => api.zoomBy(0.8),
      '0': () => api.reset(),
      f: () => api.flip(),
      F: () => api.flip(),
      Enter: () => focus && onOpen(PARTS[focus].view, stage.current!),
    }
    const fn = keys[e.key]
    if (!fn) return
    e.preventDefault()
    fn()
  }

  const sensors = sensorsOf(s)
  const isp = mediaOf(s).ispGBs
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
    audio: !!sensors.audioPlaying,
  }
  useBoardCanvas(canvas, drive, g, !!hidden, s.t)
  useFastLayer(padCanvas, lidEl, lidTag, live, g.TRACKPAD, !!hidden, s.t)

  const b = s.battery
  const simple = useSimple()
  const t = s.thermal.cpuTempC
  // Drives every heat layer through one CSS variable, so the static case and top case never re-render.
  const heat = t != null ? step((t - 45) / 50) : ({ nominal: 0.1, fair: 0.4, serious: 0.7, critical: 1 } as const)[s.thermal.state]
  const labels: Record<CalloutKey, Label | null> = {
    power: { view: 'power', topic: 'power', title: 'Power', value: watts(systemW ?? socW(s)) },
    memory: { view: 'memory', topic: 'unified-memory', title: simple ? 'Desk Space' : 'Memory', value: `${memGB(usedBytes(s))} / ${memGB(s.memory.totalBytes, 0)}` },
    wifi: { view: 'io', topic: 'wifi', title: 'Wi-Fi', value: rate(s.net.rxBps + s.net.txBps) },
    ssd: { view: 'io', topic: 'ssd', title: simple ? 'Storage' : 'SSD', value: rate(s.disk.readBps + s.disk.writeBps) },
    battery: b ? { view: 'battery', topic: 'battery', title: 'Battery', value: `${Math.round(b.percent)}%${b.chargeHeld ? ' · held' : b.charging ? ' · charging' : ''}` } : null,
  }
  const onOff = (v: boolean | null, on: string, off: string) => (v == null ? null : v ? on : off)
  const values: Record<PartKey, string | null> = {
    soc: `${watts(socW(s))}${t != null ? ` · ${Math.round(t)}°C` : ''}`,
    memory: labels.memory!.value,
    ssd: `${simple ? 'Moving' : 'Read + write'} ${labels.ssd!.value}`,
    wifi: `${simple ? 'Moving' : 'Traffic'} ${labels.wifi!.value}`,
    power: labels.power!.value,
    speakers: onOff(sensors.audioPlaying, 'Playing audio', 'Quiet'),
    battery: labels.battery?.value ?? null,
    trackpad: null,
    display: sensors.lidAngleDeg == null ? null : `${lidLabel(sensors.lidAngleDeg)}${sensors.displayBrightness != null ? ` · brightness ${Math.round(sensors.displayBrightness * 100)}%` : ''}`,
    camera: onOff(sensors.cameraInUse, 'In use right now', 'Off'),
  }
  const ant = box(g.L.antennas)
  const LAYER_NAMES = simple ? ['Battery', 'Main board', 'Keyboard', 'Screen'] : ['Bottom case + battery', 'Logic board', 'Top case', 'Display']
  const fp = focus ? PARTS[focus] : null
  const ring = (i: number) =>
    fp && fp.layer === i && <div key={focus} className="focus-ring" style={{ left: fp.r.x - 6, top: fp.r.y - 6, width: fp.r.w + 12, height: fp.r.h + 12 }} />
  const layer = (i: number, children: React.ReactNode) => (
    <div className="layer" ref={(el) => void (layerEls.current[i] = el)} data-hot={fp?.layer === i || undefined}>
      {children}
      <span className="layer-tag" aria-hidden>
        {LAYER_NAMES[i]}
      </span>
    </div>
  )
  return (
    <div
      className={`stage ${hidden ? 'stage-hidden' : ''}`}
      ref={stage}
      tabIndex={hidden ? -1 : 0}
      role="group"
      aria-roledescription="3D model"
      aria-label={`Exploded ${hw.hasBattery ? 'MacBook Air' : 'Mac'}. Arrow keys turn it, plus and minus zoom, F flips it over, 0 resets. Use the Parts list to zoom into a part.`}
      data-focus={focus ?? undefined}
      onKeyDown={onKey}
    >
      <div className="scene" style={{ width: BOX_W, height: BOX_H, transform: `translate(-50%, calc(-50% - ${FOOT_ROOM / 2}px)) scale(${fit})` }}>
        <div className={`iso ${open ? 'open' : ''} ${llm ? 'llm' : ''}`} ref={iso} style={{ width: W, height: D, '--heat': heat } as CSSProperties}>
          <div className="ground" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="guide" ref={(el) => void (guideEls.current[i] = el)} />
          ))}
          {layer(
            0,
            <>
              <svg viewBox={`0 0 ${W} ${D}`} className="layer-svg">
                <BottomCase g={g} />
                {b && <BatteryLayer g={g} b={b} />}
                {b && focus === 'battery' && <BatteryDetail g={g} b={b} tempC={s.thermal.batteryTempC} />}
              </svg>
              <Underside g={g} />
              {b?.charging && focus === 'battery' && <ChargeFlow g={g} paused={!!hidden} stamp={s.t} />}
              <Anchor k="battery" r={centre(g.CELLS[3])} />
              {ring(0)}
            </>,
          )}
          {layer(
            1,
            <>
              <Board g={g} hw={hw} s={s} llm={llm} mic={!!sensors.micInUse} focus={focus} />
              <canvas ref={canvas} className="particles" style={{ width: W, height: D }} />
              <Anchor k="power" r={centre(g.PMU)} />
              <Anchor k="memory" r={centre(g.DRAM[0])} />
              <Anchor k="ssd" r={centre(g.NAND)} />
              <Anchor k="wifi" r={{ x: ant.x + ant.w, y: ant.y + ant.h / 2 }} />
              <Anchor k="soc" r={centre(g.PKG)} />
              {ring(1)}
            </>,
          )}
          {layer(
            2,
            <>
              <Deck g={g} kb={step(sensors.keyboardBacklight ?? 0, 10)} detail={focus === 'trackpad'} />
              <canvas
                ref={padCanvas}
                className="fingers"
                style={{ left: g.TRACKPAD.x - PAD, top: g.TRACKPAD.y - PAD, width: g.TRACKPAD.w + 2 * PAD, height: g.TRACKPAD.h + 2 * PAD }}
              />
              {ring(2)}
            </>,
          )}
          {layer(
            3,
            // The fast loop sets this wrapper's tilt from the lid angle.
            <div className="lid" ref={lidEl}>
              <Display
                g={g}
                glow={sensors.displayBrightness == null ? null : step(sensors.displayBrightness, 10)}
                camera={!!sensors.cameraInUse}
                mic={!!sensors.micInUse}
                focus={focus === 'display' || focus === 'camera' ? focus : null}
                // Rounded, and only while the camera is focused, so the lid does not repaint every sample for it.
                isp={focus === 'camera' && isp != null ? Math.round(isp * 10) / 10 : null}
              />
              {ring(3)}
            </div>,
          )}
        </div>
      </div>
      {focus && <div className="focus-vignette" aria-hidden />}
      {/* Labels sit at the sides with leader lines, so nothing covers the board or the chip. */}
      {!compact && <Callouts stage={stage} labels={labels} size={size} open={open} onOpen={onOpen} bus={measure} />}
      {/* The lid reading, and the way into the sensors panel; the fast loop writes the text. */}
      <div className="lid-row">
        <button className="lid-tag" onClick={(e) => onOpen('sensors', e.currentTarget)}>
          <span ref={lidTag}>Sensors</span>
          <span className="sr-only">. Open sensor details.</span>
        </button>
        <InfoButton topic="sensors" />
      </div>
      <OrbitControls api={api} under={under} hasBattery={!!b} onPart={(k) => focusPart(k, swaps(k))} />
      {focus && !panel && (
        <FocusCard
          k={focus}
          value={values[focus]}
          chip={hw.chip}
          onDetails={(el) => onOpen(PARTS[focus].view, el)}
          onBack={() => {
            focusPart(null)
            stage.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {llm && !focus && <div className="llm-note">Highlighted path: model weights stream from memory into the GPU for every token.</div>}
    </div>
  )
}
