import { useEffect, useReducer, useRef, useState } from 'react'
import { Sources, type LabProps, type Source } from '../labs/kit.tsx'
import { HowTo, Unavailable, readBest, saveBest } from './kit.tsx'
import { InfoButton } from '../Learn.tsx'
import { useSimple } from '../simple.ts'
import { mhz, temp } from '../format.ts'
import { COOL_S, FAN_RISE, LOAD_S, fanAt, predictScore, simHeat, throttleAt, type Point } from './heat.ts'
import './play.css'
import './Heat.css'

// Heat Race: the page loads the CPU with busy Web Workers, the player predicts when the Mac reacts (the P clock drops
// on a fanless Air, the fans spin up on a Mac with fans), and the reader's temperature, clock and fan readings decide.

const BEST = 'macviz.best.heat'
type Phase = 'idle' | 'run' | 'cool' | 'done'
/** Slider values above LOAD_S mean "not within the minute". */
const NOT_SOON = LOAD_S + 1

const SOURCES: Source[] = [
  { title: 'Apple documentation: ProcessInfo.ThermalState', url: 'https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum', note: 'The four thermal states, nominal to critical, and what apps should do at each.' },
  {
    title: 'Apple, Energy Efficiency Guide: respond to thermal state changes',
    url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/RespondToThermalStateChanges.html',
    note: 'On Macs with fans, fans may become audible at fair; at serious, performance is reduced.',
  },
  { title: 'iFixit: M2 MacBook Air teardown', url: 'https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink', note: 'A shield, graphite tape and a thermal pad, and no heatsink, heat pipe or fan. The M5 Air uses the same chassis.' },
  { title: 'Course lesson 5: Heat in a fanless Mac', url: '#learn/05', note: 'The measured run on an M5 Air the simulation follows: 58 to 93 °C in 30 s, the P clock walked down from 4464 MHz while the E cores held.' },
]

const makeWorker = () => {
  // A worker that spins until terminated; the page keeps at most one per logical core.
  const url = URL.createObjectURL(new Blob(['for (;;) {}'], { type: 'text/javascript' }))
  const w = new Worker(url)
  URL.revokeObjectURL(url)
  return w
}

