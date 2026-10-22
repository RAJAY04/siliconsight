import { useEffect, useMemo, useRef, useState } from 'react'
import { gpuMhz, pct, watts } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, lerp, phase, reducedMotion, useSteps, type LabProps, type Step } from './kit.tsx'
import { GH, GW, PRESETS, diverge, groups, inTriangle, parallel, render, serial, type PresetId, type Pt } from './gpu.ts'
import './GpuParallel.css'

// A CPU and a GPU side by side, then inside one SIMD-group of 32 lanes, then a triangle going from three
// vertices to painted pixels, then the matrix maths behind AI. Coordinates are in the SVG's 960 x 540 viewBox.

const LANES = Array.from({ length: GW * GH }, (_, i) => ({ x: i % GW, y: Math.floor(i / GW) }))
const LANE = (i: number) => ({ x: 430 + (i % GW) * 62, y: 150 + Math.floor(i / GW) * 62 })
// Step 3's split: lanes inside a circle that crosses this 8 x 4 block take the if side.
const COND = LANES.map(({ x, y }) => (x - 0.5) ** 2 + (y + 1.5) ** 2 < 22)
const SPLIT = diverge(COND)

// The frame: a 48 x 24 pixel screen and one triangle on it, in pixel units.
const SW = 48
const SH = 24
const TRI: Pt[] = [
  [5, 21],
  [26, 2],
  [44, 18],
]
const MODEL: Pt[] = [
  [-1, 1],
  [0, -1],
  [1, 0.6],
]
const COVER = Array.from({ length: SW * SH }, (_, i) => inTriangle([(i % SW) + 0.5, Math.floor(i / SW) + 0.5], TRI[0], TRI[1], TRI[2]))
const FRAG_WORK: number[] = COVER.map((c) => (c ? 1 : 0))
const FRAG_N = FRAG_WORK.reduce((a, b) => a + b, 0)
const TILES = groups(SW, SH)
const TILE_OF = (() => {
  const out: number[] = []
  TILES.forEach((g, n) => g.forEach((i) => (out[i] = n)))
  return out
})()
const SER = serial(FRAG_WORK)
const mixStyle = (v: number) => ({ fill: `color-mix(in srgb, var(--warn) ${Math.round(v * 100)}%, var(--accent-alt))` })

function CpuGpu({ t, pCores, eCores, gpuCores }: { t: number; pCores: number; eCores: number; gpuCores: number | null }) {
  const simple = useSimple()
  const n = gpuCores ?? 8
  const cols = Math.ceil(Math.sqrt(n * 1.6))
  const rows = Math.ceil(n / cols)
  const cw = Math.min(110, 450 / cols)
  const ch = Math.min(110, 380 / rows)
  const dots = cw > 40 ? 8 : 4
  const wave = phase(t, 0.3, 2.6)
  const cores = [...Array.from({ length: pCores }, () => 'P'), ...Array.from({ length: eCores }, () => 'E')]
  return (
    <svg className="gp-scene" viewBox="0 0 960 540" role="img" aria-label="A CPU with a few large cores next to a GPU with many cores full of small lanes">
      <text className="gp-head" x={30} y={40}>
        {simple ? `Workers: ${pCores} Fast, ${eCores} Eco` : `CPU: ${pCores} P cores, ${eCores} E cores`}
      </text>
      <text className="gp-note" x={30} y={60}>
        {simple ? 'each one clever, with lots of room for planning' : 'most of each core plans, predicts and caches'}
      </text>
      {cores.map((k, i) => {
        const big = k === 'P'
        const s = big ? 90 : 70
        const x = 30 + (i % 4) * 100
        const y = 80 + Math.floor(i / 4) * 100 + (big ? 0 : 10)
        const on = (i + Math.floor(t * 3)) % 3 === 0 && t < 2.8
        const alus = big ? 4 : 2
        const aw = (s - 16) / alus
        return (
          <g key={i} className={`gp-cpu ${big ? 'p' : 'e'}`}>
            <rect x={x} y={y} width={s} height={s} rx={8} />
            <rect className="gp-ctl" x={x + 6} y={y + 6} width={s - 12} height={s * 0.5} rx={4} />
            <text className="gp-tiny" x={x + s / 2} y={y + 6 + s * 0.3} textAnchor="middle">
              {simple ? 'planning' : 'control'}
            </text>
            {Array.from({ length: alus }, (_, j) => (
              <rect key={j} className={`gp-alu ${on ? 'on' : ''}`} x={x + 8 + j * aw} y={y + s * 0.64} width={aw - 4} height={s * 0.26} rx={3} />
            ))}
          </g>
        )
      })}
      <text className="gp-head" x={480} y={40}>
        {gpuCores == null ? (simple ? 'Graphics chip: core count unknown, 8 drawn' : 'GPU: core count not reported, 8 drawn') : simple ? `Graphics chip: ${n} cores` : `GPU: ${n} cores`}
      </text>
      <text className="gp-note" x={480} y={60}>
        {simple ? 'each core packed with simple helpers that do the same thing' : 'each core: many simple lanes, little control per lane'}
      </text>
      {Array.from({ length: n }, (_, c) => {
        const x = 480 + (c % cols) * cw
        const y = 80 + Math.floor(c / cols) * ch
        const sx = (cw - 16) / dots
        const sy = (ch - 16) / dots
        return (
          <g key={c} className="gp-core">
            <rect x={x} y={y} width={cw - 8} height={ch - 8} rx={6} />
            {Array.from({ length: dots * dots }, (_, d) => {
              const dx = d % dots
              const dy = Math.floor(d / dots)
              const lit = (dx + dy + c) / (2 * dots + n) < wave * 1.2
              return <rect key={d} className={`gp-lane ${lit ? 'on' : ''}`} x={x + 4 + dx * sx} y={y + 4 + dy * sy} width={sx - 2} height={sy - 2} rx={1.5} />
            })}
          </g>
        )
      })}
      <text className="gp-fine" x={30} y={500}>
        {simple
          ? 'The workers are built to finish one long list fast. The graphics chip runs one short list on thousands of pixels at once.'
          : 'A CPU core spends its transistors running one instruction stream fast. A GPU spends them on lanes, and keeps thousands of threads in flight.'}
      </text>
      <text className="gp-fine" x={30} y={522}>
        {simple ? 'Apple says the M1 graphics chip can run nearly 25,000 threads at the same time.' : 'Apple: the M1 GPU runs nearly 25,000 threads simultaneously. Lanes drawn here are not to scale.'}
      </text>
    </svg>
  )
}

