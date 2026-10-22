import { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { LabProps } from './labs/kit.tsx'
import { HowTo, OLD_READER, Unavailable, readBest, saveBest, usePoll } from './games/kit.tsx'
import type { Sample } from './types.ts'
import type { Live } from './useStream.ts'
import { InfoButton } from './Learn.tsx'
import { useSimple } from './simple.ts'
import {
  PAD_ASPECT,
  SHAPES,
  cover,
  GAMES,
  fromPad,
  gameAt,
  lidPoints,
  lidVerdict,
  outline,
  pathLength,
  pickTarget,
  scoreTrace,
  type GameId,
  type Pt,
  type Score,
  type ShapeKey,
} from './games.ts'

// Sensor mini-games: hit a lid angle with the real hinge, trace a shape on the real trackpad.

type GameProps = { s: Sample; live: Live; demo: boolean }

const NEW_GAMES: Record<Exclude<GameId, 'lid' | 'pad'>, React.LazyExoticComponent<React.ComponentType<LabProps>>> = {
  mole: lazy(() => import('./games/Mole.tsx')),
  'fill-ram': lazy(() => import('./games/FillRam.tsx')),
  watts: lazy(() => import('./games/Watts.tsx')),
  heat: lazy(() => import('./games/Heat.tsx')),
  wifi: lazy(() => import('./games/WifiHunt.tsx')),
}

/** Line drawings for the game cards, on a 32 x 32 grid. */
const ICONS: Record<GameId, React.ReactNode> = {
  lid: (
    <>
      <path d="M4 25 H28" />
      <path d="M8 25 L19 7" />
      <path d="M14 25 A6 6 0 0 0 11 20" />
    </>
  ),
  pad: (
    <>
      <rect x="4" y="7" width="24" height="18" rx="3" />
      <path d="M9 19 C11 11 15 11 16 16 S21 21 23 12" />
    </>
  ),
  mole: (
    <>
      <path d="M4 26 H28" />
      <path d="M8 26 C8 18 24 18 24 26" />
      <circle cx="16" cy="13" r="5" />
      <path d="M14 12 h0.1 M18 12 h0.1" />
    </>
  ),
  'fill-ram': (
    <>
      <rect x="4" y="9" width="24" height="12" rx="1.5" />
      <path d="M8 25 V21 M12 25 V21 M16 25 V21 M20 25 V21 M24 25 V21" />
      <rect x="7" y="12" width="12" height="6" fill="currentColor" stroke="none" opacity="0.5" />
    </>
  ),
  watts: <path d="M18 3 L8 18 H15 L13 29 L24 13 H17 Z" />,
  heat: (
    <>
      <path d="M13 19 V6 a3 3 0 0 1 6 0 V19 a5.5 5.5 0 1 1 -6 0 Z" />
      <path d="M16 13 V22" />
    </>
  ),
  wifi: (
    <>
      <path d="M4 12 C11 5 21 5 28 12" />
      <path d="M8 16.5 C13 12 19 12 24 16.5" />
      <path d="M12 21 C14.5 19 17.5 19 20 21" />
      <circle cx="16" cy="25" r="1.6" fill="currentColor" />
    </>
  ),
}

const GameIcon = ({ id }: { id: GameId }) => (
  <svg className="game-icon" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICONS[id]}
  </svg>
)

/** The games list at #play, or one game at #play/<id>. Only the open game is mounted, so only it can run. */
export function Games(p: LabProps) {
  const { s, live, demo } = p
  const simple = useSimple()
  const game = gameAt(location.hash)
  if (game) {
    const Picked = game.id === 'lid' || game.id === 'pad' ? null : NEW_GAMES[game.id]
    return (
      <div className="games game-page">
        {game.id === 'lid' && <LidGame s={s} live={live} demo={demo} />}
        {game.id === 'pad' && <PadGame s={s} live={live} demo={demo} />}
        {Picked && (
          <Suspense fallback={<p className="fine">Loading the game…</p>}>
            <Picked {...p} />
          </Suspense>
        )}
      </div>
    )
  }
  return (
    <div className="games">
      <p className="lede">
        {simple ? 'Quick games you play with the real parts of this Mac. Pick one to start.' : 'Quick games driven by real sensors and counters in this Mac. Winning one is proof the sensor and the reader both work.'}
      </p>
      <div className="game-list">
        {GAMES.map((g) => (
          <a key={g.id} className="game-card" href={`#play/${g.id}`}>
            <GameIcon id={g.id} />
            <span className="game-card-name">{g.name}</span>
            <span className="game-card-blurb">{simple ? g.plainBlurb : g.blurb}</span>
            {!simple && <span className="game-card-sub">{g.tech}</span>}
          </a>
        ))}
      </div>
    </div>
  )
}

