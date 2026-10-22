import { useRef, type ReactNode } from 'react'
import type { Hardware, Sample } from './types.ts'
import { box, grid, inset, serpentine, sub, type Geometry, type Rect } from './layout.ts'
import { textUnit, type PartKey } from './parts.ts'
import { gpuMhz, memGB, mhz, pct, rate, step, temp, watts } from './format.ts'
import { peakBandwidth } from './story.ts'
import { useCanvasLoop } from './loop.ts'
import { useSimple } from './simple.ts'

/*
 * Close-up drawings, one per part. Each is mounted only while its part is focused (Scene.tsx), so the overview draws
 * and costs nothing extra. Schematic, after iFixit's M2 and M4 Air teardowns and chip ID, Apple's specs and Platform
 * Security guide, and docs/teardown-reference.md. Sizes come from textUnit so labels read at the close-up's zoom:
 * labels are at least LABEL units, live values VALUE units. The close-up camera looks down at about 50 degrees, which
 * squashes text to two thirds of its height, so LABEL comes out about 11 px tall on screen. Text that cannot fit at that size is
 * left to the focus card instead of being shrunk; detail.test.ts holds every drawing to it.
 */

export const LABEL = 1.25
export const VALUE = 1.45
/** SSD and Wi-Fi are small enough that their close-up hits the zoom cap, so they land smaller on screen than textUnit assumes. */
export const unit = (k: PartKey) => textUnit(k) * (k === 'ssd' || k === 'wifi' ? 1.3 : 1)

type Anchor = 'middle' | 'end'
function T({ x, y, s, a, v, children }: { x: number; y: number; s: number; a?: Anchor; v?: boolean; children: ReactNode }) {
  return (
    <text x={x} y={y} fontSize={s} textAnchor={a} className={v ? 'v' : undefined}>
      {children}
    </text>
  )
}
/** Line spacing in sizes. The camera's tilt squashes height to about two thirds, so normal spacing would overlap. */
const LEAD = 1.8
/** Baseline of line i stacked under r, clear of the focus ring (6 units out, plus its glow). */
const under = (r: Rect, size: number, i = 0) => r.y + r.h + 9 + size * (1 + LEAD * i)

/** Lines of text centred in a box. */
const Lines = ({ r, s, lines }: { r: Rect; s: number; lines: string[] }) =>
  lines.map((l, i) => (
    <T key={i} x={r.x + r.w / 2} y={r.y + r.h / 2 + s * 0.35 + (i - (lines.length - 1) / 2) * s * LEAD} s={s} a="middle">
      {l}
    </T>
  ))
const R = ({ r, rx = 0.3, c }: { r: Rect; rx?: number; c: string }) => <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={rx} className={c} />

/** A ceramic capacitor: tan body, metal ends along its long side. */
function Cap({ x, y, w, h }: Rect) {
  const e = Math.max(w, h) * 0.22
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className="dt-end" />
      <rect x={w >= h ? x + e : x} y={w >= h ? y : y + e} width={w >= h ? w - 2 * e : w} height={w >= h ? h : h - 2 * e} className="dt-cap" />
    </g>
  )
}
const capRow = (x0: number, x1: number, y: number, n: number, w: number, h: number) =>
  Array.from({ length: n }, (_, i) => <Cap key={`${x0},${y},${i}`} x={x0 + (i * (x1 - x0 - w)) / Math.max(1, n - 1)} y={y} w={w} h={h} />)

/** Memory and flash packages hold dies stacked on top of each other; drawn as staggered outlines in a corner. */
function Stack({ x, y, w, h }: Rect) {
  return (
    <g className="dt-stack">
      {[0, 1, 2, 3].map((k) => (
        <rect key={k} x={x + k * h * 0.22} y={y + (3 - k) * h * 0.22} width={w} height={h} rx={h * 0.1} />
      ))}
    </g>
  )
}

/** Shared fill patterns: solder balls under a package, holes in a shield can, a touch sensor grid. */
function Patterns({ pitch }: { pitch: number }) {
  return (
    <defs>
      <pattern id="dt-bga" width={pitch} height={pitch} patternUnits="userSpaceOnUse">
        <circle cx={pitch / 2} cy={pitch / 2} r={pitch * 0.22} className="dt-ball" />
      </pattern>
    </defs>
  )
}

// --- Logic board -----------------------------------------------------------

