import { useContext, useEffect, useRef, type CSSProperties } from 'react'
import type { Sample, Sensors } from './types.ts'
import { NA, pct } from './format.ts'
import { sensorsOf } from './story.ts'
import { useCanvasLoop } from './loop.ts'
import { InfoButton, LearnContext } from './Learn.tsx'
import { useSimple } from './simple.ts'
import { BASE, lidNormal, lidPoint, project, screenFacing, type P3, type View } from './inside.ts'
import { useOnScreen, useTokens } from './Pipelines.tsx'

// Where each sensor sits in the 13-inch MacBook Air, drawn in 3D with the lid at its live angle.
// Positions, in millimetres from the centre of the base (x right, y hinge to front, z up):
// - Camera, green light and ambient light sensor share the notch at the top of the display. Apple asks people
//   not to cover the camera because that blocks the light sensor beside it (https://support.apple.com/102177);
//   which side each sits on is not published, so their order here is a guess.
// - Three-mic array: Apple's spec (https://support.apple.com/126320). Apple silicon laptops put the mics in a
//   short line or triangle (https://github.com/chadmed/triforce); older Airs had them at the left end of the
//   hinge, which is where they are drawn. Estimated.
// - Four speakers, a woofer and a tweeter each side, under the case along the hinge, firing out through the gap
//   between case and display (iFixit M2 Air teardown, the same chassis as the M5).
// - Lid angle sensor: in the hinge (iFixit found it there in the 2019 16-inch MacBook Pro). Position along the
//   hinge estimated.
// - Trackpad 122 x 80 mm, with the Taptic Engine strip along its rear edge; keyboard area; display panel.
//   From docs/teardown-reference.md.

const VW = 760
const VH = 540
const HW = BASE.w / 2
const HD = BASE.d / 2
const Z = BASE.h

/** The camera, refitted to the lid angle so a closed laptop fills the frame as well as an open one. */
function fitView(a: number): View {
  const v: View = { yaw: -0.36, pitch: 0.55, scale: 1, cx: 0, cy: 0, dist: 1700 }
  const corners: P3[] = [[-HW, -HD, 0], [HW, -HD, 0], [HW, HD, 0], [-HW, HD, 0], [-HW, HD, Z], [HW, HD, Z], lidPoint(-HW, BASE.d, a), lidPoint(HW, BASE.d, a)]
  const ps = corners.map((p) => project(p, v))
  const [x0, x1] = [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0]))]
  const [y0, y1] = [Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[1]))]
  const k = Math.min(1.7, (VW - 70) / (x1 - x0), (VH - 50) / (y1 - y0))
  return { ...v, scale: k, cx: VW / 2 - ((x0 + x1) / 2) * k, cy: VH / 2 - ((y0 + y1) / 2) * k }
}
// ponytail: one view shared by the render and the canvas loop; fine while the panel shows a single map.
let V = fitView(110)

const pt = (p: P3) => project(p, V)
const pts = (ps: P3[]) => ps.map((p) => pt(p).slice(0, 2).map((v) => v.toFixed(1)).join(',')).join(' ')
/** A circle lying in a horizontal plane, as a polygon. */
const disc = (x: number, y: number, z: number, r: number, n = 18): P3[] => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI), z])

const MICS: P3[] = [[-128, -HD + 2, Z], [-118, -HD + 2, Z], [-108, -HD + 2, Z]]
const SPEAKERS = [
  { x0: -122, x1: -61, woofer: -84, tweeter: -112 },
  { x0: 61, x1: 122, woofer: 84, tweeter: 112 },
]
const LID_SENSOR: P3 = [132, -HD, Z - 2]

type SpotId = 'camera' | 'als' | 'mics' | 'speakers' | 'lid' | 'keys' | 'trackpad' | 'display'
type Spot = { id: SpotId; label: string; plain: string; topic: string; at: P3; dx: number; dy: number }