export default function Heat({ hw, s, demo }: LabProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const cores = Math.max(1, Math.min(32, navigator.hardwareConcurrency || hw.pCores + hw.eCores))
  const [workers, setWorkers] = useState(cores)
  const [guess, setGuess] = useState(30)
  const [simFans, setSimFans] = useState(false)
  const fans = demo ? simFans : hw.fanCount > 0
  const g = useRef({
    phase: 'idle' as Phase,
    startT: 0,
    stopT: 0,
    pts: [] as Point[],
    pool: [] as Worker[],
    guess: null as number | null,
    actual: null as number | null,
    score: 0,
    best: readBest(BEST),
    newBest: false,
    say: '',
  }).current
  const cap = useRef<ReturnType<typeof setTimeout>>(undefined)

  const setPool = (n: number) => {
    while (g.pool.length > n) g.pool.pop()!.terminate()
    while (!demo && g.pool.length < n) g.pool.push(makeWorker())
  }
  // Leaving the game, or the page, always ends the load.
  useEffect(
    () => () => {
      clearTimeout(cap.current)
      g.pool.forEach((w) => w.terminate())
      g.pool = []
    },
    [g],
  )

  const now = () => (Date.now() - g.startT) / 1000
  const settle = () => {
    const pts = g.pts.filter((p) => p.t <= (g.stopT - g.startT) / 1000)
    g.actual = fans ? fanAt(pts) : throttleAt(pts)
    g.score = predictScore(g.guess, g.actual)
    g.phase = 'done'
    g.newBest = g.score > (g.best ?? 0)
    if (g.newBest) {
      g.best = g.score
      saveBest(BEST, g.score)
    }
    const what = fans ? 'The fans spun up' : 'The clock dropped'
    g.say = `${g.actual == null ? `${fans ? 'The fans did not spin up' : 'The clock did not drop'} within the minute.` : `${what} at ${Math.round(g.actual)} seconds.`} ${g.score} points.`
    render()
  }
  const stop = () => {
    if (g.phase !== 'run') return
    clearTimeout(cap.current)
    setPool(0)
    g.stopT = Date.now()
    g.phase = 'cool'
    g.say = `Load stopped after ${Math.round(now())} seconds. Watching it cool for ${COOL_S} seconds.`
    render()
  }
  const start = () => {
    Object.assign(g, { phase: 'run', startT: Date.now(), stopT: Date.now() + LOAD_S * 1000, pts: [], guess: guess > LOAD_S ? null : guess, actual: null, newBest: false })
    setPool(workers)
    clearTimeout(cap.current)
    cap.current = setTimeout(stop, LOAD_S * 1000)
    g.say = `Load on: ${workers} busy ${workers === 1 ? 'thread' : 'threads'}. It stops by itself after ${LOAD_S} seconds.`
    render()
  }
  const record = (p: Point) => {
    g.pts.push(p)
    if (g.phase === 'run' && p.t >= LOAD_S) stop()
    else if (g.phase === 'cool' && Date.now() - g.stopT >= COOL_S * 1000) return settle()
    render()
  }

  // Live: one point per reader sample.
  useEffect(() => {
    if (demo || (g.phase !== 'run' && g.phase !== 'cool')) return
    record({ t: now(), pMHz: s.cpu.pFreqMHz, tempC: s.thermal.cpuTempC, rpm: s.fans[0]?.rpm ?? null, state: s.thermal.state })
  }, [s.t]) // eslint-disable-line react-hooks/exhaustive-deps
  // Demo: a simulated Mac, one point a second.
  useEffect(() => {
    if (!demo || (g.phase !== 'run' && g.phase !== 'cool')) return
    const id = setInterval(() => {
      const t = now()
      const stopAt = g.phase === 'run' ? LOAD_S : (g.stopT - g.startT) / 1000
      record({ t, ...simHeat(t, fans, stopAt) })
    }, 1000)
    return () => clearInterval(id)
  }, [demo, g.phase, fans]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo && s.cpu.pFreqMHz == null && s.thermal.cpuTempC == null)
    return (
      <Unavailable title="Clock and temperature not available">
        The reader sends neither the P cluster clock nor a CPU temperature on this Mac, so there is nothing to race against. The clock comes from IOReport and the temperature from the SMC.
      </Unavailable>
    )

  const last = g.pts.at(-1)
  const running = g.phase === 'run' || g.phase === 'cool'
  const t = running ? now() : 0
  const event = fans ? (simple ? 'the fans speed up' : 'the fans spin up') : simple ? "the Fast Workers' speed drops" : 'the P clock drops'
  const guessText = guess > LOAD_S ? 'not within the minute' : `${guess} s`
  const shownPts = g.phase === 'idle' ? [] : g.pts

  return (
    <section className={`card heat-game phase-${g.phase}`} aria-labelledby="heat-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="heat-title">Heat Race</h3>
        {demo && <span className="sim-badge">Simulated Mac</span>}
        <span className="game-score">
          <span className="num">{g.phase === 'done' ? g.score : 0}</span> pts
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>

      {g.phase !== 'idle' && (
        <div className="heat-readouts">
          <Readout label={simple ? 'Chip heat' : 'CPU temperature'} value={temp(last?.tempC ?? s.thermal.cpuTempC)} />
          <Readout label={simple ? 'Fast Worker speed' : 'P clock'} value={mhz(last?.pMHz ?? s.cpu.pFreqMHz)} />
          <Readout label={simple ? 'How hard it is cooling' : 'Thermal state'} value={last?.state ?? s.thermal.state} tone={(last?.state ?? s.thermal.state) === 'nominal' ? '' : 'warm'} />
          <Readout label="Fans" value={fans ? (last?.rpm ?? s.fans[0]?.rpm) != null ? `${Math.round((last?.rpm ?? s.fans[0]?.rpm)!)} rpm` : 'n/a' : 'none'} />
          <Readout label={g.phase === 'cool' ? 'Cooling' : 'Load'} value={g.phase === 'run' ? `${Math.floor(t)} / ${LOAD_S} s` : g.phase === 'cool' ? `${Math.max(0, Math.ceil(COOL_S - (Date.now() - g.stopT) / 1000))} s left` : 'off'} tone={g.phase === 'run' ? 'hot' : ''} />
        </div>
      )}

      {g.phase === 'idle' && (
        <HowTo
          steps={[
            `Use the slider under the chart to guess: how many seconds until ${fans ? 'the fans speed up' : 'the chip slows down to stay cool'}?`,
            `Press Start. This page keeps the chip's cores busy for up to ${LOAD_S} seconds, which warms the Mac. You can stop it any time.`,
            fans ? 'Watch the line on the chart. The game spots the moment the fans speed up.' : 'Watch the line on the chart. The game spots the moment the chip slows its fast cores to stay cool. That is called throttling.',
            'The closer your guess, the more points.',
          ]}
        />
      )}

      <HeatChart pts={shownPts} fans={fans} guess={g.phase === 'idle' ? (guess > LOAD_S ? null : guess) : g.guess} actual={g.phase === 'done' ? g.actual : null} stopAt={g.phase === 'idle' ? null : g.phase === 'run' ? Math.min(LOAD_S, t) : (g.stopT - g.startT) / 1000} />

      {g.phase === 'idle' && (
        <div className="heat-setup">
          <label className="heat-slider">
            <span>
              {simple ? 'My guess' : 'Prediction'}: <b className="num">{guessText}</b>
            </span>
            <input type="range" min={3} max={NOT_SOON} step={1} value={guess} onChange={(e) => setGuess(Number(e.currentTarget.value))} aria-valuetext={guessText} />
          </label>
          <details className="game-more">
            <summary>More options</summary>
            <label className="heat-slider">
              <span>
                {simple ? 'Busy workers' : 'Busy threads'}: <b className="num">{workers}</b> of {cores}
              </span>
              <input type="range" min={1} max={cores} step={1} value={workers} onChange={(e) => setWorkers(Number(e.currentTarget.value))} aria-valuetext={`${workers} of ${cores}`} />
            </label>
          </details>
          {demo && (
            <div className="game-toggle" role="group" aria-label="Simulated Mac">
              <button type="button" aria-pressed={!simFans} onClick={() => setSimFans(false)}>
                Fanless Air
              </button>
              <button type="button" aria-pressed={simFans} onClick={() => setSimFans(true)}>
                Mac with fans
              </button>
            </div>
          )}
          <p className="fine">
            {simple
              ? 'Tip: a hard desk cools better than a lap, so play on a table.'
              : `Each busy thread is a Web Worker running an empty loop. Stop, leaving this game, or ${LOAD_S} s ends it. A hard desk cools better than a lap.`}
          </p>
        </div>
      )}

      {g.phase === 'done' && (
        <p className="game-goal">
          {simple ? 'You guessed ' : 'Predicted '}
          <span className="num strong">{g.guess == null ? 'not within the minute' : `${g.guess} s`}</span>.{' '}
          {g.actual == null ? (fans ? 'The fans never spun up' : 'The clock never dropped') + ' while the load ran.' : <>{fans ? 'The fans spun up' : 'The clock dropped'} at <span className="num strong">{Math.round(g.actual)} s</span>.</>}{' '}
          {g.newBest ? 'New best: ' : ''}
          <span className="num strong">{g.score}</span> points.
        </p>
      )}

      <div className="game-actions">
        {(g.phase === 'idle' || g.phase === 'done') && (
          <button type="button" className="game-go" onClick={start}>
            {g.phase === 'done' ? 'Race again' : 'Start'}
          </button>
        )}
        {g.phase === 'run' && (
          <button type="button" className="game-go heat-stop" onClick={stop}>
            Stop the load
          </button>
        )}
        {g.phase === 'cool' && (
          <button type="button" className="lab-btn" onClick={settle}>
            Skip the cool-down
          </button>
        )}
      </div>
      {g.phase === 'done' && g.pts.length > 0 && Date.now() - g.stopT < 60_000 && !demo && <p className="fine heat-note">Run Heat Race again only after the Mac cools: a warm case reacts sooner.</p>}

      {g.phase === 'done' ? (
        <>
          <Lesson pts={g.pts} fans={fans} actual={g.actual} demo={demo} />
          <Sources list={SOURCES} />
        </>
      ) : (
        <p className="fine game-how">
          {simple ? 'Every bit of power the chip uses turns into heat.' : 'Temperature is the SMC CPU sensor average; the clock is the P cluster average from IOReport; the state is ProcessInfo.thermalState.'}
          <InfoButton topic="cooling" />
        </p>
      )}
    </section>
  )
}

