import { useEffect, useReducer, useRef } from 'react'
import { Sources, type LabProps, type Source } from '../labs/kit.tsx'
import { OLD_READER, Unavailable, readBest, saveBest, usePoll } from './kit.tsx'
import { InfoButton } from '../Learn.tsx'
import { useSimple } from '../simple.ts'
import { PAD_ASPECT, fromPad, type Pt } from '../games.ts'
import { COLS, GRID_X, GRID_Y, HOLES, ROUND_S, WHIFF, centroid, electrode, hitPoints, holeAt, mean, pace, pickHole, proximity, strongest, touchDowns } from './mole.ts'
import './play.css'
import './Mole.css'

// Whack-a-Mole on the real trackpad: moles pop up on a board shaped like the pad, and a tap on the matching
// spot of the glass whacks them. The fast channel's finger list is polled the way Trackpad Drawing does.

const BEST = 'macviz.best.mole'
/** A finger with no fast message for this long counts as lifted: a backlogged socket can drop the lift message. */
const STALE_MS = 300
const BONK_MS = 450
const SWING_MS = 380

type Mole = { hole: number; at: number; upMs: number; bonkAt: number | null; gain: number }
type Phase = 'idle' | 'play' | 'done'

const SOURCES: Source[] = [
  {
    title: 'Westerman and Elias, US patent 6,323,846: Method and apparatus for integrating manual input',
    url: 'https://patents.google.com/patent/US6323846B1/en',
    note: 'The FingerWorks multi-touch patent, now assigned to Apple. Electrodes measure proximity, each contact is placed at its proximity-weighted centroid (equations 12 to 14), and a contact with no existing path starts a new one.',
  },
  { title: 'iFixit: Force Touch trackpad teardown', url: 'https://www.ifixit.com/News/7084/force-touch-track-pad', note: 'The glass plate, the force sensors and the Taptic Engine under it.' },
  { title: 'Wikipedia: Mental chronometry', url: 'https://en.wikipedia.org/wiki/Mental_chronometry', note: 'Simple reaction time to a visual signal averages about 190 ms for college-age people.' },
]

