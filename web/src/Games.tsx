import { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { LabProps } from './labs/kit.tsx'
import { OLD_READER, Unavailable, readBest, saveBest, usePoll } from './games/kit.tsx'
import type { Sample } from './types.ts'
import type { Live } from './useStream.ts'
import { InfoButton } from './Learn.tsx'
import { useSimple } from './simple.ts'
import {
  LID_HOLD,
  LID_TOL,
  PAD_ASPECT,
  SHAPES,
  cover,
  fromPad,
  nextHold,
  outline,
  pathLength,
  pickTarget,
  roundPoints,
  scoreTrace,
  type Pt,
  type Score,
  type ShapeKey,
} from './games.ts'

// Sensor mini-games: hit a lid angle with the real hinge, trace a shape on the real trackpad.

type GameProps = { s: Sample; live: Live; demo: boolean }

type GameId = 'lid' | 'pad' | 'mole' | 'fill-ram' | 'watts' | 'heat' | 'wifi'
const NEW_GAMES: Record<Exclude<GameId, 'lid' | 'pad'>, React.LazyExoticComponent<React.ComponentType<LabProps>>> = {
  mole: lazy(() => import('./games/Mole.tsx')),
  'fill-ram': lazy(() => import('./games/FillRam.tsx')),
  watts: lazy(() => import('./games/Watts.tsx')),
  heat: lazy(() => import('./games/Heat.tsx')),
  wifi: lazy(() => import('./games/WifiHunt.tsx')),
}
/** Name, then the sensor it uses in technical and in everyday words. */
const GAMES: [GameId, string, string, string][] = [
  ['lid', 'Lid Challenge', 'hinge angle sensor', 'move the screen'],
  ['pad', 'Trackpad Drawing', 'multitouch grid', 'draw with a finger'],
  ['mole', 'Whack-a-Mole', 'trackpad taps', 'tap the trackpad'],
  ['fill-ram', 'Fill the RAM', 'memory pressure', 'fill up the desk'],
  ['watts', 'Guess the Watts', 'power sensors', 'guess the power'],
  ['heat', 'Heat Race', 'temperature sensors', 'warm it up'],
  ['wifi', 'Wi-Fi Hot and Cold', 'radio signal strength', 'find the best signal'],
]
const GAME_KEY = 'macviz.game'

export function Games(p: LabProps) {
  const { s, live, demo } = p
  const [game, setGameState] = useState<GameId>(() => {
    try {
      const g = localStorage.getItem(GAME_KEY)
      return GAMES.some(([id]) => id === g) ? (g as GameId) : 'lid'
    } catch {
      return 'lid'
    }
  })
  const setGame = (g: GameId) => {
    setGameState(g)
    try {
      localStorage.setItem(GAME_KEY, g)
    } catch {
      // Not saved; the choice still holds for this visit.
    }
  }
  const simple = useSimple()
  const Picked = game === 'lid' || game === 'pad' ? null : NEW_GAMES[game]
  return (
    <div className="games">
      <p className="lede">
        {simple ? 'Quick games you play with the real parts of this Mac. If you can win, the sensors work.' : 'Quick games driven by real sensors and counters in this Mac. Winning one is proof the sensor and the reader both work.'}
      </p>
      <div className="game-pick" role="group" aria-label="Choose a game">
        {GAMES.map(([id, name, tech, plain]) => (
          <button key={id} type="button" aria-pressed={game === id} onClick={() => setGame(id)}>
            <span className="game-pick-name">{name}</span>
            <span className="game-pick-sub">{simple ? plain : tech}</span>
          </button>
        ))}
      </div>
      {/* Only the chosen game is mounted, so only it can run. */}
      {game === 'lid' && <LidGame s={s} live={live} demo={demo} />}
      {game === 'pad' && <PadGame s={s} live={live} demo={demo} />}
      {Picked && (
        <Suspense fallback={<p className="fine">Loading the game…</p>}>
          <Picked {...p} />
        </Suspense>
      )}
    </div>
  )
}

// Lid Challenge

const ROUNDS = 5
/** Seconds per round. */
const LIMIT = 20
/** How long a hit or a miss shows before the next round. */
const PAUSE_MS = 1400
const BEST_LID = 'macviz.best.lid'

type LidPhase = 'idle' | 'aim' | 'hit' | 'miss' | 'done'

function LidGame({ s, live, demo }: GameProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  // Game state lives in a ref: the poll mutates it and asks for a render, so a tick never sees a stale round.
  const g = useRef({
    phase: 'idle' as LidPhase,
    round: 0,
    target: 0,
    score: 0,
    held: 0,
    deadline: 0,
    /** Seconds left when the round ended, so the timer holds still through the pause. */
    left: LIMIT,
    gain: 0,
    results: [] as boolean[],
    sim: 100,
    best: readBest(BEST_LID),
    newBest: false,
    say: '',
  }).current
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const slider = useRef<HTMLInputElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const read = () => (demo ? g.sim : live.lid)
  const active = g.phase === 'aim' || g.phase === 'hit' || g.phase === 'miss'

  const newRound = () => {
    g.target = pickTarget(read())
    g.held = 0
    g.left = LIMIT
    g.deadline = performance.now() + LIMIT * 1000
    g.phase = 'aim'
    g.say = `Round ${g.round} of ${ROUNDS}. Move the lid to ${g.target} degrees and hold it there.`
    render()
  }
  const next = () => {
    if (g.round < ROUNDS) {
      g.round++
      newRound()
      return
    }
    g.phase = 'done'
    g.newBest = g.score > (g.best ?? 0)
    if (g.newBest) {
      g.best = g.score
      saveBest(BEST_LID, g.score)
    }
    g.say = `Game over. ${g.score} points.${g.newBest ? ' A new best.' : ''}`
    render()
  }
  const start = () => {
    clearTimeout(timer.current)
    Object.assign(g, { round: 1, score: 0, results: [], newBest: false })
    newRound()
    if (demo) slider.current?.focus()
  }

  usePoll(active, (dt) => {
    if (g.phase === 'aim') {
      g.held = nextHold(g.held, read(), g.target, dt)
      const left = (g.deadline - performance.now()) / 1000
      g.left = Math.max(0, left)
      if (g.held >= LID_HOLD) {
        g.gain = roundPoints(left, LIMIT)
        g.score += g.gain
        g.results.push(true)
        g.phase = 'hit'
        g.say = `Locked at ${g.target} degrees. Plus ${g.gain}.`
        timer.current = setTimeout(next, PAUSE_MS)
      } else if (left <= 0) {
        g.results.push(false)
        g.phase = 'miss'
        g.say = "Time's up."
        timer.current = setTimeout(next, PAUSE_MS)
      }
    }
    render()
  })

  if (!demo && s.sensors == null) return <Unavailable title="Lid angle not available">{OLD_READER}</Unavailable>
  if (!demo && live.lid == null)
    return (
      <Unavailable title="Lid angle not available">
        This Mac reports no hinge angle. Desktops have no lid, and MacBooks from before about 2019 only sense open or closed, with a magnet. If this is a recent MacBook, the lid may be closed on an external display.
      </Unavailable>
    )

  const angle = read()
  const left = g.phase === 'aim' ? Math.max(0, (g.deadline - performance.now()) / 1000) : g.left
  const inside = active && angle != null && Math.abs(angle - g.target) <= LID_TOL
  const delta = angle == null ? null : g.target - angle

  return (
    <section className={`card lid-game phase-${g.phase} ${inside ? 'inside' : ''}`} aria-labelledby="lid-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="lid-title">Lid Challenge</h3>
        {demo && <span className="sim-badge">Simulated</span>}
        <span className="game-score">
          <span className="num">{g.score}</span> pts
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>
      <div className="lid-pips" aria-label={`Round ${Math.max(1, g.round)} of ${ROUNDS}`}>
        {Array.from({ length: ROUNDS }, (_, i) => (
          <span key={i} className={`pip ${g.results[i] === true ? 'won' : g.results[i] === false ? 'lost' : i === g.round - 1 && active ? 'now' : ''}`} />
        ))}
      </div>

      <div className="lid-stage">
        <LidGauge angle={angle} target={active ? g.target : null} held={g.held} />
        <div className="lid-readout" aria-hidden>
          <span className="lid-now num">{angle == null ? 'n/a' : `${Math.round(angle)}°`}</span>
          {active && (
            <span className="lid-delta">
              {g.phase === 'hit' ? 'Locked!' : g.phase === 'miss' ? "Time's up" : inside ? 'Hold it…' : delta == null ? '' : `${Math.abs(Math.round(delta))}° ${delta > 0 ? (simple ? 'more open' : 'open further') : simple ? 'more closed' : 'close a little'}`}
            </span>
          )}
        </div>
        {g.phase === 'hit' && (
          <div className="lid-burst" key={g.round} aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ '--a': `${i * 30}deg` } as React.CSSProperties} />
            ))}
            <b className="num">+{g.gain}</b>
          </div>
        )}
      </div>

      {active && (
        <div className={`lid-timer ${left < 5 ? 'low' : ''}`} aria-hidden>
          <span style={{ width: `${(left / LIMIT) * 100}%` }} />
        </div>
      )}
      <p className="game-goal">
        {g.phase === 'idle' && `${ROUNDS} rounds. Each gives a target angle: get within ±${LID_TOL}° and hold for ${LID_HOLD} s. Faster is worth more.`}
        {g.phase === 'idle' && !demo && angle != null && angle < 5 && <span className="game-hint"> The lid reads closed; open it to play.</span>}
        {active && (
          <>
            Target <span className="num strong">{g.target}°</span> · round {g.round} of {ROUNDS} · <span className="num">{Math.ceil(left)}</span> s
          </>
        )}
        {g.phase === 'done' && (
          <>
            {g.newBest ? 'New best: ' : 'Final score: '}
            <span className="num strong">{g.score}</span> of {ROUNDS * 100}, {g.results.filter(Boolean).length} of {ROUNDS} targets hit.
          </>
        )}
      </p>

      {demo && (
        <label className="sim-control">
          <span>Simulated hinge</span>
          <input
            ref={slider}
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
          <span className="fine">Arrow keys nudge it one degree; Page Up and Page Down jump further.</span>
        </label>
      )}

      <div className="game-actions">
        {!active && (
          <button type="button" className="game-go" onClick={start}>
            {g.phase === 'done' ? 'Play again' : 'Start'}
          </button>
        )}
      </div>

      {g.phase === 'done' ? (
        <p className="game-learn">
          {simple
            ? 'A tiny sensor inside the hinge tells the Mac how far the screen is open, in degrees. You just played a game with it.'
            : 'Measured: the hinge angle, from a sensor in the hinge that macOS exposes as a HID device and reports in whole degrees. The reader forwards each change of half a degree or more, up to 30 times a second.'}
          <InfoButton topic="lid-angle" />
        </p>
      ) : (
        <p className="fine game-how">
          {simple ? 'A small sensor in the hinge measures how far the screen is open.' : 'A sensor in the hinge reports its angle in degrees; the reader sends each change up to 30 times a second.'}
          <InfoButton topic="lid-angle" />
        </p>
      )}
    </section>
  )
}