function Readout({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`heat-readout ${tone}`}>
      <span className="heat-readout-label">{label}</span>
      <span className="heat-readout-value num">{value}</span>
    </div>
  )
}

/** Temperature and P clock over the run, the load shaded, with the prediction and the real moment as markers. */
function HeatChart({ pts, fans, guess, actual, stopAt }: { pts: Point[]; fans: boolean; guess: number | null; actual: number | null; stopAt: number | null }) {
  const simple = useSimple()
  const W = 960
  const H = 300
  const L = 56
  const R = 64
  const T = 46
  const B = 34
  const span = LOAD_S + COOL_S
  const x = (t: number) => L + (Math.min(span, Math.max(0, t)) / span) * (W - L - R)
  const yT = (c: number) => T + (1 - (Math.min(105, Math.max(30, c)) - 30) / 75) * (H - T - B)
  const maxP = Math.max(4600, ...pts.map((p) => p.pMHz ?? 0))
  const yP = (m: number) => T + (1 - m / maxP) * (H - T - B)
  const maxR = Math.max(5000, ...pts.map((p) => p.rpm ?? 0))
  const yR = (r: number) => T + (1 - r / maxR) * (H - T - B)
  const line = (get: (p: Point) => number | null, y: (v: number) => number) =>
    pts
      .filter((p) => get(p) != null)
      .map((p, i) => `${i ? 'L' : 'M'} ${x(p.t).toFixed(1)} ${y(get(p)!).toFixed(1)}`)
      .join(' ')
  const lastT = pts.at(-1)
  const label = pts.length
    ? `Chart of ${pts.length} seconds: temperature reached ${Math.round(Math.max(...pts.map((p) => p.tempC ?? 0)))} degrees, P clock from ${Math.round(pts[0].pMHz ?? 0)} to ${Math.round(lastT?.pMHz ?? 0)} megahertz.`
    : 'Empty chart: temperature and P clock appear here once the load starts.'
  return (
    <svg className="heat-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {stopAt != null && <rect x={x(0)} y={T} width={x(stopAt) - x(0)} height={H - T - B} className="heat-load" />}
      {[40, 60, 80, 100].map((c) => (
        <g key={c}>
          <line x1={L} x2={W - R} y1={yT(c)} y2={yT(c)} className="heat-grid" />
          <text x={L - 8} y={yT(c) + 4} className="heat-axis heat-axis-t">
            {c}°
          </text>
        </g>
      ))}
      {[0, 2000, 4000].map((m) => (
        <text key={m} x={W - R + 8} y={yP(m) + 4} className="heat-axis heat-axis-p">
          {(m / 1000).toFixed(0)} GHz
        </text>
      ))}
      {[0, 15, 30, 45, 60, 75].map((s) => (
        <text key={s} x={x(s)} y={H - 10} className="heat-axis heat-axis-x">
          {s} s
        </text>
      ))}
      <path d={line((p) => p.pMHz, yP)} className="heat-line-p" />
      {fans && <path d={line((p) => p.rpm, yR)} className="heat-line-fan" />}
      <path d={line((p) => p.tempC, yT)} className="heat-line-t" />
      {guess != null && (
        <g className="heat-guess">
          <line x1={x(guess)} x2={x(guess)} y1={T - 6} y2={H - B} />
          <text x={x(guess)} y={T - 10}>
            {simple ? 'my guess' : 'prediction'}
          </text>
        </g>
      )}
      {actual != null && (
        <g className="heat-actual">
          <line x1={x(actual)} x2={x(actual)} y1={T} y2={H - B} />
          <text x={x(actual)} y={H - B - 8}>
            {fans ? 'fans up' : 'clock drops'}
          </text>
        </g>
      )}
      <g className="heat-legend" transform={`translate(${L + 8} 14)`}>
        <circle r={5} className="heat-dot-t" />
        <text x={10} y={4}>
          {simple ? 'heat' : 'CPU °C'}
        </text>
        <circle cx={90} r={5} className="heat-dot-p" />
        <text x={100} y={4}>
          {simple ? 'Fast Worker speed' : 'P clock'}
        </text>
        {fans && (
          <>
            <circle cx={250} r={5} className="heat-dot-fan" />
            <text x={260} y={4}>
              fan rpm
            </text>
          </>
        )}
      </g>
    </svg>
  )
}