function Soc({ g, hw, s }: { g: Geometry; hw: Hardware; s: Sample }) {
  const u = unit('soc')
  const simple = useSimple()
  const P = g.PKG
  const D = g.DIE
  const f = u * LABEL
  const gapY = (D.y + D.h + 1.5 + g.DRAM[0].y) / 2 - 0.6
  const midX = (g.DRAM[0].x + g.DRAM[0].w + g.DRAM[1].x) / 2 - 0.6
  return (
    <g>
      {/* Decoupling capacitors on the substrate around the die keep its supply steady when load jumps. */}
      {Array.from({ length: 7 }, (_, i) => (
        <Cap key={'l' + i} x={P.x + 2.6} y={D.y + 0.5 + (i * (D.h - 2)) / 6} w={1.2} h={2.6} />
      ))}
      {Array.from({ length: 3 }, (_, i) => (
        <Cap key={'r' + i} x={P.x + P.w - 3.8} y={D.y + D.h * 0.62 + i * 4.2} w={1.2} h={2.6} />
      ))}
      {capRow(P.x + 7, P.x + P.w - 7, gapY, 13, 2.6, 1.2)}
      {Array.from({ length: 4 }, (_, i) => (
        <Cap key={'m' + i} x={midX} y={g.DRAM[0].y + 3 + i * 6} w={1.2} h={2.6} />
      ))}
      {g.DRAM.map((r, i) => (
        <g key={i}>
          <T x={r.x + 2} y={r.y + u * VALUE + 1} s={u * VALUE}>
            {memGB(hw.memBytes / 2, 0)}
          </T>
          <Stack x={r.x + r.w - 9} y={r.y + 1.6} w={6.5} h={2.6} />
        </g>
      ))}
      {(simple
        ? [`${hw.pCores} Fast Workers`, `${hw.eCores} Eco Workers`, `${hw.gpuCores ? `${hw.gpuCores} ` : ''}graphics workers`]
        : [
            `${hw.pCores} P cores at ${mhz(s.cpu.pFreqMHz)}`,
            `${hw.eCores} E cores at ${mhz(s.cpu.eFreqMHz)}`,
            `${hw.gpuCores ? `${hw.gpuCores} ` : ''}GPU cores at ${gpuMhz(s.gpu.freqMHz)}`,
          ]
      ).map((l, i) => (
        <T key={i} x={P.x} y={under(P, f, i)} s={f} v>
          {l}
        </T>
      ))}
    </g>
  )
}

function Memory({ g, hw, s }: { g: Geometry; hw: Hardware; s: Sample }) {
  const u = unit('memory')
  const simple = useSimple()
  const f = u * LABEL
  const D = g.DIE
  const P = g.PKG
  const peak = peakBandwidth(hw.chip)
  const bw = s.memory.bandwidthGBs
  const level = bw == null ? 0.4 : 0.3 + 0.7 * step(bw / (peak ?? 140), 10)
  const phyY = D.y + D.h * 0.8
  // Package 1 feeds PHY group A, package 2 group B (teardown-reference.md, die table).
  const phys = [g.DIE_STATIC[4], g.DIE_STATIC[5]]
  return (
    <g>
      <Patterns pitch={2.2} />
      <g className="dt-chan" style={{ opacity: level }}>
        {g.DRAM.map((r, i) =>
          [0, 1, 2, 3].map((c) => {
            const xd = r.x + r.w * (0.16 + 0.225 * c)
            const xp = phys[i].x + phys[i].w * (0.14 + 0.24 * c)
            return [-0.9, 0, 0.9].map((o) => <polyline key={`${i}${c}${o}`} points={`${xd + o},${r.y + 1} ${xd + o},${D.y + D.h + 2} ${xp + o},${phyY}`} />)
          }),
        )}
      </g>
      {g.DRAM.map((r, i) => (
        <g key={i}>
          <rect {...rectAttrs(inset(r, 1.4))} fill="url(#dt-bga)" opacity="0.5" />
          <T x={r.x + 2} y={r.y + u * VALUE + 1} s={u * VALUE}>
            {memGB(hw.memBytes / 2, 0)}
          </T>
          <Stack x={r.x + r.w - 9} y={r.y + 1.6} w={6.5} h={2.6} />
          {!simple && (
            <T x={r.x + r.w / 2} y={r.y + r.h * 0.5} s={f} a="middle">
              4 x 16 bit
            </T>
          )}
        </g>
      ))}
      <T x={P.x} y={under(P, u * VALUE)} s={u * VALUE} v>
        {simple
          ? bw == null
            ? 'Highway speed not readable'
            : `Highway ${peak ? `${Math.min(100, Math.round((bw / peak) * 100))}% busy` : 'in use'}`
          : bw == null
            ? 'Bandwidth not readable'
            : `${bw.toFixed(0)}${peak ? ` of ${peak}` : ''} GB/s`}
        {!simple && s.power.dramW != null && ` · ${watts(s.power.dramW)}`}
      </T>
      <T x={P.x} y={under(P, u * VALUE, 1)} s={f}>
        {simple ? 'Every worker shares this one desk' : '8 channels, 128 bits wide'}
      </T>
    </g>
  )
}