/** A side view of the laptop on a protractor: the lid at the live angle, the target as a lit wedge with a ghost lid. */
function LidGauge({ angle, target, held }: { angle: number | null; target: number | null; held: number }) {
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
  const ring = 2 * Math.PI * 13
  const label = angle == null ? 'Lid angle not available.' : `Lid open ${Math.round(angle)} degrees${target == null ? '' : `, target ${target} degrees`}.`
  return (
    <svg className="lid-gauge" viewBox="0 0 300 186" role="img" aria-label={label}>
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
      {target != null && ghost && (
        <>
          <path d={`M ${P.x} ${P.y} L ${at(target - LID_TOL, 132).x} ${at(target - LID_TOL, 132).y} A 132 132 0 0 0 ${at(target + LID_TOL, 132).x} ${at(target + LID_TOL, 132).y} Z`} className="lid-window" />
          <line x1={P.x} y1={P.y} x2={ghost.x} y2={ghost.y} className="lid-ghost" />
        </>
      )}
      {/* The base, then the lid from the hinge. */}
      <rect x={P.x - 4} y={P.y} width={168} height={9} rx={4} className="lid-base" />
      {lid && (
        <>
          <line x1={P.x} y1={P.y} x2={lid.x} y2={lid.y} className="lid-lid" />
          {target != null && (
            <circle
              cx={lid.x}
              cy={lid.y}
              r={13}
              className="lid-hold"
              strokeDasharray={ring}
              strokeDashoffset={ring * (1 - Math.min(1, held / LID_HOLD))}
              transform={`rotate(-90 ${lid.x} ${lid.y})`}
            />
          )}
        </>
      )}
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