function spots(a: number): Spot[] {
  return [
    { id: 'camera', label: 'FaceTime camera + green light', plain: 'Camera and its green light', topic: 'camera-path', at: lidPoint(0, 211, a), dx: 18, dy: -14 },
    { id: 'als', label: 'Ambient light sensor', plain: 'Light sensor', topic: 'display-brightness', at: lidPoint(-11, 211, a), dx: -20, dy: -14 },
    { id: 'display', label: 'Display backlight', plain: 'Screen brightness', topic: 'display-brightness', at: lidPoint(92, 130, a), dx: 18, dy: 4 },
    { id: 'lid', label: 'Lid angle sensor', plain: 'Hinge angle', topic: 'lid-angle', at: LID_SENSOR, dx: 16, dy: 20 },
    { id: 'mics', label: 'Three-mic array', plain: 'Microphones', topic: 'audio-path', at: MICS[1], dx: -18, dy: 22 },
    { id: 'speakers', label: 'Speakers: woofer + tweeter each side', plain: 'Speakers', topic: 'audio-path', at: [SPEAKERS[1].woofer, -HD + 7, Z], dx: -16, dy: -16 },
    { id: 'keys', label: 'Keyboard backlight', plain: 'Key lights', topic: 'keyboard-light', at: [40, -60, Z], dx: 18, dy: 6 },
    { id: 'trackpad', label: 'Force Touch trackpad + Taptic Engine', plain: 'Trackpad and its click maker', topic: 'trackpad', at: [0, 30, Z], dx: 18, dy: 18 },
  ]
}

const onOff = (v: boolean | null, on = 'In use', off = 'Off') => (v == null ? NA : v ? on : off)
function spotValue(id: SpotId, x: Sensors): { v: string; live: boolean } {
  switch (id) {
    case 'camera':
      return { v: onOff(x.cameraInUse), live: x.cameraInUse === true }
    case 'mics':
      return { v: onOff(x.micInUse), live: x.micInUse === true }
    case 'speakers':
      return { v: onOff(x.audioPlaying, 'Playing', 'Silent'), live: x.audioPlaying === true }
    case 'lid':
      return { v: x.lidAngleDeg == null ? NA : `${Math.round(x.lidAngleDeg)}°`, live: false }
    case 'keys':
      return { v: pct(x.keyboardBacklight), live: (x.keyboardBacklight ?? 0) > 0 }
    case 'display':
      return { v: pct(x.displayBrightness), live: (x.displayBrightness ?? 0) > 0 }
    case 'als':
      return { v: 'not read', live: false }
    case 'trackpad':
      return { v: 'fingers on overview', live: false }
  }
}

const TOKENS = ['cam', 'mic', 'accent', 'accent-hi'] as const

/**
 * The map: the laptop and its markers are SVG, redrawn once per sample. The live effects (light into the camera,
 * sound into the mics and out of the speakers) are a canvas on the shared paced loop, which sleeps when none of
 * those three is in use.
 */