const rectAttrs = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

function Ssd({ g, s }: { g: Geometry; s: Sample }) {
  const u = unit('ssd')
  const simple = useSimple()
  const N = g.NAND
  const D = g.DIE
  const v = u * VALUE
  return (
    <g>
      <Patterns pitch={2} />
      <rect {...rectAttrs(inset(N, 1.4))} fill="url(#dt-bga)" opacity="0.35" />
      <circle cx={N.x + 2.2} cy={N.y + 2.2} r={0.6} className="dt-pin" />
      <Stack x={N.x + N.w - 9} y={N.y + 1.8} w={6.5} h={2.6} />
      {/* The flash bus runs straight from the storage controller inside the chip to the package. */}
      <g className="dt-bus">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={D.x + D.w} x2={N.x} y1={D.y + D.h * 0.62 + i * 0.9} y2={D.y + D.h * 0.62 + i * 0.9} />
        ))}
      </g>
      <T x={N.x} y={under(N, v)} s={u * VALUE} v>
        {simple ? 'Opening' : 'Read'} {rate(s.disk.readBps)}
      </T>
      <T x={N.x} y={under(N, v, 1)} s={u * VALUE} v>
        {simple ? 'Saving' : 'Write'} {rate(s.disk.writeBps)}
      </T>
      <T x={N.x} y={under(N, v, 2)} s={u * LABEL}>
        {simple ? 'Run by the brain' : 'Controller in the chip'}
      </T>
      <T x={N.x} y={under(N, v, 3)} s={u * LABEL}>
        {simple ? 'Locked so only you can read it' : 'Encrypts as it writes'}
      </T>
    </g>
  )
}

function Wifi({ g, s }: { g: Geometry; s: Sample }) {
  const u = unit('wifi')
  const simple = useSimple()
  const r = g.WIFI
  const ant = box(g.L.antennas)
  const fy = ant.y + 6.5
  const feeds: [number, number][] = [
    [r.x + 6, r.x - 18],
    [r.x + r.w - 6, r.x + r.w + 12],
  ]
  const v = u * VALUE
  return (
    <g>
      <defs>
        <pattern id="dt-perf" width="2.2" height="2.2" patternUnits="userSpaceOnUse">
          <circle cx="1.1" cy="1.1" r="0.35" className="dt-hole" />
        </pattern>
      </defs>
      <rect {...rectAttrs(inset(r, 1.6))} rx="1.5" fill="url(#dt-perf)" />
      {/* The can is soldered to a fence of pads all round, so the radio cannot leak noise or pick it up. */}
      <rect {...rectAttrs(inset(r, 0.7))} rx="2" className="dt-fence" />
      {feeds.map(([x, end], i) => (
        <g key={i}>
          <polyline points={`${x},${r.y} ${x},${fy} ${end},${fy}`} className="dt-coax" />
          <polyline points={`${x},${r.y} ${x},${fy} ${end},${fy}`} className="dt-coax-core" />
          <circle cx={x} cy={r.y + 0.6} r={0.8} className="dt-pin" />
          <path d={serpentine({ x: end < x ? end - 6 : end, y: ant.y + 3, w: 6, h: 3.5 }, 6)} className="dt-meander" />
        </g>
      ))}
      <T x={r.x + r.w / 2} y={fy + u * 1.4} s={u * LABEL} a="middle">
        {simple ? 'Wires to the antennas' : 'Antenna cables'}
      </T>
      <T x={r.x} y={under(r, v)} s={u * VALUE} v>
        {simple ? 'Downloading' : 'Down'} {rate(s.net.rxBps)}
      </T>
      <T x={r.x} y={under(r, v, 1)} s={u * VALUE} v>
        {simple ? 'Uploading' : 'Up'} {rate(s.net.txBps)}
      </T>
      <T x={r.x} y={under(r, v, 2)} s={u * LABEL}>
        {simple ? 'Wi-Fi and Bluetooth radio' : 'Wi-Fi 7, Bluetooth 6'}
      </T>
      <T x={r.x} y={under(r, v, 3)} s={u * LABEL}>
        {simple ? 'A metal lid keeps out noise' : 'Under a shield can'}
      </T>
    </g>
  )
}

