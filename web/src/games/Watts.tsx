import { useEffect, useReducer, useRef, useState } from 'react'
import { Sources, type LabProps, type Source } from '../labs/kit.tsx'
import { Unavailable, readBest, saveBest } from './kit.tsx'
import { InfoButton } from '../Learn.tsx'
import { useSimple } from '../simple.ts'
import { watts } from '../format.ts'
import type { Sample } from '../types.ts'
import { GUESS_MAX, TASKS, WINDOW_S, breakdown, guessScore, judge, machineWatts, simWatts, type Source as PowerSource } from './watts.ts'
import './play.css'
import './Watts.css'

// Guess the Watts: the player does something real, guesses the power before the reveal, and the reader measures it.

const BEST = 'macviz.best.watts'
type Phase = 'idle' | 'guess' | 'measure' | 'reveal' | 'done'
type Result = { guess: number; w: number | null; from: PowerSource | null; score: number; last: Sample | null }

const SOURCES: Source[] = [
  { title: 'Apple: Mac mini power consumption and thermal output', url: 'https://support.apple.com/103253', note: 'Apple measures 4 W idle for the M4 Mac mini, and 19.9 W for the 2018 Mac mini with an Intel Core i7.' },
  {
    title: 'Apple, Energy Efficiency Guide for Mac Apps: fundamental concepts',
    url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/FundamentalConcepts.html',
    note: 'Fixed and dynamic cost, powering down between keystrokes, and 100% CPU use at about 10 times idle power. Written for Intel Macs; the model still holds.',
  },
  { title: 'Eclectic Light: Inside M4 chips, CPU core management', url: 'https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/', note: 'Background work runs on the E cores at about 1020 MHz.' },
  { title: 'Wikipedia: Dynamic voltage scaling', url: 'https://en.wikipedia.org/wiki/Dynamic_voltage_scaling', note: 'Switching power grows with capacitance times voltage squared times frequency.' },
  { title: 'macmon by vladkens', url: 'https://github.com/vladkens/macmon', note: 'The IOReport energy counters the reader uses for CPU, GPU and Neural Engine watts.' },
]

const FROM_TEXT: Record<PowerSource, string> = {
  system: "the SMC's whole-system power reading",
  battery: "the battery's outflow, since the SMC total isn't readable here",
  chip: 'the chip parts only, since no whole-system reading is available here, so the display and everything off the chip are missing',
}