const CODE_PAINT = ['kernel void paint(uint2 gid)', 'float x = gid.x / 7.0;', 'float4 c = mix(blue, orange, x);', 'out.write(c, gid);']
const CODE_IF = ['bool in = length(gid - o) < r;', 'if (in)', '    c = orange;', 'else', '    c = blue;']

function Lanes({ t, mode }: { t: number; mode: 'simd' | 'branch' }) {
  const simple = useSimple()
  const code = mode === 'simd' ? CODE_PAINT : CODE_IF
  // Which line the group's one program counter is on.
  const line = mode === 'simd' ? Math.min(3, Math.floor(t / 1.3)) : t < 1.2 ? 0 : t < 3.6 ? 2 : t < 6 ? 4 : -1
  const pass = mode === 'branch' ? (t < 1.2 ? 0 : t < 3.6 ? 1 : t < 6 ? 2 : 3) : 0
  const lit = (i: number) => line === i || (mode === 'branch' && ((pass === 1 && i === 1) || (pass === 2 && i === 3)))
  return (
    <svg className="gp-scene" viewBox="0 0 960 540" role="img" aria-label={mode === 'simd' ? 'One SIMD-group of 32 lanes running the same instruction' : 'A SIMD-group splitting at an if and else'}>
      <text className="gp-head" x={30} y={40}>
        {simple ? 'The one list every helper follows' : 'Shader code, one program counter'}
      </text>
      <rect className="gp-code" x={30} y={56} width={370} height={code.length * 36 + 20} rx={10} />
      {code.map((c, i) => (
        <g key={i} className={`gp-line ${lit(i) ? 'on' : ''}`}>
          <rect x={38} y={66 + i * 36} width={354} height={30} rx={6} />
          <text className="gp-mono" x={48} y={86 + i * 36} xmlSpace="preserve">
            {c}
          </text>
        </g>
      ))}
      <text className="gp-head" x={430} y={40}>
        {simple ? '32 helpers, one team' : 'One SIMD-group: 32 lanes, an 8 x 4 block of pixels'}
      </text>
      <text className="gp-note" x={430} y={60}>
        {simple ? 'they all do the same line at the same moment' : 'every lane runs the same instruction in the same cycle'}
      </text>
      {LANES.map((l, i) => {
        const p = LANE(i)
        let cls = ''
        let label = `${l.x},${l.y}`
        let style: { fill: string } | undefined
        if (mode === 'simd') {
          if (line >= 1) label = (l.x / 7).toFixed(2)
          if (line >= 2) style = mixStyle(l.x / 7)
          cls = 'act'
        } else {
          const yes = COND[i]
          label = pass === 0 && t < 0.4 ? `${l.x},${l.y}` : yes ? 'in' : 'out'
          cls = pass === 1 ? (yes ? 'act' : 'masked') : pass === 2 ? (yes ? 'masked' : 'act') : 'act'
          if ((pass >= 1 && yes) || (pass >= 2 && !yes)) style = mixStyle(yes ? 1 : 0)
        }
        return (
          <g key={i} className={`gp-lanebox ${cls} ${style ? 'painted' : ''}`}>
            <rect x={p.x} y={p.y} width={54} height={54} rx={7} style={style} />
            <text className="gp-lane-t" x={p.x + 27} y={p.y + 32} textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}
      {mode === 'branch' && (
        <g>
          <text className="gp-head" x={430} y={420}>
            {simple ? 'Time the team spends' : 'Passes the group needs'}
          </text>
          {[1, 2].map((n) => (
            <g key={n} className={`gp-pass ${pass >= n ? 'on' : ''}`}>
              <rect x={430 + (n - 1) * 250} y={432} width={240} height={34} rx={7} />
              <text x={442 + (n - 1) * 250} y={454}>
                {n === 1 ? (simple ? `turn 1: ${SPLIT.yes} work, ${SPLIT.no} wait` : `if: ${SPLIT.yes} active, ${SPLIT.no} masked`) : simple ? `turn 2: ${SPLIT.no} work, ${SPLIT.yes} wait` : `else: ${SPLIT.no} active, ${SPLIT.yes} masked`}
              </text>
            </g>
          ))}
          <text className="gp-fine" x={430} y={496}>
            {simple ? 'Both sides run one after the other, so the team takes the time of both.' : `${SPLIT.passes} passes instead of 1: lanes stay busy only when the whole group agrees.`}
          </text>
        </g>
      )}
      {mode === 'simd' && (
        <text className="gp-fine" x={430} y={420}>
          {simple ? 'One instruction read, 32 answers. That is why each helper can be so simple.' : 'One fetch and decode feeds 32 lanes. threadExecutionWidth is 32 on this Mac.'}
        </text>
      )}
    </svg>
  )
}

/** Steps 4 to 6: one triangle, from vertices to coverage to painted fragments. */
function Frame({ t, stage, cores }: { t: number; stage: 'vertex' | 'raster' | 'shade'; cores: number }) {
  const simple = useSimple()
  const one = stage !== 'shade'
  const cell = one ? 12.5 : 9
  const panels = one
    ? [{ x: 330, y: 110, who: 'gpu' as const }]
    : [
        { x: 30, y: 150, who: 'cpu' as const },
        { x: 498, y: 150, who: 'gpu' as const },
      ]
  const k = phase(t, 0.3, 2.6)
  const toScreen = (p: Pt, ox: number, oy: number): Pt => [ox + p[0] * cell, oy + p[1] * cell]
  const model = (p: Pt): Pt => [140 + p[0] * 70, 250 + p[1] * 70]
  const wave = Math.floor(t / 0.35)
  const tick = Math.floor(t / 0.55)
  const par = parallel(FRAG_WORK, SW, SH, cores)
  return (
    <svg className="gp-scene" viewBox="0 0 960 540" role="img" aria-label="A triangle going through the vertex stage, rasterization, and fragment shading">
      {stage === 'vertex' && (
        <g>
          <text className="gp-head" x={30} y={100}>
            {simple ? 'The shape, as the app sends it' : 'Model space: 3 vertices'}
          </text>
          <rect className="gp-code" x={30} y={140} width={220} height={220} rx={10} />
          <polygon className="gp-tri ghost" points={MODEL.map((p) => model(p).join(',')).join(' ')} />
          <path className="gp-flow" d="M 260 250 L 318 250" markerEnd="url(#gp-arrow)" />
        </g>
      )}
      <defs>
        <marker id="gp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="gp-arrowhead" />
        </marker>
      </defs>
      {panels.map((p) => {
        const tri = TRI.map((v) => toScreen(v, p.x, p.y))
        const fin = p.who === 'cpu' ? SER : par
        const done = (i: number) => {
          if (!COVER[i]) return false
          if (stage === 'raster') return TILE_OF[i] < wave * cores
          return stage === 'shade' && fin.finish[i] <= tick
        }
        const count = COVER.filter((_, i) => done(i)).length
        return (
          <g key={p.who}>
            <text className="gp-head" x={p.x} y={p.y - 30}>
              {stage === 'shade'
                ? p.who === 'cpu'
                  ? simple
                    ? 'One worker: one pixel per tick'
                    : 'CPU-style: one fragment per tick'
                  : simple
                    ? `Graphics chip: ${cores} teams of 32 per tick`
                    : `GPU-style: ${cores} SIMD-groups per tick`
                : simple
                  ? `The screen, ${SW} x ${SH} pixels`
                  : `Screen space, ${SW} x ${SH} pixels`}
            </text>
            {stage !== 'vertex' && (
              <text className="gp-note" x={p.x} y={p.y - 12}>
                {count} of {FRAG_N} {simple ? 'pixels' : 'fragments'}
                {stage === 'shade' && `, tick ${Math.min(tick, fin.total)}${tick >= fin.total ? (simple ? ', done' : ', finished') : `, needs ${fin.total}`}`}
              </text>
            )}
            <rect className="gp-screen" x={p.x} y={p.y} width={SW * cell} height={SH * cell} />
            {COVER.map((_, i) =>
              done(i) ? (
                <rect key={i} className={stage === 'raster' ? 'gp-frag' : 'gp-px'} x={p.x + (i % SW) * cell + 0.5} y={p.y + Math.floor(i / SW) * cell + 0.5} width={cell - 1} height={cell - 1} style={stage === 'shade' ? mixStyle((i % SW) / (SW - 1)) : undefined} />
              ) : null,
            )}
            {stage !== 'vertex' && (
              <g className="gp-tiles">
                {Array.from({ length: SW / GW + 1 }, (_, n) => (
                  <line key={'v' + n} x1={p.x + n * GW * cell} x2={p.x + n * GW * cell} y1={p.y} y2={p.y + SH * cell} />
                ))}
                {Array.from({ length: SH / GH + 1 }, (_, n) => (
                  <line key={'h' + n} x1={p.x} x2={p.x + SW * cell} y1={p.y + n * GH * cell} y2={p.y + n * GH * cell} />
                ))}
              </g>
            )}
            {stage === 'vertex' ? (
              <>
                <polygon className="gp-tri" opacity={k} points={tri.map((v) => v.join(',')).join(' ')} />
                {TRI.map((v, n) => {
                  const a = model(MODEL[n])
                  const b = toScreen(v, p.x, p.y)
                  return (
                    <g key={n} className="gp-vtx" transform={`translate(${lerp(a[0], b[0], k)} ${lerp(a[1], b[1], k)})`}>
                      <circle r={10} />
                      <text y={4} textAnchor="middle">
                        {'abc'[n]}
                      </text>
                    </g>
                  )
                })}
              </>
            ) : (
              <polygon className="gp-tri edge" points={tri.map((v) => v.join(',')).join(' ')} />
            )}
          </g>
        )
      })}
      <text className="gp-fine" x={30} y={500}>
        {stage === 'vertex'
          ? simple
            ? 'A tiny program runs once for each corner and works out where it lands on the screen. All 3 run at once.'
            : "Vertex stage: a vertex shader runs once per vertex, in parallel, and outputs each one's screen position."
          : stage === 'raster'
            ? simple
              ? 'For every pixel: is its centre inside the triangle? Grid lines mark blocks of 32 pixels, one team each.'
              : 'Rasterization: test each pixel centre against the three edges; each covered pixel becomes a fragment. Grid lines mark 8 x 4 blocks.'
            : simple
              ? 'Colour every covered pixel with the same rule. Helpers over empty pixels in a block just wait.'
              : 'Fragment stage: one thread per fragment, 32 per SIMD-group. Lanes over uncovered pixels sit masked off.'}
      </text>
    </svg>
  )
}

function Matmul({ t }: { t: number }) {
  const simple = useSimple()
  const N = 8
  const kk = Math.min(N, Math.floor(t / 0.6))
  const cs = 26
  const A = { x: 40, y: 200 }
  const B = { x: 330, y: 70 }
  const C = { x: 620, y: 200 }
  const active = kk >= 1 && kk <= N && t < N * 0.6 + 0.6
  const grid = (o: { x: number; y: number }, hot: (r: number, c: number) => boolean, key: string) =>
    Array.from({ length: N * N }, (_, i) => {
      const r = Math.floor(i / N)
      const c = i % N
      return <rect key={key + i} className={`gp-m ${active && hot(r, c) ? 'hot' : ''}`} x={o.x + c * cs} y={o.y + r * cs} width={cs - 3} height={cs - 3} rx={3} />
    })
  return (
    <svg className="gp-scene" viewBox="0 0 960 540" role="img" aria-label="Matrix multiply: every output cell is its own dot product, so all 64 run at once">
      <text className="gp-head" x={A.x} y={A.y - 14}>
        A
      </text>
      <text className="gp-head" x={B.x} y={B.y - 14}>
        B
      </text>
      <text className="gp-head" x={C.x} y={C.y - 14}>
        C = A x B
      </text>
      {grid(A, (_r, c) => c === kk - 1, 'a')}
      {grid(B, (r) => r === kk - 1, 'b')}
      {Array.from({ length: N * N }, (_, i) => (
        <rect key={'c' + i} className="gp-m out" x={C.x + (i % N) * cs} y={C.y + Math.floor(i / N) * cs} width={cs - 3} height={cs - 3} rx={3} style={{ fillOpacity: 0.1 + (0.9 * kk) / N }} />
      ))}
      <text className="gp-big" x={C.x} y={C.y + N * cs + 30}>
        {simple ? `Step ${kk} of ${N}` : `k = ${kk} of ${N}`}
      </text>
      <text className="gp-fine" x={40} y={474}>
        {simple
          ? `Each of the 64 answer squares is its own sum of 8 multiplies. One helper per square: all 64 finish in ${N} steps.`
          : `Each of the 64 outputs is an independent dot product of ${N} multiply-adds. One thread per output: ${N} steps for all of them.`}
      </text>
      <text className="gp-fine" x={40} y={498}>
        {simple ? `One worker doing them one at a time needs ${N * N * N} steps.` : `One scalar lane doing them in turn needs ${N * N * N} multiply-adds in a row.`}
      </text>
      <text className="gp-fine" x={40} y={522}>
        {simple ? 'AI models are mostly this, with grids thousands of numbers wide.' : 'Neural networks are mostly large matrix multiplies like this one.'}
      </text>
    </svg>
  )
}

/** A CSS colour token as [r, g, b], read through a 1 x 1 canvas so the paint follows the theme. */
function tokenRgb(name: string, ctx: CanvasRenderingContext2D): [number, number, number] {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'gray'
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

const PW = 64
const PH = 48

function PaintRace({ gpuCores }: { gpuCores: number | null }) {
  const simple = useSimple()
  const [preset, setPreset] = useState<PresetId>('gradient')
  const [cores, setCores] = useState(gpuCores ?? 8)
  const [speed, setSpeed] = useState(2.5) // log10 of ticks per second
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const cpuRef = useRef<HTMLCanvasElement>(null)
  const gpuRef = useRef<HTMLCanvasElement>(null)
  const img = useMemo(() => render(preset, PW, PH), [preset])
  const ser = useMemo(() => serial(img.map((p) => p.work)), [img])
  const par = useMemo(() => parallel(img.map((p) => p.work), PW, PH, cores), [img, cores])
  const end = ser.total

  useEffect(() => {
    if (!playing) return
    if (reducedMotion()) {
      setTick(end)
      setPlaying(false)
      return
    }
    let raf = 0
    let last = performance.now()
    const rate = 10 ** speed
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setTick((x) => Math.min(end, x + dt * rate))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, end])
  useEffect(() => {
    if (tick >= end) setPlaying(false)
  }, [tick, end])

  useEffect(() => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!probe) return
    const lo = tokenRgb('--accent-alt', probe)
    const hi = tokenRgb('--warn', probe)
    for (const [ref, fin] of [
      [cpuRef, ser.finish],
      [gpuRef, par.finish],
    ] as const) {
      const ctx = ref.current?.getContext('2d')
      if (!ctx) continue
      const data = ctx.createImageData(PW, PH)
      img.forEach((p, i) => {
        if (fin[i] > tick) return
        for (let c = 0; c < 3; c++) data.data[i * 4 + c] = Math.round(lo[c] + (hi[c] - lo[c]) * p.v)
        data.data[i * 4 + 3] = 255
      })
      ctx.putImageData(data, 0, 0)
    }
  }, [tick, img, ser, par])

  const reset = () => {
    setPlaying(false)
    setTick(0)
  }
  const p = PRESETS.find((x) => x.id === preset)!
  const doneCount = (fin: number[]) => fin.filter((f) => f <= tick).length
  const eff = par.useful / par.issued
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: one painter against a team' : 'Try it: paint serially and in parallel'}</h3>
      <p className="fine">
        {simple
          ? `Pick a rule. The same rule decides the colour of each of the ${PW * PH} pixels. On the left one worker paints pixel by pixel. On the right each graphics core paints a block of 32 pixels at once. A tick is one step of the rule.`
          : `Pick a per-pixel rule for a ${PW} x ${PH} image. Left: one thread, one pixel at a time. Right: SIMD-groups of 32 lanes, each an 8 x 4 block, one group per GPU core at a time. A tick is one step of the rule, and a group takes as long as its slowest lane.`}
      </p>
      <div className="lab-try-row">
        <div className="lab-seg" role="group" aria-label={simple ? 'Rule' : 'Per-pixel rule'}>
          {PRESETS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={preset === x.id}
              onClick={() => {
                setPreset(x.id)
                reset()
              }}
            >
              {simple ? x.plain : x.label}
            </button>
          ))}
        </div>
        <label className="lab-field gp-range">
          <span>
            {simple ? 'Graphics cores' : 'GPU cores'}: {cores}
            {gpuCores != null && cores === gpuCores ? ' (this Mac)' : ''}
          </span>
          <input type="range" min={1} max={40} value={cores} onChange={(e) => setCores(+e.currentTarget.value)} />
        </label>
        <label className="lab-field gp-range">
          <span>
            {simple ? 'Speed' : 'Ticks per second'}: {Math.round(10 ** speed)}
          </span>
          <input type="range" min={1} max={4} step={0.1} value={speed} onChange={(e) => setSpeed(+e.currentTarget.value)} />
        </label>
      </div>
      <p className="gp-code-line">
        <code>{p.code}</code>
      </p>
      <div className="gp-race">
        <figure>
          <canvas ref={cpuRef} width={PW} height={PH} role="img" aria-label={simple ? 'One worker painting' : 'Serial painter'} />
          <figcaption>
            <b>{simple ? 'One worker' : 'One thread'}</b>: {doneCount(ser.finish)} of {PW * PH} pixels, {simple ? 'needs' : 'total'} <span className="num">{ser.total.toLocaleString('en-US')}</span> ticks
          </figcaption>
        </figure>
        <figure>
          <canvas ref={gpuRef} width={PW} height={PH} className="gp-grid" role="img" aria-label={simple ? 'The graphics chip painting' : 'Parallel painter'} />
          <figcaption>
            <b>{simple ? `${cores} graphics cores` : `${cores} cores x 32 lanes`}</b>: {doneCount(par.finish)} of {PW * PH} pixels, {simple ? 'needs' : 'total'} <span className="num">{par.total.toLocaleString('en-US')}</span> ticks
          </figcaption>
        </figure>
      </div>
      <div className="lab-try-row">
        <button
          type="button"
          className="lab-btn lab-play"
          onClick={() => {
            if (tick >= end) setTick(0)
            setPlaying(!playing || tick >= end)
          }}
          aria-pressed={playing}
        >
          {playing ? 'Pause' : tick >= end ? 'Again' : 'Paint'}
        </button>
        <button
          type="button"
          className="lab-btn"
          onClick={() => {
            setPlaying(false)
            setTick(end)
          }}
        >
          {simple ? 'Skip to the end' : 'Jump to end'}
        </button>
        <button type="button" className="lab-btn" onClick={reset}>
          Clear
        </button>
      </div>
      <p className="lab-verdict ok" aria-live="polite">
        {simple ? `The team finishes ${Math.round(ser.total / par.total)} times sooner.` : `Parallel takes ${(ser.total / par.total).toFixed(1)} times fewer ticks.`}{' '}
        {preset === 'mandel'
          ? simple
            ? `But only ${Math.round(eff * 100)}% of the helpers' time is real work: in each block, helpers whose pixel finishes early wait for the slowest one.`
            : `Lane efficiency ${Math.round(eff * 100)}%: points near the set need up to 48 iterations, and the other lanes in their group sit masked until they finish. That is divergence.`
          : simple
            ? 'Every pixel takes the same effort, so no helper waits.'
            : 'Every pixel costs the same, so no lane waits: 100% lane efficiency.'}
      </p>
      <p className="fine">
        {simple
          ? 'This is a model, not a timing of your Mac. A real CPU core can also do a few pixels at once with its own small vector units.'
          : 'A model, not a measurement. Real GPU cores keep several SIMD-groups resident and switch between them, and a real CPU core has 128-bit SIMD units of its own.'}
      </p>
    </section>
  )
}