function Power({ g, s }: { g: Geometry; s: Sample }) {
  const u = unit('power')
  const simple = useSimple()
  const M = g.PMU
  const pmics = grid(2, sub(M, [0.04, 0.06, 0.62, 0.46]), 5)
  const charger = sub(M, [0.68, 0.06, 0.96, 0.4])
  const inductors = grid(8, sub(M, [0.04, 0.56, 0.96, 0.96]), 4)
  const ports = g.L.ports.map(box)
  const b = s.battery
  // Power in: the port board's MagSafe and USB-C feeds join and run over a flex to the charger.
  const bus = 50
  const top = M.y - 4
  const cx = charger.x + charger.w / 2
  const inPath = `M ${ports[2].x + 14} ${ports[2].y + ports[2].h / 2} H ${bus} V ${top} H ${cx} V ${charger.y}`
  const v = u * VALUE
  return (
    <g>
      <Patterns pitch={2.4} />
      <path d={inPath} className={`dt-pwr ${b?.acAttached ? 'on' : ''}`} />
      {ports.slice(0, 2).map((p, i) => (
        <path key={i} d={`M ${p.x + 14} ${p.y + p.h / 2} H ${bus}`} className={`dt-pwr ${b?.acAttached ? 'on' : ''}`} />
      ))}
      {(simple ? ['Magnetic charger', 'USB-C', 'USB-C'] : ['MagSafe 3', 'USB-C', 'USB-C']).map((n, i) => (
        <T key={i} x={ports[i].x + 15} y={ports[i].y + ports[i].h / 2 - 1.6} s={u * LABEL}>
          {n}
        </T>
      ))}
      <T x={bus + 2} y={top - 1.2} s={u * LABEL}>
        Power in
      </T>
      {pmics.map((r, i) => (
        <g key={i}>
          <rect {...rectAttrs(inset(r, 1.2))} fill="url(#dt-bga)" opacity="0.35" />
          <Lines r={r} s={u * LABEL} lines={[simple ? 'Converter' : 'PMIC']} />
        </g>
      ))}
      <Lines r={charger} s={u * LABEL} lines={['Charger']} />
      {inductors.map((r, i) => (
        <ellipse key={i} cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w * 0.32} ry={r.h * 0.3} className="dt-coil" />
      ))}
      {capRow(M.x + 4, M.x + M.w - 4, (pmics[0].y + pmics[0].h + inductors[0].y) / 2 - 0.6, 16, 2.4, 1.2)}
      <T x={M.x + 3} y={under(M, v)} s={u * VALUE} v>
        {simple ? 'Using' : 'System'} {watts(s.power.systemW)}
      </T>
      <T x={M.x + 3} y={under(M, v, 1)} s={u * VALUE} v>
        {b == null ? 'No battery' : b.acAttached ? `Adapter ${b.adapterW != null ? `${b.adapterW} W` : 'plugged in'}` : 'On battery'}
      </T>
      <T x={M.x + 3} y={under(M, v, 2)} s={u * LABEL}>
        {simple ? 'Smooths power into a steady flow' : 'Coils and capacitors smooth each rail'}
      </T>
    </g>
  )
}

function Speakers({ g, s }: { g: Geometry; s: Sample }) {
  const u = unit('speakers')
  const simple = useSimple()
  const on = !!s.sensors?.audioPlaying
  return (
    <g>
      {g.SPEAKERS.map((r, i) => {
        const body = { x: r.x, y: r.y + 3, w: r.w, h: r.h - 3 }
        const outer = i === 0
        const tw = { cx: outer ? r.x + 13 : r.x + r.w - 13, cy: body.y + body.h / 2 }
        const wf = { x: outer ? r.x + 26 : r.x + 5, y: body.y + 2.5, w: r.w - 31, h: body.h - 5 }
        return (
          <g key={i}>
            <rect {...rectAttrs(inset(body, 1))} rx="4" className="dt-enclosure" />
            {/* Woofer: a long cone on a suspension ring around a magnet; tweeter: a small dome. */}
            {[0, 2.5, 5].map((d) => (
              <rect key={d} {...rectAttrs(inset(wf, d))} rx={(wf.h - 2 * d) / 2} className={`dt-cone ${on ? 'on' : ''} ${d ? '' : 'outer'}`} />
            ))}
            <rect {...rectAttrs(inset(wf, 7.2))} rx="2" className="dt-magnet" />
            <circle cx={tw.cx} cy={tw.cy} r={8} className={`dt-cone outer ${on ? 'on' : ''}`} />
            <circle cx={tw.cx} cy={tw.cy} r={5.6} className={`dt-cone ${on ? 'on' : ''}`} />
            <circle cx={tw.cx} cy={tw.cy} r={3.4} className="dt-magnet" />
            {/* Above the ring: the logic board starts right under the speakers. */}
            <T x={r.x + r.w / 2} y={r.y - 11} s={u * LABEL} a="middle">
              {simple ? (outer ? 'Small speaker, then big one' : 'Big speaker, then small one') : outer ? 'Tweeter, then woofer' : 'Woofer, then tweeter'}
            </T>
          </g>
        )
      })}
      <T x={300} y={g.SPEAKERS[0].h / 2 + u * LABEL * 0.35} s={u * LABEL} a="middle">
        {simple ? 'Sound comes out by the hinge' : 'Both fire into the hinge gap'}
      </T>
    </g>
  )
}