export default function Watts({ s, history, demo }: LabProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const [guess, setGuess] = useState(8)
  const g = useRef({
    phase: 'idle' as Phase,
    round: 0,
    startT: 0,
    sim: [] as Sample[],
    results: [] as Result[],
    best: readBest(BEST),
    newBest: false,
    copied: '',
    say: '',
  }).current
  const slider = useRef<HTMLInputElement>(null)
  const hist = useRef(history)
  hist.current = history
  const task = TASKS[Math.min(g.round, TASKS.length - 1)]

  // The 10 s window ticks four times a second for the countdown; in the demo it also makes one simulated sample a second.
  useEffect(() => {
    if (g.phase !== 'measure') return
    const id = setInterval(() => {
      const el = (Date.now() - g.startT) / 1000
      while (demo && g.sim.length < Math.min(WINDOW_S, Math.floor(el))) {
        const t = g.sim.length
        g.sim.push({ t: g.startT + t * 1000, power: simWatts(task.id, t), battery: null } as unknown as Sample)
      }
      if (el < WINDOW_S) return render()
      clearInterval(id)
      const window = demo ? g.sim : hist.current.filter((x) => x.t >= g.startT)
      const v = judge(window, task.use)
      const score = v ? guessScore(guess, v.w) : 0
      g.results.push({ guess, w: v?.w ?? null, from: v?.from ?? null, score, last: window.at(-1) ?? null })
      g.phase = 'reveal'
      g.say = v ? `Measured ${watts(v.w)}. You guessed ${watts(guess)}. ${score} points.` : 'No power reading came in during the window.'
      render()
    }, 250)
    return () => clearInterval(id)
  }, [g.phase, g.round]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo && machineWatts(s) == null)
    return (
      <Unavailable title="Power readings not available">
        The reader sends no system, battery or chip power on this Mac. Power comes from the SMC and from IOReport energy counters, which some Macs and macOS versions do not expose.
      </Unavailable>
    )

  const focusSlider = () => requestAnimationFrame(() => slider.current?.focus())
  const begin = () => {
    Object.assign(g, { phase: 'guess', round: 0, results: [], newBest: false })
    g.say = `Round 1 of ${TASKS.length}: ${TASKS[0].name}. Set your guess.`
    render()
    focusSlider()
  }
  const measure = () => {
    Object.assign(g, { phase: 'measure', startT: Date.now(), sim: [] })
    g.say = `Measuring for ${WINDOW_S} seconds. ${simple ? task.howPlain : task.how}`
    render()
  }
  const next = () => {
    if (g.round < TASKS.length - 1) {
      g.round++
      g.phase = 'guess'
      g.say = `Round ${g.round + 1} of ${TASKS.length}: ${TASKS[g.round].name}. Set your guess.`
      render()
      focusSlider()
      return
    }
    const total = g.results.reduce((a, r) => a + r.score, 0)
    g.phase = 'done'
    g.newBest = total > (g.best ?? 0)
    if (g.newBest) {
      g.best = total
      saveBest(BEST, total)
    }
    g.say = `Game over. ${total} points.${g.newBest ? ' A new best.' : ''}`
    render()
  }
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        g.copied = text
        render()
      },
      () => {
        // Clipboard blocked; the command is on screen to select by hand.
      },
    )
  }

  const total = g.results.reduce((a, r) => a + r.score, 0)
  const r = g.results[g.round]
  const left = g.phase === 'measure' ? Math.max(0, WINDOW_S - (Date.now() - g.startT) / 1000) : WINDOW_S
  const inRound = g.phase === 'guess' || g.phase === 'measure' || g.phase === 'reveal'

  return (
    <section className={`card watts-game phase-${g.phase}`} aria-labelledby="watts-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="watts-title">Guess the Watts</h3>
        {demo && <span className="sim-badge">Simulated power</span>}
        <span className="game-score">
          <span className="num">{total}</span> pts
          <span className="game-best">best {g.best ?? 'none yet'}</span>
        </span>
      </div>
      <div className="lid-pips" aria-label={`Round ${g.round + 1} of ${TASKS.length}`}>
        {TASKS.map((t, i) => {
          const x = g.results[i]
          return <span key={t.id} className={`pip ${x ? (x.score >= 50 ? 'won' : 'lost') : i === g.round && inRound ? 'now' : ''}`} title={t.name} />
        })}
      </div>

      {g.phase === 'idle' && (
        <div className="watts-intro">
          <p>
            {simple
              ? `Five things to do with this Mac. Before each one, guess how much power the whole Mac will use while you do it. Then do it for ${WINDOW_S} seconds while the reader measures. The closer your guess, the more points.`
              : `Five real actions. Before each, guess the whole Mac's power draw in watts, then do it for ${WINDOW_S} seconds while the reader measures. Closeness is scored as a ratio, so 2 W off at idle costs as much as 10 W off under heavy load.`}
          </p>
          <ol className="watts-list">
            {TASKS.map((t) => (
              <li key={t.id}>{simple ? t.plain : t.name}</li>
            ))}
          </ol>
        </div>
      )}

      {inRound && (
        <div className="watts-task">
          <div className="watts-task-head">
            <span className="watts-round num">
              {g.round + 1}/{TASKS.length}
            </span>
            <h4>{simple ? task.plain : task.name}</h4>
            {task.use === 'peak' && <span className="watts-tag">{simple ? 'highest moment counts' : 'judged by peak'}</span>}
          </div>
          <p>{simple ? task.howPlain : task.how}</p>
          {task.cmd && (
            <div className="watts-cmds">
              <CopyLine label={simple ? 'Start' : 'Start in Terminal'} cmd={task.cmd} copied={g.copied === task.cmd} onCopy={copy} />
              <CopyLine label={simple ? 'Stop' : 'Stop it'} cmd={task.stop!} copied={g.copied === task.stop} onCopy={copy} />
              <p className="fine">
                {simple
                  ? 'This keeps every worker busy and warms the Mac. It is safe, and it stops when you run the stop line or close the Terminal window.'
                  : 'One yes loop per core, each writing to /dev/null: pure CPU load, nothing saved. killall yes stops all of them, and so does closing the Terminal window.'}
              </p>
            </div>
          )}
        </div>
      )}

      {inRound && <WattsMeter guess={guess} actual={g.phase === 'reveal' ? (r?.w ?? null) : null} measuring={g.phase === 'measure'} left={left} />}

      {g.phase === 'guess' && (
        <label className="watts-slider">
          <span>
            {simple ? 'Your guess' : 'Your guess, whole Mac'}: <b className="num">{watts(guess)}</b>
          </span>
          <input ref={slider} type="range" min={0.5} max={GUESS_MAX} step={0.5} value={guess} onChange={(e) => setGuess(Number(e.currentTarget.value))} aria-valuetext={`${guess} watts`} />
        </label>
      )}

      {g.phase === 'reveal' && r && (
        <div className="watts-reveal">
          {r.w == null ? (
            <p>No power reading arrived during the window, so this round scores nothing. Check that the reader is still connected.</p>
          ) : (
            <>
              <p className="watts-verdict">
                {simple ? 'It used ' : 'Measured '}
                <b className="num">{watts(r.w)}</b>
                {task.use === 'peak' ? ' at its peak' : ' on average'}, you guessed <b className="num">{watts(r.guess)}</b>. <b className="num watts-plus">+{r.score}</b>
              </p>
              {r.last && <Breakdown s={r.last} />}
              <p className="fine">
                {demo ? 'Simulated readings, shaped like a base M5 Air, not measured.' : `From ${FROM_TEXT[r.from!]}: ${task.use === 'peak' ? 'the highest' : 'the average'} of the one-second samples in the window. The bar shows the last sample.`}
                {task.id === 'cpu' && !demo && (
                  <>
                    {' '}
                    Stop the load now with <code>killall yes</code>.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {g.phase === 'done' && (
        <div className="watts-summary">
          <table>
            <thead>
              <tr>
                <th scope="col">{simple ? 'What you did' : 'Task'}</th>
                <th scope="col">Guess</th>
                <th scope="col">Measured</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {g.results.map((x, i) => (
                <tr key={TASKS[i].id}>
                  <td>{simple ? TASKS[i].plain : TASKS[i].name}</td>
                  <td className="num">{watts(x.guess)}</td>
                  <td className="num">{watts(x.w)}</td>
                  <td className="num">{x.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="game-goal">
            {g.newBest ? 'New best: ' : 'Final score: '}
            <span className="num strong">{total}</span> of {TASKS.length * 100}.
          </p>
        </div>
      )}

      <div className="game-actions">
        {(g.phase === 'idle' || g.phase === 'done') && (
          <button type="button" className="game-go" onClick={begin}>
            {g.phase === 'done' ? 'Play again' : 'Start'}
          </button>
        )}
        {g.phase === 'guess' && (
          <button type="button" className="game-go" onClick={measure}>
            {simple ? `Lock it in and measure` : `Lock guess, measure ${WINDOW_S} s`}
          </button>
        )}
        {g.phase === 'reveal' && (
          <button type="button" className="game-go" onClick={next}>
            {g.round < TASKS.length - 1 ? 'Next' : 'See the total'}
          </button>
        )}
      </div>

      {g.phase === 'done' ? (
        <>
          <Lesson results={g.results} demo={demo} />
          <Sources list={SOURCES} />
        </>
      ) : (
        <p className="fine game-how">
          {simple ? 'The Mac has meters that count the power each part uses.' : 'Whole-system power from the SMC; CPU, GPU, Neural Engine and DRAM power from IOReport energy counters, once a second.'}
          <InfoButton topic="power" />
        </p>
      )}
    </section>
  )
}

function CopyLine({ label, cmd, copied, onCopy }: { label: string; cmd: string; copied: boolean; onCopy: (c: string) => void }) {
  return (
    <div className="watts-cmd">
      <span className="watts-cmd-label">{label}</span>
      <code>{cmd}</code>
      <button type="button" className="lab-btn" onClick={() => onCopy(cmd)} aria-label={`Copy: ${cmd}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** A scale with the guess as a marker above it and, after the reveal, the measured value below. */
function WattsMeter({ guess, actual, measuring, left }: { guess: number; actual: number | null; measuring: boolean; left: number }) {
  const x = (w: number) => 30 + (Math.min(w, GUESS_MAX) / GUESS_MAX) * 900
  const label = actual == null ? `Your guess: ${guess} watts.` : `Your guess ${guess} watts, measured ${actual.toFixed(1)} watts.`
  return (
    <svg className="watts-meter" viewBox="0 0 960 130" role="img" aria-label={label}>
      <rect x={30} y={56} width={900} height={16} rx={8} className="watts-track" />
      {measuring && <rect x={30} y={56} width={Math.max(16, 900 * (1 - left / WINDOW_S))} height={16} rx={8} className="watts-fill" />}
      {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={76} x2={x(t)} y2={84} className="watts-tick" />
          <text x={x(t)} y={102} className="watts-tick-label">
            {t}
          </text>
        </g>
      ))}
      <g className="watts-guess" style={{ transform: `translateX(${x(guess)}px)` }}>
        <path d="M0 52 L-10 34 H10 Z" />
        <text y={26}>guess {guess} W</text>
      </g>
      {actual != null && (
        <g className="watts-actual" style={{ transform: `translateX(${x(actual)}px)` }}>
          <path d="M0 76 L-10 94 H10 Z" />
          <text y={122}>measured {actual.toFixed(1)} W</text>
        </g>
      )}
      {measuring && (
        <text x={480} y={124} className="watts-counting">
          measuring, {Math.ceil(left)} s left
        </text>
      )}
    </svg>
  )
}

/** Where the watts went in one sample: the chip's parts, then everything else in the whole-system total. */
function Breakdown({ s }: { s: Sample }) {
  const simple = useSimple()
  const b = breakdown(s)
  const parts: [string, string, number | null][] = [
    [simple ? 'Workers (CPU)' : 'CPU', 'cpu', b.cpu],
    [simple ? 'Graphics (GPU)' : 'GPU', 'gpu', b.gpu],
    [simple ? 'AI engine' : 'Neural Engine', 'ane', b.ane],
    [simple ? 'Desk Space (memory)' : 'DRAM', 'dram', b.dram],
    [simple ? 'Everything else: screen, storage, Wi-Fi' : 'Rest: display, SSD, radios, conversion losses', 'rest', b.rest],
  ]
  const total = parts.reduce((a, p) => a + (p[2] ?? 0), 0) || 1
  return (
    <div className="watts-break" role="img" aria-label={parts.map(([n, , v]) => `${n} ${watts(v)}`).join(', ')}>
      <div className="watts-stack" aria-hidden>
        {parts.map(([n, k, v]) => (v ? <span key={k} className={`wb-${k}`} style={{ flexGrow: v }} title={`${n} ${watts(v)}`} /> : null))}
      </div>
      <ul className="watts-legend" aria-hidden>
        {parts.map(([n, k, v]) => (
          <li key={k}>
            <span className={`watts-dot wb-${k}`} />
            <span>{n}</span> <b className="num">{watts(v)}</b> <span className="fine">{v == null ? '' : `${Math.round((v / total) * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Lesson({ results, demo }: { results: Result[]; demo: boolean }) {
  const simple = useSimple()
  const idle = results[0]?.w ?? null
  const cpu = results[4]?.w ?? null
  const last = results[0]?.last
  const rest = last ? breakdown(last).rest : null
  const restPct = rest != null && last?.power.systemW ? Math.round((rest / last.power.systemW) * 100) : null
  return (
    <div className="game-lesson">
      <h4>{simple ? 'Where the power goes, and why this Mac sips it' : 'Where the watts go, and why Apple Silicon idles so low'}</h4>
      {simple ? (
        <>
          <p>
            Sitting still, this Mac used {watts(idle)}. {restPct != null ? `About ${restPct}% of that was not the chip at all: mostly the screen, plus storage and Wi-Fi.` : 'Most of that is usually the screen, not the chip.'} With every worker busy it used {watts(cpu)}.
          </p>
          <p>
            The chip saves power by switching off whatever is not working, even for the split second between key presses. Small chores go to the Eco Workers, which run slowly and sip power, while the Fast Workers sleep. And running a little slower saves a lot: slower parts can run on lower voltage, and power drops much faster than speed does.
          </p>
          <p>Apple's own numbers show the change: a 2018 Mac mini with an Intel chip used about 20 W doing nothing, and the M4 Mac mini uses 4 W.</p>
        </>
      ) : (
        <>
          <p>
            Your idle round measured {watts(idle)}
            {restPct != null ? `, and ${restPct}% of the last idle sample was off the chip: the display backlight, the SSD, the radios and the conversion losses that the SMC's total includes and the chip counters don't.` : '.'}{' '}
            The all-core round measured {watts(cpu)}. Apple's energy guide puts 100% CPU at about 10 times idle power; your ratio was {idle && cpu ? `${(cpu / idle).toFixed(1)} times` : 'n/a'}, lower because the display and the rest of the Mac sit in both numbers.
          </p>
          <p>
            Apple Silicon idles low for three reasons you can watch in the live readings. Unused blocks are powered down: macOS turns off resources even between keystrokes, which is why the GPU and Neural Engine read near 0 W when nothing uses them. Background work goes to the E cores, which run near 1 GHz for it while the P cluster sleeps. And dynamic power scales with C·V²·f, so a lower clock at a lower voltage cuts power much more than it cuts speed.
          </p>
          <p>Apple's own figures show the size of the change: 19.9 W idle for the 2018 Mac mini with a Core i7, 4 W for the M4 Mac mini.</p>
        </>
      )}
      <p className="fine">{demo ? 'These numbers were simulated, not measured. Run the game without ?demo to measure this Mac.' : 'Your numbers are from this Mac, in this run. Screen brightness, background apps and charging all move them.'}</p>
    </div>
  )
}