function Lesson({ pts, fans, actual, demo }: { pts: Point[]; fans: boolean; actual: number | null; demo: boolean }) {
  const simple = useSimple()
  const temps = pts.map((p) => p.tempC).filter((v): v is number => v != null)
  const clocks = pts.map((p) => p.pMHz).filter((v): v is number => v != null)
  const peakT = temps.length ? Math.max(...temps) : null
  const peakP = clocks.length ? Math.max(...clocks) : null
  const endP = pts.filter((p) => p.pMHz != null && p.t <= LOAD_S).at(-1)?.pMHz ?? null
  const worst = pts.some((p) => p.state === 'serious' || p.state === 'critical') ? 'serious' : pts.some((p) => p.state === 'fair') ? 'fair' : 'nominal'
  return (
    <div className="game-lesson">
      <h4>{fans ? (simple ? 'Why the fans came on' : 'Fans versus throttling') : simple ? 'Why the Fast Workers slowed down' : 'Thermal throttling on a fanless Mac'}</h4>
      <p>
        {simple ? 'In this run the chip got as hot as ' : 'This run: the CPU peaked at '}
        <b className="num">{temp(peakT)}</b>
        {simple ? ", and the Fast Workers' top speed was " : ', the P clock peaked at '}
        <b className="num">{mhz(peakP)}</b>
        {simple ? ' and ended at ' : ' and was at '}
        <b className="num">{mhz(endP)}</b>
        {simple ? ' when the work stopped.' : ' when the load stopped.'} {simple ? 'The cooling state reached' : 'The thermal state reached'} <b>{worst}</b>.
        {demo ? ' These are simulated numbers.' : ''}
      </p>
      {simple ? (
        fans ? (
          <p>Every watt the chip uses becomes heat. This Mac has fans: they blow air over metal fins and out of the case, and they speed up as the chip warms. That carries the heat away, so the Fast Workers can keep running at full speed much longer.</p>
        ) : (
          <>
            <p>Every watt the chip uses becomes heat. A MacBook Air has no fan. The heat soaks into the metal case and drifts off into the room. The case soaks up a short burst easily, which is why quick jobs run at full speed.</p>
            <p>On a long job the case fills up with heat like a sponge fills with water. Then macOS slows the Fast Workers to make less heat. That is throttling. It is normal, and it is how the Mac protects itself. The Eco Workers keep going, because they do the most work for each bit of heat.</p>
          </>
        )
      ) : fans ? (
        <>
          <p>
            Every watt the chip draws ends up as heat. A Mac with fans pushes air over a heatsink and out of the case, and spins the fans faster as temperatures rise. Removing heat faster lets the chip hold a higher power budget, so the P clock stays near its top step for far longer than on a fanless Air.
          </p>
          <p>Apple's guidance is that at the fair thermal state the fans may become audible. If they could not keep up, macOS would lower the power budget, and the clock and voltage with it, exactly as it does on an Air.</p>
        </>
      ) : (
        <>
          <p>
            Every watt the chip draws ends up as heat. A MacBook Air has no fan, heatsink or heat pipe: iFixit found only a shield, graphite tape and a thermal pad carrying heat into the aluminium top case, which spreads it out and gives it to the room. The cold case absorbs a 15 to 20 W burst for a while, so short jobs run at full clock.
          </p>
          <p>
            A sustained load fills that heat sponge. As the die nears its limit, macOS lowers the P cluster's power budget, and its clock and voltage come down together. Because power falls faster than the clock, a small clock cut removes a lot of heat. In lesson 5's measured run on an M5 Air, the die went from 58 to 93 °C in 30 s, macOS held it near 92 °C by walking the P clock down, and left the E cluster at full clock, since E cores give far more work per watt.
          </p>
          <p>{actual == null ? 'Your clock held for the whole minute, a sign the case still had room to soak up heat.' : `Yours started to give way at ${Math.round(actual)} s.`} The thermal state is not a temperature: it is macOS's summary of how hard it is working to stay cool, which is why it can say fair while the die is cooling.</p>
        </>
      )}
      <p className="fine">A cooler room, a hard desk instead of a lap, or a charger all change the timing. Treat one run as one run.</p>
    </div>
  )
}