/** Drawn inside the part's layer SVG, which styles.css already rasterises at twice its size while focused. */
const Closeup = ({ className, children }: { className?: string; children: ReactNode }) => <g className={`closeup ${className ?? ''}`}>{children}</g>

export function BoardDetail({ k, g, hw, s }: { k: PartKey; g: Geometry; hw: Hardware; s: Sample }) {
  const Part = { soc: Soc, memory: Memory, ssd: Ssd, wifi: Wifi, power: Power, speakers: Speakers }[k as 'soc']
  return Part ? (
    <Closeup className="board">
      <Part g={g} hw={hw} s={s} />
    </Closeup>
  ) : null
}

// --- Battery ---------------------------------------------------------------

/**
 * Pack layout, from iFixit's M2 Air teardown: four pouch cells, the two middle ones in parallel, so three groups in
 * series. Every tab is welded to the battery management board, which makes the series links and carries the gauge.
 */
function packGeometry(g: Geometry) {
  const [A, B, C, Dd] = g.CELLS
  const bms = { x: A.x + A.w - 22, y: B.y - 18, w: Dd.x + 22 - (A.x + A.w - 22), h: 13 }
  // [x, cell top, polarity] for each tab.
  const tabs: [number, number, '-' | '+'][] = [
    [A.x + A.w - 16, A.y, '-'],
    [A.x + A.w - 8, A.y, '+'],
    [B.x + 10, B.y, '-'],
    [B.x + B.w - 10, B.y, '+'],
    [C.x + 10, C.y, '-'],
    [C.x + C.w - 10, C.y, '+'],
    [Dd.x + 8, Dd.y, '-'],
    [Dd.x + 16, Dd.y, '+'],
  ]
  const conn = { x: g.CONN.x + 2, y: g.CONN.y + 2, w: 8, h: bms.y - g.CONN.y - 2 }
  return { bms, tabs, conn }
}