// Lid Challenge

const ROUNDS = 5
const BEST_LID = 'macviz.best.lid'

type LidPhase = 'idle' | 'aim' | 'result' | 'done'
type LidRound = { target: number; got: number | null }

/** No clock: each round shows a target, the player sets the lid by eye with the live reading hidden, then presses Done. */
function LidGame({ s, live, demo }: GameProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const g = useRef({
    phase: 'idle' as LidPhase,
    rounds: [] as LidRound[],
    sim: 100,
    best: readBest(BEST_LID),
    newBest: false,
  }).current
  const action = useRef<HTMLButtonElement>(null)

  const read = () => (demo ? g.sim : live.lid)
  const cur = g.rounds[g.rounds.length - 1]
  const score = g.rounds.reduce((t, r) => t + (r.got == null ? 0 : lidPoints(r.got - r.target)), 0)

  const aim = () => {
    g.rounds.push({ target: pickTarget(read()), got: null })
    g.phase = 'aim'
    render()
  }
  const start = () => {
    Object.assign(g, { rounds: [], newBest: false })
    aim()
  }
  const done = () => {
    cur.got = read()
    g.phase = 'result'
    render()
  }
  const next = () => {
    if (g.rounds.length < ROUNDS) return aim()
    g.phase = 'done'
    g.newBest = score > (g.best ?? 0)
    if (g.newBest) {
      g.best = score
      saveBest(BEST_LID, score)
    }
    render()
  }
  const press = g.phase === 'aim' ? done : g.phase === 'result' ? next : start

  // The player is looking at the hinge, not the pointer: the button keeps focus and Space works anywhere on the page.
  useEffect(() => {
    action.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button')) return
      e.preventDefault()
      press()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // Before the game, the live reading proves the sensor works; it repaints while idle only.
  usePoll(g.phase === 'idle' || g.phase === 'done', render)

  if (!demo && s.sensors == null) return <Unavailable title="Lid angle not available">{OLD_READER}</Unavailable>
  if (!demo && live.lid == null)
    return (
      <Unavailable title="Lid angle not available">
        This Mac reports no hinge angle. Desktops have no lid, and MacBooks from before about 2019 only sense open or closed, with a magnet. If this is a recent MacBook, the lid may be closed on an external display.
      </Unavailable>
    )

  const angle = read()
  const err = cur?.got == null ? null : cur.got - cur.target
  const shown = g.phase === 'aim' ? null : g.phase === 'result' ? cur.got : angle

  return (
    <section className={`card lid-game phase-${g.phase}`} aria-labelledby="lid-title">
      <div className="game-head">
        <h3 id="lid-title">Lid Challenge</h3>
        {demo && <span className="sim-badge">Simulated</span>}
        <span className="game-score">
          <span className="num">{score}</span> pts
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>

      {g.phase === 'idle' && (
        <HowTo
          steps={[
            'Turn so you can see your Mac from the side, like the drawing below.',
            'Press Start. A target angle appears, for example 75°.',
            'Move the screen to that angle by eye. The live reading stays hidden while you aim.',
            <>Press <b>Done</b> or the space bar. You see how close you got, then the next target. {ROUNDS} targets, no time limit.</>,
          ]}
        />
      )}

      {g.phase !== 'idle' && (
        <div className="lid-pips" aria-label={`Target ${g.rounds.length} of ${ROUNDS}`}>
          {Array.from({ length: ROUNDS }, (_, i) => {
            const r = g.rounds[i]
            const p = r?.got == null ? null : lidPoints(r.got - r.target)
            return <span key={i} className={`pip ${p == null ? (r ? 'now' : '') : p >= 75 ? 'won' : p > 0 ? 'near' : 'lost'}`} />
          })}
        </div>
      )}

      <div className="lid-stage">
        <LidGauge angle={shown} target={g.phase === 'aim' || g.phase === 'result' ? cur.target : null} />
        <div className="lid-readout" aria-live="polite">
          {g.phase === 'aim' && (
            <>
              <span className="lid-label">Set the screen to</span>
              <span className="lid-now num">{cur.target}°</span>
            </>
          )}
          {g.phase === 'result' && (
            <>
              <span className="lid-now num">{err == null ? 'n/a' : `${Math.abs(Math.round(err))}° off`}</span>
              <span className="lid-delta">
                {err == null ? 'The hinge sent no reading. This round scores 0.' : `${lidVerdict(err)}. You set ${Math.round(cur.got!)}°, the target was ${cur.target}°. +${lidPoints(err)}`}
              </span>
            </>
          )}
          {(g.phase === 'idle' || g.phase === 'done') && (
            <>
              <span className="lid-label">{simple ? 'The screen is open' : 'Hinge angle now'}</span>
              <span className="lid-now num">{angle == null ? 'n/a' : `${Math.round(angle)}°`}</span>
            </>
          )}
        </div>
      </div>

      {g.phase === 'done' && (
        <div className="lid-summary">
          <p className="game-goal">
            {g.newBest ? 'New best: ' : 'Final score: '}
            <span className="num strong">{score}</span> of {ROUNDS * 100}
          </p>
          <table className="lid-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>You set</th>
                <th>Off by</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {g.rounds.map((r, i) => (
                <tr key={i}>
                  <td className="num">{r.target}°</td>
                  <td className="num">{r.got == null ? 'n/a' : `${Math.round(r.got)}°`}</td>
                  <td className="num">{r.got == null ? 'n/a' : `${Math.abs(Math.round(r.got - r.target))}°`}</td>
                  <td className="num">{r.got == null ? 0 : lidPoints(r.got - r.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {g.phase === 'idle' && !demo && angle != null && angle < 5 && <p className="game-hint">The lid reads closed. Open it to play.</p>}

      {demo && (
        <label className="sim-control">
          <span>Simulated hinge</span>
          <input
            type="range"
            min={0}
            max={135}
            step={1}
            value={g.sim}
            onChange={(e) => {
              g.sim = Number(e.currentTarget.value)
              render()
            }}
            aria-valuetext={`${g.sim} degrees`}
          />
        </label>
      )}

      <div className="game-actions">
        <button ref={action} type="button" className="game-go" onClick={press}>
          {g.phase === 'aim' ? 'Done' : g.phase === 'result' ? (g.rounds.length < ROUNDS ? 'Next target' : 'See my score') : g.phase === 'done' ? 'Play again' : 'Start'}
        </button>
      </div>

      <p className={g.phase === 'done' ? 'game-learn' : 'fine game-how'}>
        {simple
          ? 'A tiny sensor inside the hinge tells the Mac how far the screen is open, in degrees.'
          : 'Measured: the hinge angle, from a sensor in the hinge that macOS exposes as a HID device and reports in whole degrees. The reader forwards each change of half a degree or more, up to 30 times a second.'}
        <InfoButton topic="lid-angle" />
      </p>
    </section>
  )
}

/** A side view of the laptop on a protractor: the lid at the given angle, the target as a dashed ghost lid, and the miss as an arc. */
function LidGauge({ angle, target }: { angle: number | null; target: number | null }) {
  const P = { x: 120, y: 160 }
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180
    return { x: P.x + r * Math.cos(a), y: P.y - r * Math.sin(a) }
  }
  const arc = (a: number, b: number, r: number) => {
    const p = at(a, r)
    const q = at(b, r)
    return `M ${p.x} ${p.y} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 0 ${q.x} ${q.y}`
  }
  const lid = angle == null ? null : at(Math.max(0, Math.min(140, angle)), 108)
  const ghost = target == null ? null : at(target, 108)
  const label = `${angle == null ? '' : `Lid at ${Math.round(angle)} degrees. `}${target == null ? '' : `Target ${target} degrees.`}`
  return (
    <svg className="lid-gauge" viewBox="0 0 300 186" role="img" aria-label={label || 'Lid angle not shown.'}>
      <path d={arc(0, 140, 128)} className="lid-scale" />
      {Array.from({ length: 15 }, (_, i) => {
        const d = i * 10
        const a = at(d, 128)
        const b = at(d, d % 30 ? 122 : 116)
        return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="lid-tick" />
      })}
      {[30, 60, 90, 120].map((d) => {
        const t = at(d, 143)
        return (
          <text key={d} x={t.x} y={t.y + 4} className="lid-tick-label">
            {d}°
          </text>
        )
      })}
      {ghost && <line x1={P.x} y1={P.y} x2={ghost.x} y2={ghost.y} className="lid-ghost" />}
      {target != null && angle != null && Math.abs(angle - target) >= 1 && (
        <path d={arc(Math.min(angle, target), Math.max(angle, target), 120)} className="lid-miss" />
      )}
      <rect x={P.x - 4} y={P.y} width={168} height={9} rx={4} className="lid-base" />
      {lid && <line x1={P.x} y1={P.y} x2={lid.x} y2={lid.y} className="lid-lid" />}
      <circle cx={P.x} cy={P.y} r={6} className="lid-pivot" />
    </svg>
  )
}

// Trackpad Drawing

/** A finger with no fast message for this long counts as lifted: a backlogged socket can drop the lift message. */
const STALE_MS = 300
const bestKey = (k: ShapeKey) => `macviz.best.pad.${k}`

type PadPhase = 'ready' | 'drawing' | 'done'

function PadGame({ s, live, demo }: GameProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const [shape, setShape] = useState<ShapeKey>('circle')
  const out = useMemo(() => outline(shape), [shape])
  const canvas = useRef<HTMLCanvasElement>(null)
  // The stroke lives only here, in memory, for the length of one try.
  const g = useRef({
    phase: 'ready' as PadPhase,
    trace: [] as Pt[],
    covered: new Uint8Array(0),
    id: -1,
    many: false,
    finger: null as Pt | null,
    seen: 0,
    result: null as Score | null,
    best: readBest(bestKey('circle')),
    newBest: false,
    hint: '',
    say: '',
  }).current

  const tooOld = !demo && s.sensors == null
  const missing = !demo && live.at > 0 && live.fingers === null
  const name = SHAPES.find((x) => x.key === shape)!.name.toLowerCase()

  const draw = () => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.max(1, Math.round(c.clientWidth * dpr))
    const h = Math.max(1, Math.round(w / PAD_ASPECT))
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h })
    const css = getComputedStyle(c)
    const color = (v: string) => css.getPropertyValue(v).trim()
    const k = h // pixels per unit: the pad is one unit deep
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.lineCap = ctx.lineJoin = 'round'

    // The sensing grid under the glass, faint; the rows and columns under the finger light up.
    const f = g.finger
    ctx.lineWidth = 1 / k
    for (let i = 1; i < 16; i++) {
      const x = (i / 16) * PAD_ASPECT
      const y = i / 16
      ctx.strokeStyle = color('--line-strong')
      ctx.globalAlpha = f && Math.abs(f.x - x) < 0.08 ? 1 : 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, 1)
      ctx.stroke()
      ctx.globalAlpha = f && Math.abs(f.y - y) < 0.08 ? 1 : 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(PAD_ASPECT, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // The target, dashed, with each traced stretch lit.
    ctx.setLineDash([0.02, 0.018])
    ctx.lineWidth = 0.012
    ctx.strokeStyle = color('--muted')
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    out.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.strokeStyle = color('--ok')
    ctx.lineWidth = 0.018
    ctx.shadowColor = color('--ok')
    ctx.shadowBlur = 10
    ctx.beginPath()
    for (let i = 1; i < out.length; i++) {
      if (g.covered[i] && g.covered[i - 1]) {
        ctx.moveTo(out[i - 1].x, out[i - 1].y)
        ctx.lineTo(out[i].x, out[i].y)
      }
    }
    ctx.stroke()

    // The stroke, glowing.
    const t = g.trace
    if (t.length > 1) {
      ctx.strokeStyle = color('--accent')
      ctx.shadowColor = color('--accent')
      ctx.shadowBlur = 14
      ctx.lineWidth = 0.014
      ctx.beginPath()
      t.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
    }
    if (f) {
      const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 0.09)
      glow.addColorStop(0, color('--finger'))
      glow.addColorStop(1, 'transparent')
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.55
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(f.x, f.y, 0.09, 0, 2 * Math.PI)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = color('--finger')
      ctx.beginPath()
      ctx.arc(f.x, f.y, 0.022, 0, 2 * Math.PI)
      ctx.fill()
    }
    ctx.shadowBlur = 0
  }

  const reset = (k: ShapeKey) => {
    Object.assign(g, { phase: 'ready', trace: [], covered: new Uint8Array(0), id: -1, finger: null, result: null, newBest: false, hint: '' })
    g.best = readBest(bestKey(k))
  }

  const begin = (p: Pt) => {
    g.hint = ''
    g.trace = [p]
    g.covered = new Uint8Array(out.length)
    cover(g.covered, out, p)
    g.finger = p
    g.phase = 'drawing'
  }
  const add = (p: Pt) => {
    const last = g.trace[g.trace.length - 1]
    g.finger = p
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.003) return
    g.trace.push(p)
    cover(g.covered, out, p)
  }
  const finish = () => {
    g.finger = null
    if (pathLength(g.trace) < 0.15) {
      // A tap or a twitch, not a drawing.
      g.hint = g.say = 'Too short. Trace the whole shape in one stroke.'
      Object.assign(g, { phase: 'ready', trace: [], covered: new Uint8Array(0) })
      draw()
      render()
      return
    }
    const r = scoreTrace(g.trace, out)
    g.result = r
    g.phase = 'done'
    g.newBest = r.score > (g.best ?? 0)
    if (g.newBest) {
      g.best = r.score
      saveBest(bestKey(shape), r.score)
    }
    g.say = `Score ${r.score}. On the line ${Math.round(r.accuracy * 100)} percent, shape covered ${Math.round(r.coverage * 100)} percent.${g.newBest ? ' A new best.' : ''}`
    render()
  }

  // The real trackpad: only while this game waits for or follows a stroke.
  usePoll(!demo && !tooOld && !missing && g.phase !== 'done', () => {
    const fresh = performance.now() - live.at < STALE_MS
    const fingers = fresh ? (live.fingers ?? []) : []
    // Nothing new: the same message as last tick, or still lifted.
    const seen = fresh ? live.at : 0
    if (seen === g.seen) return
    g.seen = seen
    const many = fingers.length > 1
    if (g.phase === 'ready') {
      if (fingers.length === 1) begin(fromPad(fingers[0].x, fingers[0].y))
      g.id = fingers.length === 1 ? fingers[0].id : -1
      g.finger = fingers.length ? fromPad(fingers[0].x, fingers[0].y) : null
    } else {
      // Follow the finger that started the stroke; extra touches are ignored. When it lifts, the stroke ends.
      const mine = fingers.find((p) => p.id === g.id)
      if (!mine) {
        finish()
        return
      }
      add(fromPad(mine.x, mine.y))
    }
    if (many !== g.many) {
      g.many = many
      if (many) g.say = 'Use one finger.'
    }
    draw()
    render()
  })

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(c)
    const theme = matchMedia('(prefers-color-scheme: dark)')
    theme.addEventListener('change', draw)
    return () => {
      ro.disconnect()
      theme.removeEventListener('change', draw)
    }
    // draw reads the stroke from the ref; it only needs replacing when the shape changes or the canvas mounts.
  }, [out, tooOld, missing]) // eslint-disable-line react-hooks/exhaustive-deps

  if (tooOld) return <Unavailable title="Trackpad not available">{OLD_READER}</Unavailable>
  if (missing)
    return (
      <Unavailable title="Trackpad not available">
        The reader could not open the built-in trackpad. It needs a Mac with a Force Touch trackpad and the private MultitouchSupport framework, which a macOS update may have changed.
      </Unavailable>
    )

  // Demo: the on-screen pad takes a mouse, pen or touch drag in place of the real trackpad.
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return fromPad((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
  }
  const pointer = demo
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
          if (g.phase !== 'ready') return
          e.currentTarget.setPointerCapture(e.pointerId)
          begin(local(e))
          draw()
          render()
        },
        onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
          if (g.phase !== 'drawing') return
          add(local(e))
          draw()
          render()
        },
        onPointerUp: () => g.phase === 'drawing' && finish(),
        onPointerCancel: () => g.phase === 'drawing' && finish(),
      }
    : {}

  const r = g.result
  const covered = g.covered.reduce((a, b) => a + b, 0) / Math.max(1, out.length)
  return (
    <section className={`card pad-game phase-${g.phase}`} aria-labelledby="pad-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="pad-title">Trackpad Drawing</h3>
        {demo && <span className="sim-badge">Simulated: drag on the pad</span>}
        <span className="game-score">
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>
      <div className="shape-pick" role="group" aria-label="Shape to trace">
        {SHAPES.map((x) => (
          <button key={x.key} type="button" aria-pressed={shape === x.key} onClick={() => {
              reset(x.key)
              setShape(x.key)
            }}>
            <ShapeIcon k={x.key} />
            {x.name}
          </button>
        ))}
      </div>

      <div className="pad-stage">
        <canvas ref={canvas} className={`pad-canvas ${demo ? 'sim' : ''}`} style={{ aspectRatio: PAD_ASPECT }} role="img" aria-label={`Trackpad with a ${name} to trace${g.phase === 'drawing' ? ', drawing' : ''}.`} {...pointer} />
        {g.many && <span className="pad-warn">Use one finger</span>}
        {r && g.phase === 'done' && (
          <div className="pad-result">
            <span className="pad-result-score num">{r.score}</span>
            <span className="pad-result-label">{g.newBest ? 'new best' : 'score'}</span>
          </div>
        )}
      </div>

      <p className="game-goal">
        {g.phase === 'ready' && (demo ? `Drag on the pad to trace the ${name} in one stroke. Let go to finish.` : `Put one finger on the trackpad and trace the ${name} in one stroke. Lift to finish.`)}
        {g.phase === 'drawing' && (
          <>
            Tracing… <span className="num">{Math.round(covered * 100)}%</span> of the shape covered
          </>
        )}
        {g.phase === 'ready' && g.hint && <span className="game-hint"> {g.hint}</span>}
      </p>
      {!demo && g.phase === 'ready' && live.at === 0 && <p className="fine">Nothing has come from the trackpad yet. Touch it to start; if your finger never shows up here, this reader can't read the trackpad.</p>}

      {r && g.phase === 'done' && (
        <div className="pad-breakdown">
          <Meter label={simple ? 'Stayed on the line' : 'Accuracy'} v={r.accuracy} sub={`average miss ${(r.meanDist * 100).toFixed(1)}% of the pad's depth`} />
          <Meter label={simple ? 'How much you traced' : 'Coverage'} v={r.coverage} sub="share of the outline passed within reach" />
          <p className="fine">
            Score = accuracy × coverage = <span className="num">{Math.round(r.accuracy * 100)}%</span> × <span className="num">{Math.round(r.coverage * 100)}%</span>, so a neat dab on one corner and a scribble over the whole pad both score low.
          </p>
        </div>
      )}
      <div className="game-actions">
        {g.phase === 'done' && (
          <button
            type="button"
            className="game-go"
            onClick={() => {
              reset(shape)
              draw()
              render()
            }}
          >
            Try again
          </button>
        )}
      </div>

      {g.phase === 'done' && (
        <p className="game-learn">
          {simple
            ? 'Under the glass is a grid that feels the tiny electric charge of your finger. That is how the trackpad knew where you drew.'
            : 'Measured: your finger position from the trackpad\'s capacitance grid. A finger changes the charge between the electrodes under the glass, and the MultitouchSupport framework turns that into x and y from 0 to 1, sent here up to 30 times a second.'}
          <InfoButton topic="trackpad" />
        </p>
      )}
      <p className="fine game-how">
        Finger positions stay in this page's memory and are never stored or sent. Only best scores are saved, on this device.
        {g.phase !== 'done' && <InfoButton topic="trackpad" />}
      </p>
    </section>
  )
}

function Meter({ label, v, sub }: { label: string; v: number; sub: string }) {
  return (
    <div className="pad-meter">
      <span className="pad-meter-label">
        {label} <span className="num strong">{Math.round(v * 100)}%</span>
      </span>
      <span className="pad-meter-bar" aria-hidden>
        <span style={{ width: `${v * 100}%` }} />
      </span>
      <span className="fine">{sub}</span>
    </div>
  )
}

/** A small preview of each shape for its button, from the same outline the game scores against. */
function ShapeIcon({ k }: { k: ShapeKey }) {
  const d = useMemo(() => outline(k, 80).map((p, i) => `${i ? 'L' : 'M'} ${(p.x - PAD_ASPECT / 2 + 0.5).toFixed(3)} ${p.y.toFixed(3)}`).join(' '), [k])
  return (
    <svg viewBox="0.05 0.05 0.9 0.9" width="18" height="18" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="0.08" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