export function SensorMap({ s }: { s: Sample }) {
  const simple = useSimple()
  const learn = useContext(LearnContext)
  const x = sensorsOf(s)
  // Without a lid sensor the lid is drawn at a typical working angle, and the label says the angle is n/a.
  const a = x.lidAngleDeg ?? 110
  V = fitView(a)
  const facing = screenFacing(a, V)
  const list = spots(a)

  const live = { cam: x.cameraInUse === true && a > 8, mic: x.micInUse === true, audio: x.audioPlaying === true }
  const liveRef = useRef({ live, a })
  liveRef.current = { live, a }
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const onScreen = useOnScreen(wrap)
  const tokens = useTokens(TOKENS)
  const wake = useCanvasLoop(
    canvas,
    VW,
    (ctx, t, _dt, still) => {
      const c = tokens(ctx.canvas, t, still)
      ctx.clearRect(0, 0, VW, VH)
      const { live, a } = liveRef.current
      if (live.cam) drawCamera(ctx, a, t, still, c.cam)
      if (live.mic) for (const [i, m] of MICS.entries()) drawRings(ctx, m, t + i * 0.23, still, c.mic, -1)
      if (live.audio)
        for (const sp of SPEAKERS) {
          drawRings(ctx, [sp.woofer, -HD, Z + 1], t, still, c.accent, 1)
          drawRings(ctx, [sp.tweeter, -HD, Z + 1], t * 1.6, still, c['accent-hi'], 1)
        }
      return live.cam || live.mic || live.audio ? true : 'sleep'
    },
    !onScreen,
    s.t,
  )
  const key = `${live.cam}${live.mic}${live.audio}`
  useEffect(wake, [key, wake])

  const open = (sp: Spot, el: Element) => learn(sp.topic, el as HTMLElement)
  const kb = x.keyboardBacklight ?? 0
  const bright = x.displayBrightness

  // Base outline, top case, keyboard, trackpad.
  const top: P3[] = [[-HW, -HD, Z], [HW, -HD, Z], [HW, HD, Z], [-HW, HD, Z]]
  const front: P3[] = [[-HW, HD, 0], [HW, HD, 0], [HW, HD, Z], [-HW, HD, Z]]
  const left: P3[] = [[-HW, -HD, 0], [-HW, HD, 0], [-HW, HD, Z], [-HW, -HD, Z]]
  const keys: P3[][] = []
  for (let r = 0; r < 6; r++)
    for (let k = 0; k < 14; k++) {
      const x0 = -137 + k * (274 / 14) + 1.2
      const y0 = -92 + r * (97 / 6) + 1.2
      const w = 274 / 14 - 2.4
      const h = r === 0 ? 97 / 6 - 6 : 97 / 6 - 2.4
      keys.push([[x0, y0, Z], [x0 + w, y0, Z], [x0 + w, y0 + h, Z], [x0, y0 + h, Z]])
    }
  const pad: P3[] = [[-61, 17, Z], [61, 17, Z], [61, 97, Z], [-61, 97, Z]]
  const taptic: P3[] = [[-50, 21, Z], [50, 21, Z], [50, 31, Z], [-50, 31, Z]]
  // Lid.
  const lid: P3[] = [lidPoint(-HW, 0, a), lidPoint(HW, 0, a), lidPoint(HW, BASE.d, a), lidPoint(-HW, BASE.d, a)]
  const panel: P3[] = [lidPoint(-144, 10.7, a), lidPoint(144, 10.7, a), lidPoint(144, 208.5, a), lidPoint(-144, 208.5, a)]
  const notch: P3[] = [lidPoint(-16, 202, a), lidPoint(16, 202, a), lidPoint(16, 208.6, a), lidPoint(-16, 208.6, a)]
  // Angle arc at the right end of the hinge, from the base (pointing to the front) round to the lid.
  const arc: P3[] = Array.from({ length: 13 }, (_, i) => {
    const t = ((a * i) / 12) * (Math.PI / 180)
    return [HW + 4, -HD + 46 * Math.cos(t), Z + 46 * Math.sin(t)]
  })
  const arcMid = pt(arc[6])

  return (
    <div className="smap">
      <div ref={wrap} className="smap-wrap" style={{ '--kb': kb, '--bright': bright ?? 0.35 } as CSSProperties}>
        <svg viewBox={`0 0 ${VW} ${VH}`} className="smap-svg" role="group" aria-label={`MacBook Air with its sensors, lid at ${x.lidAngleDeg == null ? 'an unknown angle' : `${Math.round(a)} degrees`}`}>
          <polygon points={pts(left)} className="sm-side" />
          <polygon points={pts(front)} className="sm-front" />
          <polygon points={pts(top)} className="sm-top" />
          {SPEAKERS.map((sp) => (
            <g key={sp.x0} className="sm-under">
              <polygon points={pts([[sp.x0, -HD + 1, Z], [sp.x1, -HD + 1, Z], [sp.x1, -HD + 13, Z], [sp.x0, -HD + 13, Z]])} />
              <polygon points={pts(disc(sp.woofer, -HD + 7, Z, 5.5))} className={live.audio ? 'on' : ''} />
              <polygon points={pts(disc(sp.tweeter, -HD + 7, Z, 2.6))} className={live.audio ? 'on' : ''} />
            </g>
          ))}
          {keys.map((k, i) => (
            <polygon key={i} points={pts(k)} className="sm-key" />
          ))}
          <polygon points={pts(pad)} className="sm-pad" />
          <polygon points={pts(taptic)} className="sm-taptic" />
          {MICS.map((m, i) => (
            <polygon key={i} points={pts(disc(m[0], m[1], m[2], 1.6, 8))} className={`sm-mic ${live.mic ? 'on' : ''}`} />
          ))}
          <line {...seg([-122, -HD, Z], [122, -HD, Z])} className="sm-hinge" />
          <polygon points={pts(lid)} className={facing ? 'sm-bezel' : 'sm-lidback'} />
          {facing && (
            <>
              <polygon points={pts(panel)} className="sm-panel" />
              <polygon points={pts(notch)} className="sm-notch" />
              <circle cx={pt(lidPoint(0, 205.5, a))[0]} cy={pt(lidPoint(0, 205.5, a))[1]} r="2.6" className="sm-lens" />
              <circle cx={pt(lidPoint(7, 205.5, a))[0]} cy={pt(lidPoint(7, 205.5, a))[1]} r="1.6" className={`sm-led ${live.cam ? 'on' : ''}`} />
            </>
          )}
          <polyline points={pts(arc)} className="sm-arc" />
          <text x={arcMid[0] + 10} y={arcMid[1]} className="sm-angle">
            {x.lidAngleDeg == null ? 'angle n/a' : `${Math.round(a)}°`}
          </text>
          {list.map((sp, i) => {
            const [px, py] = pt(sp.at)
            const val = spotValue(sp.id, x)
            const name = simple ? sp.plain : sp.label
            return (
              <g
                key={sp.id}
                className={`sm-spot ${val.live ? 'live' : ''} sm-${sp.id}`}
                role="button"
                tabIndex={0}
                aria-label={`${i + 1}. ${name}: ${val.v}. Opens its explainer.`}
                onClick={(e) => open(sp, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    open(sp, e.currentTarget)
                  }
                }}
              >
                <circle cx={px} cy={py} r="16" className="sm-hit" />
                <circle cx={px} cy={py} r="9.5" className="sm-dot" />
                <text x={px} y={py + 3.6} className="sm-num">
                  {i + 1}
                </text>
                <text x={px + sp.dx} y={py + sp.dy} className="sm-label" textAnchor={sp.dx < 0 ? 'end' : 'start'}>
                  {name}
                </text>
              </g>
            )
          })}
        </svg>
        <canvas ref={canvas} className="smap-canvas" aria-hidden />
      </div>
      <ol className="smap-legend">
        {list.map((sp, i) => {
          const val = spotValue(sp.id, x)
          return (
            <li key={sp.id} className={val.live ? 'live' : ''}>
              <span className="smap-n">{i + 1}</span>
              <span className="smap-name">{simple ? sp.plain : sp.label}</span>
              <span className={`smap-v ${val.v === NA ? 'na' : ''}`}>{val.v}</span>
              <InfoButton topic={sp.topic} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function seg(p: P3, q: P3) {
  const [x1, y1] = pt(p)
  const [x2, y2] = pt(q)
  return { x1, y1, x2, y2 }
}

const add = (p: P3, q: P3, k = 1): P3 => [p[0] + q[0] * k, p[1] + q[1] * k, p[2] + q[2] * k]

/** Light from the scene converging on the lens: a soft cone along the display normal and photons running in. */
function drawCamera(ctx: CanvasRenderingContext2D, a: number, t: number, still: boolean, color: string) {
  const lens = lidPoint(0, 205.5, a)
  const n = lidNormal(a)
  const r = (a * Math.PI) / 180
  const up: P3 = [0, Math.cos(r), Math.sin(r)]
  // The lens sits near the top of the frame, so past about 110 degrees a full-size cone points off the map.
  // Shrink it until its far ring fits.
  let k = 1
  const ring = (): P3[] => Array.from({ length: 16 }, (_, i) => add(add(add(lens, n, 230 * k), [1, 0, 0], 62 * k * Math.cos((i / 16) * 2 * Math.PI)), up, 42 * k * Math.sin((i / 16) * 2 * Math.PI)))
  const off = ([x, y]: number[]) => x < 4 || y < 4 || x > VW - 4 || y > VH - 4
  while (k > 0.2 && ring().some((p) => off(pt(p)))) k -= 0.05
  const far = add(lens, n, 230 * k)
  const [lx, ly] = pt(lens)
  const edge = ring().map((p) => pt(p))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 200)
  g.addColorStop(0, hexA(color, 0.36))
  g.addColorStop(1, hexA(color, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  hull([[lx, ly], ...edge.map(([x, y]) => [x, y] as [number, number])]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fill()
  // The far end of the cone, where the scene is.
  ctx.strokeStyle = hexA(color, 0.35)
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])
  // LED glow, pulsing slowly.
  const [gx, gy] = pt(lidPoint(7, 205.5, a))
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 16)
  glow.addColorStop(0, hexA(color, still ? 0.8 : 0.6 + 0.3 * Math.sin(t * 3)))
  glow.addColorStop(1, hexA(color, 0))
  ctx.fillStyle = glow
  ctx.fillRect(gx - 16, gy - 16, 32, 32)
  if (!still) {
    ctx.fillStyle = color
    for (let i = 0; i < 18; i++) {
      const k = (t * 0.55 + i * 0.381) % 1
      const ang = i * 2.39996
      const src = add(add(far, [1, 0, 0], 58 * k * Math.cos(ang) * ((i % 3) / 3 + 0.4)), up, 40 * k * Math.sin(ang) * ((i % 3) / 3 + 0.4))
      const [px, py] = pt([src[0] + (lens[0] - src[0]) * k, src[1] + (lens[1] - src[1]) * k, src[2] + (lens[2] - src[2]) * k])
      ctx.globalAlpha = 0.25 + 0.75 * k
      ctx.beginPath()
      ctx.arc(px, py, 1.4 + 1.2 * (1 - k), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Ripples in the plane of the deck: dir -1 shrinks onto the point (sound arriving), 1 spreads out (sound leaving). */
function drawRings(ctx: CanvasRenderingContext2D, at: P3, t: number, still: boolean, color: string, dir: 1 | -1) {
  const [x, y] = pt(at)
  const rx = V.scale
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  for (let i = 0; i < 3; i++) {
    const ph = still ? (i + 0.5) / 3 : (t * 0.8 + i / 3) % 1
    const k = dir > 0 ? ph : 1 - ph
    const rad = 3 + 22 * k
    ctx.globalAlpha = dir > 0 ? 0.9 * (1 - k) : 0.9 * (1 - k) + 0.1
    ctx.beginPath()
    ctx.ellipse(x, y, rad * rx, rad * rx * Math.sin(V.pitch) * 0.9, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** Convex hull (monotone chain), so the cone outline is the silhouette of lens plus far ring. */
function hull(p: [number, number][]): [number, number][] {
  const s = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (pts: [number, number][]) => {
    const h: [number, number][] = []
    for (const q of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop()
      h.push(q)
    }
    return h.slice(0, -1)
  }
  return [...half(s), ...half(s.reverse())]
}

/** A token colour with alpha; tokens are written as #rrggbb. */
function hexA(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`
}