export function BatteryDetail({ g, b, tempC }: { g: Geometry; b: NonNullable<Sample['battery']>; tempC: number | null }) {
  const u = unit('battery')
  const simple = useSimple()
  const f = u * LABEL
  const { bms, tabs, conn } = packGeometry(g)
  const [A, B, C, Dd] = g.CELLS
  const by = bms.y + bms.h
  const link = bms.y + bms.h * 0.72
  const state = b.charging ? `Charging${b.watts ? ` ${watts(Math.abs(b.watts))}` : ''}` : b.chargeHeld ? 'Held' : b.acAttached ? 'On power' : 'On battery'
  const facts = [b.healthPct != null && `Health ${pct(Math.min(100, b.healthPct), 1)}`, b.cycleCount != null && `${b.cycleCount} ${simple ? 'charges' : 'cycles'}`, tempC != null && temp(tempC)].filter(Boolean)
  // The trackpad sits in the gap the four cells wrap around, on the layer above; the wiring note goes there.
  const gap = { x: A.x + A.w, y: B.y + B.h, w: Dd.x - A.x - A.w, h: g.TRAY.y + g.TRAY.h - B.y - B.h }
  return (
    <Closeup>
      {g.CELLS.map((r, i) => (
        <g key={i}>
          {/* The pouch is sealed along a flat flange all round; one long side is folded over. */}
          <rect {...rectAttrs(inset(r, 3))} rx="7" className="dt-seam" />
          <line x1={r.x + 7} x2={r.x + 7} y1={r.y + 10} y2={r.y + r.h - 10} className="dt-seam" />
        </g>
      ))}
      <rect {...rectAttrs(conn)} rx="1" className="dt-flex" />
      {tabs.map(([x, top, p], i) => (
        <rect key={i} x={x - 2.5} y={by} width={5} height={top - by + 3} className={`dt-tab ${p === '+' ? 'pos' : ''}`} />
      ))}
      <rect {...rectAttrs(bms)} rx="2" className="dt-bms" />
      {/* Series links on the board: pack minus, group 1, groups 2a and 2b together, group 3, pack plus. */}
      <polyline points={`${tabs[1][0]},${link} ${tabs[4][0]},${link}`} className="dt-link" />
      <polyline points={`${tabs[3][0]},${link - 2.2} ${tabs[6][0]},${link - 2.2}`} className="dt-link" />
      {[tabs[2][0], tabs[4][0]].map((x) => (
        <line key={x} x1={x} x2={x} y1={link} y2={by} className="dt-link" />
      ))}
      {[tabs[3][0], tabs[5][0], tabs[6][0]].map((x) => (
        <line key={x} x1={x} x2={x} y1={link - 2.2} y2={by} className="dt-link" />
      ))}
      {/* Fuel gauge, then the two cut-off switches. */}
      <rect x={bms.x + bms.w * 0.62} y={bms.y + 2} width={16} height={bms.h - 6} rx="1" className="dt-ic" />
      <rect x={bms.x + bms.w * 0.62 + 20} y={bms.y + 2} width={8} height={bms.h - 6} rx="1" className="dt-ic" />
      <rect x={bms.x + bms.w * 0.62 + 31} y={bms.y + 2} width={8} height={bms.h - 6} rx="1" className="dt-ic" />
      <T x={bms.x + 4} y={bms.y - 7} s={f}>
        {simple ? "The battery's own guard chip" : 'Battery management board'}
      </T>
      <T x={A.x + A.w / 2} y={A.y + A.h * 0.5 - u * 2.4} s={f} a="middle">
        {simple ? 'Cell 1' : 'Group 1'}
      </T>
      <T x={A.x + A.w / 2} y={A.y + A.h * 0.5 + u * 0.4} s={u * 2.4} a="middle" v>
        {Math.round(b.percent)}%
      </T>
      <T x={A.x + A.w / 2} y={A.y + A.h * 0.5 + u * 2} s={f} a="middle">
        {state}
      </T>
      <T x={B.x + B.w / 2} y={B.y + B.h / 2 + f * 0.35} s={f} a="middle">
        {simple ? 'Cell 2' : 'Group 2a'}
      </T>
      <T x={C.x + C.w / 2} y={C.y + C.h / 2 + f * 0.35} s={f} a="middle">
        {simple ? 'Cell 3' : 'Group 2b'}
      </T>
      <T x={Dd.x + Dd.w / 2} y={Dd.y + Dd.h * 0.5 - u * 2.4} s={f} a="middle">
        {simple ? 'Cell 4' : 'Group 3'}
      </T>
      {facts.map((l, i) => (
        <T key={i} x={Dd.x + Dd.w / 2} y={Dd.y + Dd.h * 0.5 + u * VALUE * 1.2 * i} s={u * VALUE} a="middle" v>
          {l}
        </T>
      ))}
      <Lines r={{ ...gap, h: gap.h * 0.6 }} s={f} lines={simple ? ['Four cells team up', 'to power the Mac'] : ['2a and 2b in parallel,', '3 groups in series,', 'about 11.6 V']} />
    </Closeup>
  )
}

/** Charge flowing in, from the connector along the board and down every tab. Its own small canvas, only while charging. */
export function ChargeFlow({ g, paused, stamp }: { g: Geometry; paused: boolean; stamp: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ color: '', at: -9 })
  const { bms, tabs, conn } = packGeometry(g)
  const area = { x: bms.x - 4, y: conn.y - 2, w: bms.w + 8, h: Math.max(...tabs.map((t) => t[1])) + 8 - (conn.y - 2) }
  const sx = conn.x + conn.w / 2
  const mid = bms.y + bms.h * 0.35
  const paths = tabs.map(([x, top]) => [
    [sx, conn.y],
    [sx, mid],
    [x, mid],
    [x, top + 6],
  ])
  useCanvasLoop(
    ref,
    area.w,
    (ctx, t, _dt, still) => {
      const S = st.current
      if (still || t - S.at > 2) {
        S.color = getComputedStyle(ctx.canvas).getPropertyValue('--accent-hi').trim()
        S.at = t
      }
      ctx.clearRect(0, 0, area.w, area.h)
      ctx.save()
      ctx.translate(-area.x, -area.y)
      ctx.strokeStyle = S.color
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.setLineDash([3, 7])
      ctx.lineDashOffset = still ? 0 : -t * 20
      ctx.globalAlpha = 0.9
      for (const p of paths) {
        ctx.beginPath()
        p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }
      ctx.restore()
      return true
    },
    paused,
    stamp,
  )
  return <canvas ref={ref} className="particles" style={{ left: area.x, top: area.y, width: area.w, height: area.h }} />
}

// --- Top case ---------------------------------------------------------------