export default function GpuParallel({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const cores = hw.gpuCores ?? 8
  const fragTicks = parallel(FRAG_WORK, SW, SH, cores).total
  const steps: Step[] = [
    {
      title: simple ? 'A few clever workers, many simple helpers' : 'CPU versus GPU',
      dur: 3,
      tech: (
        <p>
          A CPU core runs one instruction stream as fast as it can, so most of its area goes on prediction, reordering and cache. A GPU runs the same short program over millions of pixels, so it spends its area on many simple arithmetic lanes instead, and hides waits for memory by keeping thousands of threads in flight. This Mac has {hw.pCores + hw.eCores} CPU cores and {hw.gpuCores ?? 'an unreported number of'} GPU cores.
        </p>
      ),
      plain: (
        <p>
          The main chip's workers are clever: each one plans ahead and guesses what comes next. The graphics chip is different. It has rows and rows of simple helpers that can't plan at all, but there are huge numbers of them and they all follow the same short list. This Mac has {hw.pCores + hw.eCores} workers and {hw.gpuCores ?? 'an unknown number of'} graphics cores.
        </p>
      ),
    },
    {
      title: simple ? 'Teams of 32' : 'SIMD-groups of 32',
      dur: 5.6,
      tech: (
        <p>
          The GPU doesn't schedule threads one at a time. Apple GPUs bundle them into SIMD-groups of 32 that share one program counter: one instruction is fetched and decoded, and all 32 lanes execute it in the same cycle, each on its own pixel. Here each lane reads its position, computes a shade and writes it. Asking Metal on this Mac for <code>threadExecutionWidth</code> returns 32.
        </p>
      ),
      plain: (
        <p>
          The helpers work in teams of 32. A team has one list and one finger on it: everyone does the same line at the same moment, each on their own pixel. One instruction read, 32 jobs done. That's how each helper can be so simple. Asking this Mac's graphics chip for its team size gives 32.
        </p>
      ),
    },
    {
      title: simple ? 'When the team disagrees' : 'Divergence: an if splits the group',
      dur: 6.6,
      tech: (
        <p>
          An <code>if</code> that some lanes take and others don't can't go both ways at once, because the group has one program counter. So it runs the <code>if</code> side with the other lanes masked off, then the <code>else</code> side with the first lanes masked. Here {SPLIT.yes} lanes are inside the circle and {SPLIT.no} are outside, so the group pays for both sides. When all 32 agree, only one side runs.
        </p>
      ),
      plain: (
        <p>
          The team shares one list, so what happens when some helpers need orange and others blue? They take turns: first the orange ones work while the rest wait, then the blue ones work while the rest wait. Here {SPLIT.yes} helpers are inside the circle and {SPLIT.no} are outside, so the team takes twice as long. If they all agree, nobody waits.
        </p>
      ),
    },
    {
      title: simple ? 'Drawing a frame: the corners' : 'A frame: vertices',
      dur: 3,
      tech: (
        <p>
          A 3D frame starts as triangles. The vertex stage runs a small program once per vertex to place it on screen, from the model's own coordinates through the camera to pixel coordinates. A frame can have millions of vertices, all independent, so they run in parallel, 32 to a group.
        </p>
      ),
      plain: (
        <p>
          Everything in a game or a 3D app is built from triangles. First, a tiny program works out where each corner of each triangle lands on your screen. Every corner is worked out the same way and on its own, so the helpers do them all at once.
        </p>
      ),
    },
    {
      title: simple ? 'Which pixels are inside' : 'Rasterize',
      dur: 3.6,
      tech: (
        <p>
          The rasterizer turns each triangle into fragments, one per covered pixel, by testing each pixel centre against the triangle's three edges. Apple GPUs work tile by tile: the screen is cut into tiles, each tile's visible triangles are found first, and hidden surfaces are removed before any shading. This triangle covers {FRAG_N} of the {SW * SH} pixels.
        </p>
      ),
      plain: (
        <p>
          Next the chip checks every pixel: is its centre inside the triangle or not? Apple's graphics chips do this one small square of the screen at a time, and skip anything hidden behind something else. This triangle covers {FRAG_N} of the {SW * SH} pixels.
        </p>
      ),
    },
    {
      title: simple ? 'Colouring the pixels' : 'Fragments: serial against parallel',
      dur: 6,
      tech: (
        <p>
          Each fragment runs the fragment shader: the same short program, a different position. On the left, one thread colours one fragment per tick and needs {FRAG_N} ticks. On the right, {cores} cores each take a SIMD-group of 32 per tick and finish in {fragTicks}. A real frame has millions of fragments, 60 or more times a second.
        </p>
      ),
      plain: (
        <p>
          Last, every covered pixel gets its colour, using the same rule with a different position. On the left one worker colours one pixel per tick and needs {FRAG_N} ticks. On the right, {cores} graphics cores each colour a block of 32 per tick and finish in {fragTicks}. A real screen has millions of pixels, redrawn many times a second.
        </p>
      ),
    },
    {
      title: simple ? 'Why AI uses the graphics chip' : 'Why AI runs on GPUs',
      dur: 5.4,
      tech: (
        <p>
          Matrix multiplication has the same shape as shading: every output element is an independent dot product. Give each one a thread and they all advance together, one multiply-add per step. Neural networks are mostly matrix multiplies, so they map onto the GPU the way pixels do. On the M5, Apple added a Neural Accelerator to each GPU core for this maths.
        </p>
      ),
      plain: (
        <p>
          AI is mostly one kind of sum: multiplying big grids of numbers. Each answer square needs only its own row and column, so every square can have its own helper, all working at the same time. It's the same trick as painting pixels. The M5 chip adds special AI helpers inside every graphics core.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const { i, t } = story
  let scene
  if (i === 0) scene = <CpuGpu t={t} pCores={hw.pCores} eCores={hw.eCores} gpuCores={hw.gpuCores} />
  else if (i <= 2) scene = <Lanes t={t} mode={i === 1 ? 'simd' : 'branch'} />
  else if (i <= 5) scene = <Frame t={t} stage={(['vertex', 'raster', 'shade'] as const)[i - 3]} cores={cores} />
  else scene = <Matmul t={t} />

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          simple
            ? 'Every frame on your screen is painted by this chip. Move a window or play a video and watch it wake up.'
            : 'The GPU drops to a low clock or powers off between bursts of work, so busy and clock jump around.'
        }
      >
        <LiveStat label={simple ? 'Graphics chip busy' : 'GPU busy'} value={pct(s.gpu.usage)} sub={<Sparkline values={history.map((x) => x.gpu.usage)} max={1} w={90} h={18} label="GPU busy over the last minutes" />} hot={(s.gpu.usage ?? 0) > 0.5} />
        <LiveStat label={simple ? 'Graphics clock' : 'GPU clock'} value={gpuMhz(s.gpu.freqMHz)} sub={simple ? 'ticks per second' : 'gpu.freqMHz'} />
        <LiveStat label={simple ? 'Graphics power' : 'GPU power'} value={watts(s.power.gpuW)} sub={simple ? 'energy it uses right now' : 'power.gpuW'} />
        <LiveStat label={simple ? 'Graphics cores' : 'GPU cores'} value={hw.gpuCores == null ? 'n/a' : String(hw.gpuCores)} sub={hw.gpuCores == null ? 'not reported' : simple ? 'teams of 32 run in each' : `${hw.chip}, SIMD width 32`} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">{scene}</div>
        <StepBar story={story} steps={steps} />
      </section>

      <PaintRace gpuCores={hw.gpuCores} />

      <Deeper title={simple ? 'What suits the graphics chip, and what does not' : 'What fits a GPU, and what does not'}>
        {simple ? (
          <>
            <p>The graphics chip wins when there are huge numbers of small jobs that all follow the same rule: pixels, video effects, physics and AI.</p>
            <ul>
              <li>It loses when each job needs different steps, like the Mandelbrot edges in the Try it card, because the team waits for its slowest member.</li>
              <li>It also loses on small jobs, where handing the work over costs more than doing it, and on long chains where each step needs the last one's answer.</li>
              <li>On this Mac the graphics chip and the workers share one desk, the same memory, so nothing has to be copied between them.</li>
            </ul>
          </>
        ) : (
          <>
            <p>GPUs win on data-parallel work: many independent elements, the same code for each, and enough of them to fill every lane. Graphics, image and video filters, physics and neural networks all fit.</p>
            <ul>
              <li>Divergent code wastes lanes: a SIMD-group takes as long as all the paths its lanes take, as in the Mandelbrot preset.</li>
              <li>Small jobs lose to launch overhead, and long dependent chains can't be split across lanes. Those belong on the CPU.</li>
              <li>Apple GPUs render tile by tile in on-chip tile memory and share unified memory with the CPU, so nothing is copied to a separate graphics card.</li>
              <li>On this Mac a threadgroup holds up to 1024 threads. Metal splits it into SIMD-groups of 32 and runs it on one GPU core, where its threads can share fast threadgroup memory.</li>
            </ul>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Apple WWDC22, Scale compute workloads across Apple GPUs', url: 'https://developer.apple.com/videos/play/wwdc2022/10159/', note: 'SIMD-groups, and threadExecutionWidth: "on all Apple GPUs, it is equal to 32". A threadgroup runs on one GPU core.' },
          { title: 'Apple, Calculating threadgroup and grid sizes', url: 'https://developer.apple.com/documentation/metal/calculating-threadgroup-and-grid-sizes', note: 'threadExecutionWidth, maxTotalThreadsPerThreadgroup, and one thread per pixel.' },
          { title: 'NVIDIA, CUDA programming guide: programming model', url: 'https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html', note: 'Lanes of a warp run the same instruction together, and a branch masks off the lanes that do not take it. NVIDIA calls a SIMD-group a warp.' },
          { title: 'Apple, Tailor your apps for Apple GPUs and tile-based deferred rendering', url: 'https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering', note: 'Vertex and fragment stages, tiling, and hidden surface removal on Apple GPUs.' },
          { title: 'Apple newsroom, Apple unleashes M1 (2020)', url: 'https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/', note: 'The M1 GPU runs nearly 25,000 threads simultaneously.' },
          { title: 'Apple newsroom, Apple unleashes M5 (2025)', url: 'https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/', note: 'A 10-core GPU with a Neural Accelerator in each core.' },
          { title: 'Apple Machine Learning Research, Exploring LLMs with MLX and the M5 Neural Accelerators', url: 'https://machinelearning.apple.com/research/exploring-llms-mlx-m5', note: 'Running language model matrix maths on the M5 GPU.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac (Apple M5): a small Metal compute program reports <code>threadExecutionWidth</code> 32, <code>threads_per_simdgroup</code> 32 from inside the kernel, and <code>maxTotalThreadsPerThreadgroup</code> 1024.
      </p>
    </div>
  )
}