export default function Mole({ s, live, demo }: LabProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const g = useRef({
    phase: 'idle' as Phase,
    t0: 0,
    nextAt: 0,
    last: -1,
    moles: [] as Mole[],
    score: 0,
    hits: 0,
    escaped: 0,
    whiffs: 0,
    reactions: [] as number[],
    /** Bumped per swing, so each whack remounts the hammer and replays its animation. */
    swing: 0,
    swingHole: -1,
    swingAt: 0,
    seen: new Set<number>(),
    seenAt: 0,
    finger: null as Pt | null,
    lastTap: null as Pt | null,
    best: readBest(BEST),
    newBest: false,
    say: '',
  }).current
  const board = useRef<HTMLDivElement>(null)

  const tooOld = !demo && s.sensors == null
  const missing = !demo && live.at > 0 && live.fingers === null
  const playing = g.phase === 'play'

  const start = () => {
    const now = performance.now()
    Object.assign(g, { phase: 'play', t0: now, nextAt: now + 700, last: -1, moles: [], score: 0, hits: 0, escaped: 0, whiffs: 0, reactions: [], swingHole: -1, newBest: false, lastTap: null })
    g.say = `Go. ${ROUND_S} seconds.`
    render()
    if (demo) requestAnimationFrame(() => board.current?.querySelector('button')?.focus())
  }

  const end = () => {
    g.phase = 'done'
    g.moles = []
    g.finger = null
    g.newBest = g.score > (g.best ?? 0)
    if (g.newBest) {
      g.best = g.score
      saveBest(BEST, g.score)
    }
    const avg = mean(g.reactions)
    g.say = `Time. ${g.score} points, ${g.hits} hits.${avg == null ? '' : ` Average reaction ${Math.round(avg)} milliseconds.`}${g.newBest ? ' A new best.' : ''}`
    render()
  }

  const whack = (hole: number, at: Pt | null) => {
    if (g.phase !== 'play') return
    const now = performance.now()
    g.swing++
    g.swingHole = hole
    g.swingAt = now
    if (at) g.lastTap = at
    const m = g.moles.find((x) => x.hole === hole && x.bonkAt == null)
    if (m) {
      const reaction = now - m.at
      m.gain = hitPoints(reaction, m.upMs)
      m.bonkAt = now
      g.score += m.gain
      g.hits++
      g.reactions.push(reaction)
      g.say = `Bonk. Plus ${m.gain}.`
    } else {
      g.whiffs++
      g.score = Math.max(0, g.score - WHIFF)
      g.say = 'Missed.'
    }
    render()
  }

  // Runs while a round is live, and while waiting to start so the finger dot shows the trackpad works.
  usePoll(playing || (!demo && !tooOld && !missing && g.phase === 'idle'), () => {
    const now = performance.now()
    if (!demo) {
      const fresh = now - live.at < STALE_MS
      const fingers = fresh ? (live.fingers ?? []) : []
      const at = fresh ? live.at : 0
      if (at !== g.seenAt) {
        g.seenAt = at
        // A finger that touched down since the last frame is a whack where it landed.
        for (const f of touchDowns(g.seen, fingers)) {
          const p = fromPad(f.x, f.y)
          whack(holeAt(p), p)
        }
        g.seen = new Set(fingers.map((f) => f.id))
        g.finger = fingers.length ? fromPad(fingers[0].x, fingers[0].y) : null
      }
    }
    if (g.phase !== 'play') return render()

    const el = (now - g.t0) / 1000
    if (el >= ROUND_S) return end()
    // Moles that were not whacked in time go back down; bonked ones leave after their squash.
    g.moles = g.moles.filter((m) => {
      if (m.bonkAt != null) return now - m.bonkAt < BONK_MS
      if (now - m.at < m.upMs) return true
      g.escaped++
      return false
    })
    const p = pace(el)
    if (now >= g.nextAt && g.moles.filter((m) => m.bonkAt == null).length < p.maxUp) {
      const hole = pickHole(g.moles.map((m) => m.hole), g.last)
      if (hole != null) {
        g.moles.push({ hole, at: now, upMs: p.upMs, bonkAt: null, gain: 0 })
        g.last = hole
      }
      g.nextAt = now + p.gapMs * (0.7 + Math.random() * 0.6)
    }
    render()
  })

  useEffect(() => {
    if (!demo || !playing) return
    // Number keys in keypad layout: 7 8 9 is the top row, nearest the hinge.
    const key = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!(n >= 1 && n <= 9)) return
      e.preventDefault()
      whack((2 - Math.floor((n - 1) / 3)) * COLS + ((n - 1) % 3), null)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [demo, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  if (tooOld) return <Unavailable title="Trackpad not available">{OLD_READER}</Unavailable>
  if (missing)
    return (
      <Unavailable title="Trackpad not available">
        The reader could not open a built-in trackpad. Whack-a-Mole needs a MacBook with a Force Touch trackpad; desktop Macs and external trackpads are not read. It also relies on the private MultitouchSupport framework, which a macOS update may have changed.
      </Unavailable>
    )

  const now = performance.now()
  const left = playing ? Math.max(0, ROUND_S - (now - g.t0) / 1000) : g.phase === 'done' ? 0 : ROUND_S
  const avg = mean(g.reactions)
  const fastest = g.reactions.length ? Math.min(...g.reactions) : null
  const swinging = playing && now - g.swingAt < SWING_MS

  return (
    <section className={`card mole-game phase-${g.phase}`} aria-labelledby="mole-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="mole-title">Whack-a-Mole</h3>
        {demo && <span className="sim-badge">Simulated: click the holes</span>}
        <span className="game-score">
          <span className="num">{g.score}</span> pts
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>

      <div className="mole-tally">
        <span>
          <b className="num">{g.hits}</b> {simple ? 'bonked' : 'hits'}
        </span>
        <span>
          <b className="num">{g.escaped}</b> {simple ? 'got away' : 'escaped'}
        </span>
        <span>
          <b className="num">{g.whiffs}</b> {simple ? 'empty taps' : 'whiffs'}
        </span>
        <span className="mole-clock">
          <b className="num">{Math.ceil(left)}</b> s left
        </span>
      </div>
      <div className={`lid-timer ${left < 8 ? 'low' : ''}`} aria-hidden>
        <span style={{ width: `${(left / ROUND_S) * 100}%` }} />
      </div>

      <div className="mole-wrap">
        <span className="mole-edge" aria-hidden>
          {simple ? 'screen side of the trackpad' : 'hinge edge of the trackpad'}
        </span>
        <div
          ref={board}
          className={`mole-board ${demo ? 'sim' : ''}`}
          style={{ aspectRatio: PAD_ASPECT }}
          role="group"
          aria-label={demo ? 'Nine holes. Click a hole, or press 1 to 9 in keypad order, when a mole is up.' : 'Nine holes laid out like the trackpad, the hinge edge at the top.'}
        >
          <svg width="0" height="0" className="mole-defs" aria-hidden>
            <clipPath id="mole-clip">
              <path d="M0 -40 H100 V62 H86 A36 11 0 0 1 14 62 H0 Z" />
            </clipPath>
          </svg>
          {Array.from({ length: HOLES }, (_, i) => {
            const m = g.moles.find((x) => x.hole === i)
            const state = m ? (m.bonkAt != null ? 'bonk' : 'up') : 'down'
            const body = (
              <>
                <MoleSvg state={state} />
                {swinging && g.swingHole === i && <Hammer key={g.swing} />}
                {m && state === 'bonk' && (
                  <b className="mole-gain num" key={`g${m.at}`}>
                    +{m.gain}
                  </b>
                )}
              </>
            )
            const label = `Hole ${i + 1}${state === 'up' ? ', mole up' : ''}`
            return demo ? (
              <button
                key={i}
                type="button"
                className={`mole-hole ${state}`}
                aria-label={label}
                aria-disabled={!playing}
                onPointerDown={(e) => {
                  e.preventDefault()
                  whack(i, null)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  whack(i, null)
                }}
              >
                {body}
              </button>
            ) : (
              <div key={i} className={`mole-hole ${state}`} role="img" aria-label={label}>
                {body}
              </div>
            )
          })}
          {g.finger && <span className="mole-finger" style={{ left: `${(g.finger.x / PAD_ASPECT) * 100}%`, top: `${g.finger.y * 100}%` }} aria-hidden />}
          {g.phase === 'done' && (
            <div className="pad-result mole-result">
              <span className="pad-result-score num">{g.score}</span>
              <span className="pad-result-label">{g.newBest ? 'new best' : 'points'}</span>
            </div>
          )}
        </div>
      </div>

      <p className="game-goal">
        {g.phase === 'idle' &&
          (demo
            ? `${ROUND_S} seconds. Click a mole the moment it pops up. Faster whacks score more; an empty hole costs ${WHIFF}.`
            : `${ROUND_S} seconds. The board is your trackpad: tap the spot on the glass where a mole pops up. Faster whacks score more; an empty tap costs ${WHIFF}.`)}
        {playing && (simple ? 'Bonk them before they hide. It speeds up as the clock runs down.' : 'Whack. Moles stay up for less time, and more come at once, as the clock runs down.')}
        {g.phase === 'done' && (
          <>
            {g.hits} {g.hits === 1 ? 'hit' : 'hits'}, {g.escaped} escaped, {g.whiffs} {g.whiffs === 1 ? 'whiff' : 'whiffs'}.{' '}
            {avg != null && (
              <>
                {simple ? 'You reacted in ' : 'Average reaction '}
                <span className="num strong">{Math.round(avg)} ms</span>
                {fastest != null && <>, fastest {Math.round(fastest)} ms</>}.
              </>
            )}
          </>
        )}
      </p>
      {!demo && g.phase === 'idle' && (
        <p className="fine mole-tip">
          {live.at === 0 ? 'Nothing has come from the trackpad yet. Touch it once to check: a dot appears on the board. ' : ''}
          A tap also clicks whatever is under the pointer, so rest the pointer on the board before you start.
        </p>
      )}

      <div className="game-actions">
        {!playing && (
          <button type="button" className="game-go" onClick={start}>
            {g.phase === 'done' ? 'Play again' : 'Start'}
          </button>
        )}
      </div>

      {g.phase === 'done' ? (
        <>
          <Lesson tap={g.lastTap} avg={avg} demo={demo} />
          <Sources list={SOURCES} />
        </>
      ) : (
        <p className="fine game-how">
          {simple ? 'Under the glass, a grid of wires feels where your finger lands.' : 'An electrode grid under the glass senses each finger, and every new contact counts as one whack.'} Finger positions stay in this page's memory and are never stored.
          <InfoButton topic="trackpad" />
        </p>
      )}
    </section>
  )
}

/** A mole in its hole: below the rim when down, up and peering when up, squashed with crossed eyes when bonked. */
function MoleSvg({ state }: { state: 'up' | 'down' | 'bonk' }) {
  return (
    <svg className="mole-svg" viewBox="0 -6 100 84" aria-hidden>
      <ellipse cx="50" cy="62" rx="36" ry="11" className="mole-pit" />
      <g clipPath="url(#mole-clip)">
        <g className={`mole-body ${state}`}>
          <path d="M24 90 V40 C24 14 37 2 50 2 C63 2 76 14 76 40 V90 Z" className="mole-fur" />
          <ellipse cx="50" cy="52" rx="16" ry="17" className="mole-belly" />
          {state === 'bonk' ? (
            <path d="M36 20 l8 8 M44 20 l-8 8 M56 20 l8 8 M64 20 l-8 8" className="mole-x" />
          ) : (
            <g className="mole-eyes">
              <circle cx="40" cy="24" r="4" />
              <circle cx="60" cy="24" r="4" />
              <circle cx="41.3" cy="22.7" r="1.3" className="mole-glint" />
              <circle cx="61.3" cy="22.7" r="1.3" className="mole-glint" />
            </g>
          )}
          <ellipse cx="50" cy="35" rx="7" ry="5" className="mole-nose" />
          <path d="M44 42 q6 5 12 0" className="mole-mouth" />
          <path d="M30 34 h-10 M30 38 h-9 M70 34 h10 M70 38 h9" className="mole-whisker" />
        </g>
      </g>
      <path d="M14 62 A36 11 0 0 0 86 62" className="mole-rim" />
      {state === 'bonk' && (
        <g className="mole-stars">
          {[0, 120, 240].map((a) => (
            <path key={a} d="M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z" style={{ '--a': `${a}deg` } as React.CSSProperties} />
          ))}
        </g>
      )}
    </svg>
  )
}

function Hammer() {
  return (
    <svg className="mole-hammer" viewBox="0 0 60 70" aria-hidden>
      <rect x="40" y="18" width="7" height="50" rx="3.5" className="mole-handle" />
      <rect x="22" y="2" width="38" height="22" rx="5" className="mole-head" />
      <rect x="22" y="2" width="7" height="22" rx="2" className="mole-face" />
    </svg>
  )
}

/** After the round: the player's last tap as an electrode grid would see it, and where the weighted centroid lands. */
function Lesson({ tap, avg, demo }: { tap: Pt | null; avg: number | null; demo: boolean }) {
  const simple = useSimple()
  const p = tap ?? { x: PAD_ASPECT * 0.57, y: 0.41 }
  const prox = proximity(p)
  const c = centroid(prox)
  const m = strongest(prox)
  const W = 480
  const k = W / PAD_ASPECT // pixels per pad unit; the pad is one unit deep
  const cw = W / GRID_X
  const ch = k / GRID_Y
  const err = (q: Pt | null) => (q ? (Math.hypot(q.x - p.x, q.y - p.y) / PAD_ASPECT) * 100 : 0)
  return (
    <div className="game-lesson">
      <h4>{simple ? 'How the trackpad knew where you tapped' : 'How the trackpad found your finger'}</h4>
      <div className="mole-lesson-row">
        <svg
          className="mole-grid"
          viewBox={`-4 -4 ${W + 8} ${k + 8}`}
          role="img"
          aria-label={`A grid of ${GRID_X} by ${GRID_Y} electrodes, each shaded by how strongly it senses the fingertip. The weighted centroid lands on the finger; the strongest single electrode is a fraction of a cell away.`}
        >
          {prox.map((v, i) => {
            const e = electrode(i % GRID_X, Math.floor(i / GRID_X))
            return <rect key={i} x={e.x * k - cw / 2 + 1.5} y={e.y * k - ch / 2 + 1.5} width={cw - 3} height={ch - 3} rx={4} className="mole-cell" style={{ '--v': v.toFixed(3) } as React.CSSProperties} />
          })}
          <rect x={m.x * k - cw / 2 + 1.5} y={m.y * k - ch / 2 + 1.5} width={cw - 3} height={ch - 3} rx={4} className="mole-strong" />
          {c && (
            <g className="mole-centroid">
              <circle cx={c.x * k} cy={c.y * k} r={9} />
              <line x1={c.x * k - 16} y1={c.y * k} x2={c.x * k + 16} y2={c.y * k} />
              <line x1={c.x * k} y1={c.y * k - 16} x2={c.x * k} y2={c.y * k + 16} />
            </g>
          )}
        </svg>
        <ul className="mole-key">
          <li>
            <span className="mole-swatch cell" aria-hidden />
            <span>{simple ? 'Glow: how strongly each spot feels the finger' : 'Each cell: one electrode crossing, shaded by its change in capacitance'}</span>
          </li>
          <li>
            <span className="mole-swatch strong" aria-hidden />
            <span>
              {simple ? 'The single brightest spot' : 'Strongest electrode alone'}: off by <span className="num">{err(m).toFixed(1)}%</span> of the width
            </span>
          </li>
          <li>
            <span className="mole-swatch cross" aria-hidden />
            <span>
              {simple ? 'The balance point of all the glow' : 'Proximity-weighted centroid'}: off by <span className="num">{err(c).toFixed(2)}%</span>
            </span>
          </li>
        </ul>
      </div>
      {simple ? (
        <>
          <p>Under the glass is a criss-cross grid of thin wires. Your finger holds a little electric charge, so the wires nearest it notice a change. A fingertip is wider than the gap between wires, so several wires feel it at once, the closest ones most.</p>
          <p>The trackpad then finds the balance point of all that glow, like finding the middle of a smudge. That is how it can place your finger far more finely than the wires are spaced. Each new touch also gets its own number, which is how this game told a fresh tap from a finger resting on the glass.</p>
        </>
      ) : (
        <>
          <p>
            A capacitive trackpad has rows and columns of electrodes under the glass. A fingertip conducts, so it changes the capacitance at the crossings near it, and the controller reads every crossing as a proximity value. A fingertip spans several crossings, so it shows up as a blob, strongest in the middle.
          </p>
          <p>
            The position is the blob's proximity-weighted centroid, <span className="num">x = Σ zᵢ·xᵢ / Σ zᵢ</span> and the same for y, where zᵢ is an electrode's reading and xᵢ its position. Westerman and Elias give exactly this in the multi-touch patent behind Apple's trackpads. Weighting places a finger between electrodes, far finer than their pitch. The same patent pairs each blob with the path it continues and starts a new path for a blob with none. That new contact id is how this game told a fresh tap from a resting finger.
          </p>
        </>
      )}
      {avg != null && (
        <p>
          {simple
            ? `You took ${Math.round(avg)} ms on average. People react to a simple flash in about 190 ms. Here you also had to pick the right hole and move your finger, so a bit longer is normal.`
            : `Your average was ${Math.round(avg)} ms. Simple visual reaction time, pressing one button when a light comes on, averages about 190 ms for college-age people. This is a choice with a finger movement, and the reader's 30-a-second frames add up to 33 ms on top of the display's own delay, so expect more.`}
        </p>
      )}
      <p className="fine">
        {tap && !demo ? 'The blob is drawn at your last real tap.' : 'The blob is drawn at a sample spot, since simulated clicks have no trackpad position.'} The {GRID_X} by {GRID_Y} grid and the blob's width are illustrative: Apple does not publish its electrode count. macOS hands the reader only the finished x and y, through the private MultitouchSupport framework.
      </p>
    </div>
  )
}