export function TrackpadDetail({ g }: { g: Geometry }) {
  const u = unit('trackpad')
  const simple = useSimple()
  const tp = g.TRACKPAD
  const grid8 = inset(tp, 7)
  const gauge = (x: number, y: number) => ({ x, y, w: 16, h: 9 })
  const corners = [gauge(tp.x + 9, tp.y + 9), gauge(tp.x + tp.w - 25, tp.y + 9), gauge(tp.x + 9, tp.y + tp.h - 18), gauge(tp.x + tp.w - 25, tp.y + tp.h - 18)]
  // Along the rear edge, about y 0.60 to 0.66 of the case (teardown-reference.md).
  const te = { x: tp.x + tp.w * 0.2, y: tp.y + 10, w: tp.w * 0.6, h: 17 }
  return (
    <Closeup>
      <defs>
        <pattern id="dt-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M 8 0 V 8 M 0 8 H 8" className="dt-gridline" />
        </pattern>
      </defs>
      <rect {...rectAttrs(grid8)} rx="8" fill="url(#dt-grid)" />
      <rect {...rectAttrs(inset(tp, 2.5))} rx="10" className="dt-glass" />
      {corners.map((r, i) => (
        <path key={i} d={serpentine(r, 9)} className="dt-gauge" />
      ))}
      <rect {...rectAttrs(te)} rx="3" className="dt-taptic" />
      <rect {...rectAttrs({ x: te.x + 3, y: te.y + 3, w: 22, h: te.h - 6 })} rx="1.5" className="dt-magnet" />
      <rect {...rectAttrs({ x: te.x + te.w - 25, y: te.y + 3, w: 22, h: te.h - 6 })} rx="1.5" className="dt-magnet" />
      <path d={serpentine({ x: te.x + 32, y: te.y + 3.5, w: te.w - 64, h: te.h - 7 }, 24)} className="dt-winding" />
      <T x={te.x + te.w / 2} y={te.y + te.h + u * VALUE * 1.4} s={u * VALUE} a="middle">
        {simple ? 'Click buzzer' : 'Taptic Engine'}
      </T>
      <T x={te.x + te.w / 2} y={te.y + te.h + u * VALUE * 1.4 + u * LABEL * LEAD} s={u * LABEL} a="middle">
        {simple ? 'It taps so you feel a click' : 'A shaking weight fakes the click'}
      </T>
      <Lines r={{ x: tp.x, y: tp.y + tp.h * 0.6, w: tp.w, h: u * 3 }} s={u * LABEL} lines={simple ? ['Feels where your fingers are', 'The corners feel how hard you press'] : ['Touch grid under the glass', 'Gauges in each corner feel the press']} />
      <T x={tp.x + 29} y={tp.y + tp.h - 11.5} s={u * LABEL}>
        {simple ? 'Press sensor' : 'Strain gauge'}
      </T>
      <T x={tp.x + tp.w - 29} y={tp.y + tp.h - 11.5} s={u * LABEL} a="end">
        {simple ? 'Press sensor' : 'Strain gauge'}
      </T>
    </Closeup>
  )
}

// --- Display -----------------------------------------------------------------

export function DisplayDetail({ g, brightness }: { g: Geometry; brightness: number | null }) {
  const u = unit('display')
  const simple = useSimple()
  const p = box(g.L.panel)
  const bottom = p.y + p.h
  const lit = brightness == null ? 0.5 : 0.15 + 0.85 * brightness
  // Peeled corner, outermost first.
  const layers = simple ? ['Glass', 'Picture layer', 'Light spreader', 'Mirror'] : ['Cover glass', 'LCD and color filters', 'Light guide and films', 'Reflector']
  const loupe = { cx: p.x + 85, cy: p.y + 70, r: 42 }
  const v = u * VALUE
  const f = u * LABEL
  const ty = loupe.cy - u * 0.4
  return (
    <Closeup>
      <defs>
        <pattern id="dt-px" width="9" height="10" patternUnits="userSpaceOnUse">
          <rect x="0.5" y="0.6" width="2.2" height="8.6" className="dt-sub r" />
          <rect x="3.4" y="0.6" width="2.2" height="8.6" className="dt-sub g" />
          <rect x="6.3" y="0.6" width="2.2" height="8.6" className="dt-sub b" />
        </pattern>
        <clipPath id="dt-loupe">
          <circle cx={loupe.cx} cy={loupe.cy} r={loupe.r} />
        </clipPath>
      </defs>
      <rect x={loupe.cx - loupe.r} y={loupe.cy - loupe.r} width={loupe.r * 2} height={loupe.r * 2} fill="url(#dt-px)" clipPath="url(#dt-loupe)" />
      <circle cx={loupe.cx} cy={loupe.cy} r={loupe.r} className="dt-glass" />
      <T x={loupe.cx + loupe.r + 8} y={ty} s={v}>
        {simple ? 'Tiny dots make the picture' : '224 pixels per inch'}
      </T>
      <T x={loupe.cx + loupe.r + 8} y={ty + v * LEAD} s={f}>
        {simple ? 'Each dot mixes red, green and blue' : 'Red, green and blue stripes'}
      </T>
      {brightness != null && (
        <T x={loupe.cx + loupe.r + 8} y={ty + v * LEAD + f * LEAD} s={v} v>
          Brightness {pct(brightness)}
        </T>
      )}
      {layers.map((name, i) => {
        const d = i * 24
        const x = p.x + 18 + d
        const y = bottom - 18 - d
        return (
          <g key={name}>
            <path d={`M ${x} ${y - 60} V ${y} H ${x + 130}`} className={`dt-ply ${i ? '' : 'outer'}`} />
            <T x={x + 136} y={y + f * 0.35} s={f}>
              {name}
            </T>
          </g>
        )
      })}
      {/* Edge-lit: a strip of LEDs along the bottom edge shines into a light guide behind the LCD. */}
      <g style={{ opacity: lit }}>
        {Array.from({ length: 48 }, (_, i) => (
          <rect key={i} x={p.x + 12 + i * ((p.w - 24) / 48)} y={bottom + 1} width={5} height={2.6} rx="0.8" className="dt-led" />
        ))}
      </g>
      <T x={p.x + p.w - 12} y={bottom - 12} s={f} a="end">
        {simple ? 'Lights along the bottom' : 'LED backlight strip'}
      </T>
    </Closeup>
  )
}

export function CameraDetail({ g, on, isp }: { g: Geometry; on: boolean; isp: number | null }) {
  const u = unit('camera')
  const simple = useSimple()
  const n = box(g.L.notch)
  const cx = n.x + n.w / 2
  const cy = n.y + n.h / 2
  const f = u * LABEL
  const v = u * VALUE
  // Every label sits under the focus ring around the notch; leaders run down to them.
  const ly = under(n, f)
  const stackY = ly + f * 1.2
  return (
    <Closeup>
      <circle cx={cx} cy={cy} r={4.3} className="dt-barrel" />
      <circle cx={cx} cy={cy} r={2.1} className="dt-ring" />
      <circle cx={cx} cy={cy} r={1} className="dt-ring" />
      <rect x={cx - 10.4} y={cy - 0.7} width={2} height={1.4} rx="0.3" className="dt-als" />
      {/* Hardware wired: Apple's security guide says the camera cannot run without this light on. */}
      {on && <circle cx={cx + 8} cy={cy} r={2.6} className="dt-led-halo" />}
      <circle cx={cx + 8} cy={cy} r={0.9} className={`dt-cam-led ${on ? 'on' : ''}`} />
      <g className="dt-leader">
        <polyline points={`${cx - 9.4},${cy + 1} ${cx - 9.4},${ly - f * 1.2} ${cx - 16},${ly - f * 1.2}`} />
        <polyline points={`${cx + 8},${cy + 1} ${cx + 8},${ly - f * 1.2} ${cx + 16},${ly - f * 1.2}`} />
      </g>
      <T x={cx - 17} y={ly} s={f} a="end">
        Light sensor
      </T>
      <T x={cx + 17} y={ly} s={f}>
        Camera light
      </T>
      <T x={cx + 17} y={ly + v * LEAD} s={v} v>
        {on ? 'On: camera in use' : 'Off'}
      </T>
      <T x={cx + 17} y={ly + v * LEAD + f * LEAD} s={f}>
        {simple ? 'Always on when the camera is' : 'Wired to the camera'}
      </T>
      {!simple && on && isp != null && isp > 0 && (
        <T x={cx + 17} y={ly + v * LEAD + f * LEAD * 2} s={v} v>
          Image processor {isp.toFixed(1)} GB/s
        </T>
      )}
      <T x={n.x - 14} y={cy + f * 0.35} s={f} a="end">
        Notch
      </T>
      {/* Lens stack seen from the side: several moulded lens elements above the image sensor. */}
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse key={i} cx={cx} cy={stackY + i * 1.6} rx={4.6 - Math.abs(i - 2) * 0.5} ry={0.5} className="dt-lens" />
      ))}
      <rect x={cx - 5.5} y={stackY + 8.4} width={11} height={1.4} rx="0.2" className={`dt-sensor ${on ? 'on' : ''}`} />
      <T x={cx} y={ly} s={f} a="middle">
        {simple ? 'Camera' : '12 MP camera'}
      </T>
      <T x={cx - 7} y={stackY + 3.2 + f * 0.35} s={f} a="end">
        Lenses
      </T>
      <T x={cx - 7} y={stackY + 9.1 + f * 0.35} s={f} a="end">
        {simple ? 'Catches the light' : 'Image sensor'}
      </T>
    </Closeup>
  )
}
