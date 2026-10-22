import { useEffect, useReducer, useRef, useState } from 'react'
import type { LabProps } from '../labs/kit.tsx'
import { memGB, num } from '../format.ts'
import { useSimple } from '../simple.ts'
import { InfoButton } from '../Learn.tsx'
import { HowTo, readBest, saveBest } from './kit.tsx'
import { GOALS, TIGHT, demoPoint, pointOf, round, type Event, type Goal, type MemPoint } from './fill-ram.ts'
import { MAX_APPS } from '../labs/compress-sim.ts'
import './FillRam.css'

// Fill the RAM: the player opens real apps and tabs and watches the compressor, swap and pressure respond. The
// page itself allocates nothing; every reading comes from the reader, or from the lab's toy Mac in demo mode.

const BEST = 'macviz.best.fillram'
type Phase = 'idle' | 'playing' | 'done'
const PLAIN_LEVEL = { normal: 'fine', warn: 'tight', critical: 'struggling' } as const

const GOAL_TEXT: Record<Goal, [string, string]> = {
  tight: [`Free memory under ${TIGHT * 100}% of RAM`, 'Almost no empty spots on the desk'],
  compress: ['Compressor grows by 256 MB', 'macOS folds 256 MB more into bundles'],
  swap: ['Swap grows by 64 MB', '64 MB more goes to Overflow Storage'],
  warn: ['Memory pressure reaches warn', 'The desk gets tight'],
}

function eventText(e: Event, base: MemPoint, simple: boolean): string {
  const p = e.p
  switch (e.kind) {
    case 'start':
      return simple
        ? `Started with ${memGB(p.free)} empty, ${memGB(p.compressed)} of bundles and ${memGB(p.swap)} in Overflow Storage.`
        : `Start: ${memGB(p.free)} free, ${memGB(p.compressed)} compressed, ${memGB(p.swap)} swap, pressure ${p.pressure}.`
    case 'tight':
      return simple ? `The desk filled up: ${memGB(p.free)} empty. macOS starts clearing file copies.` : `Free fell to ${memGB(p.free)}. From here macOS reclaims cached file pages, then compresses.`
    case 'compress':
      return simple
        ? `Folding started: bundles grew to ${memGB(p.compressed)}.`
        : `The compressor grew by ${memGB(p.compressed - base.compressed)} to ${memGB(p.compressed)}${p.stored == null ? '' : `, holding ${memGB(p.stored)} of pages`}.`
    case 'swap':
      return simple ? `Overflow Storage grew by ${memGB(p.swap - base.swap)}. Bundles are going to the SSD.` : `Swap grew by ${memGB(p.swap - base.swap)} to ${memGB(p.swap)}: compressed segments are going to the SSD.`
    case 'warn':
      return simple ? 'The desk is tight. You did it. Apps are being asked to tidy up.' : `Pressure reached ${p.pressure}. Apps are being asked to free caches.`
    case 'critical':
      return simple ? 'The desk is struggling. Time to quit some apps.' : 'Pressure reached critical. Quit some apps now.'
    case 'calm':
      return simple ? `Back to fine, with ${memGB(p.free)} empty.` : `Back to normal pressure, ${memGB(p.free)} free.`
  }
}

function MemBar({ p, simple }: { p: MemPoint; simple: boolean }) {
  const parts: [string, number | null, string, string][] = [
    ['wired', p.wired, 'Wired', 'Locked for macOS'],
    ['app', p.app, 'App', 'Apps'],
    ['cmp', p.compressed, 'Compressed', 'Bundles'],
    ['cache', p.cached, 'Cached', 'File copies'],
    ['free', p.free, 'Free', 'Empty'],
  ]
  const pct = (b: number | null) => `${Math.max(0, Math.min(100, ((b ?? 0) / p.total) * 100))}%`
  return (
    <div className="fr-map">
      <div className="fr-bar" role="img" aria-label={parts.map(([, b, t]) => `${t} ${memGB(b)}`).join(', ')}>
        {parts.map(([k, b]) => (
          <span key={k} className={`fr-${k}`} style={{ width: pct(b) }} />
        ))}
      </div>
      <div className="fr-bar swap" role="img" aria-label={`Swap used ${memGB(p.swap)}, drawn to the same scale as RAM`}>
        <span className="fr-swap" style={{ width: pct(p.swap) }} />
      </div>
      <ul className="fr-keys">
        {parts.map(([k, b, t, plain]) => (
          <li key={k}>
            <i className={`fr-${k}`} />
            {simple ? plain : t} <span className="num">{memGB(b)}</span>
          </li>
        ))}
        <li>
          <i className="fr-swap" />
          {simple ? 'Overflow Storage' : 'Swap'} <span className="num">{memGB(p.swap)}</span>
        </li>
      </ul>
    </div>
  )
}

const signed = (v: number) => `${v >= 0 ? '+' : '-'}${memGB(Math.abs(v))}`

export default function FillRam({ s, demo }: LabProps) {
  const simple = useSimple()
  const word = (tech: string, plain: string) => (simple ? plain : tech)
  const [, render] = useReducer((n: number) => n + 1, 0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [apps, setApps] = useState(0)
  const points = useRef<MemPoint[]>([])
  const best = useRef(readBest(BEST))
  const newBest = useRef(false)
  const total = s.memory.totalBytes
  const now = demo ? demoPoint(apps, Date.now(), total) : pointOf(s)

  // One reading per sample while a round runs. Demo mode reads the toy Mac once a second instead.
  useEffect(() => {
    if (phase !== 'playing' || demo) return
    points.current.push(pointOf(s))
    render()
  }, [s, phase, demo])
  const appsRef = useRef(apps)
  appsRef.current = apps
  useEffect(() => {
    if (phase !== 'playing' || !demo) return
    const id = setInterval(() => {
      points.current.push(demoPoint(appsRef.current, Date.now(), total))
      render()
    }, 1000)
    return () => clearInterval(id)
  }, [phase, demo, total])

  const r = round(points.current)
  const base = points.current[0] ?? now
  const start = () => {
    points.current = [now]
    newBest.current = false
    setPhase('playing')
  }
  const stop = () => {
    newBest.current = r.score > (best.current ?? 0)
    if (newBest.current) {
      best.current = r.score
      saveBest(BEST, r.score)
    }
    setPhase('done')
  }
  const ratio = now.stored != null && now.compressed > 0 ? now.stored / now.compressed : null

  return (
    <section className="card fr-game" aria-labelledby="fr-title">
      <div className="game-head">
        <h3 id="fr-title">Fill the RAM</h3>
        {demo && <span className="sim-badge">Simulated</span>}
        <span className="game-score">
          <span className="num">{r.score}</span> pts
          <span className="game-best">best {best.current ?? 'none yet'}</span>
        </span>
      </div>
      {phase === 'idle' && (
        <HowTo
          steps={[
            'Save your work in other apps, just in case.',
            'Press Start.',
            'Open lots of browser tabs and big apps you already have, such as Photos, a game or a video editor. Keep them all open.',
            'Watch the bar fill up. Every goal in the list below that you reach scores points. Press Finish when you are done, then quit the apps you opened.',
          ]}
        />
      )}

      <div className="fr-live">
        <MemBar p={now} simple={simple} />
        {phase !== 'idle' && (
          <div className="fr-stats">
            <div>
              <span className="fr-label">{word('Pressure', 'How hard it works')}</span>
              <span className={`badge pressure-${now.pressure}`}>{simple ? PLAIN_LEVEL[now.pressure] : now.pressure}</span>
            </div>
            <div>
              <span className="fr-label">{word('Compression ratio', 'Folding ratio')}</span>
              <span className="num">{ratio == null ? 'n/a' : `${num(ratio, 2)} to 1`}</span>
            </div>
            <div>
              <span className="fr-label">{word('Compressed since start', 'Folded since start')}</span>
              <span className="num">{signed(now.compressed - base.compressed)}</span>
            </div>
            <div>
              <span className="fr-label">{word('Swap since start', 'Overflow since start')}</span>
              <span className="num">{signed(now.swap - base.swap)}</span>
            </div>
          </div>
        )}
      </div>

      <ol className="fr-goals">
        {GOALS.map((g) => (
          <li key={g.id} className={r.reached.has(g.id) ? 'done' : ''}>
            <span className="fr-check" aria-hidden>
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M3 8.5 L6.5 12 L13 4.5" />
              </svg>
            </span>
            <span>{GOAL_TEXT[g.id][simple ? 1 : 0]}</span>
            <span className="num fr-pts">
              {g.points} pts<span className="sr-only">{r.reached.has(g.id) ? ', reached' : ', not yet'}</span>
            </span>
          </li>
        ))}
      </ol>

      {demo && (
        <label className="sim-control">
          <span>
            {word('Simulated apps open', 'Pretend apps open')}: <span className="num">{apps}</span>
          </span>
          <input type="range" min={0} max={MAX_APPS} step={1} value={apps} onChange={(e) => setApps(Number(e.currentTarget.value))} aria-valuetext={`${apps} apps`} />
          <span className="fine">The demo runs the toy Mac from the Compression and swap lab, scaled up. Start a round, then drag right.</span>
        </label>
      )}

      <div className="game-actions">
        {phase === 'playing' ? (
          <button type="button" className="game-go" onClick={stop}>
            Finish
          </button>
        ) : (
          <button type="button" className="game-go" onClick={start}>
            {phase === 'done' ? 'Play again' : 'Start'}
          </button>
        )}
      </div>

      {phase === 'done' && r.peak && (
        <p className="game-goal" aria-live="polite">
          {newBest.current ? 'New best: ' : 'Final score: '}
          <span className="num strong">{r.score}</span> of 100.{' '}
          {simple
            ? `At the most: ${PLAIN_LEVEL[r.peak.pressure]}, ${memGB(r.peak.compressed)} folded, ${memGB(r.peak.swap)} in Overflow Storage, ${memGB(r.peak.minFree)} empty at the lowest.`
            : `Peak: ${r.peak.pressure} pressure, ${memGB(r.peak.compressed)} compressed, ${memGB(r.peak.swap)} swap, ${memGB(r.peak.minFree)} free at the lowest.`}{' '}
          {'Now quit the apps you opened.'}
        </p>
      )}

      {phase !== 'idle' && (
        <section className="fr-timeline" aria-label="What just happened">
          <h4>{word('What just happened', 'What happened')}</h4>
          <ol>
            {r.events.map((e, n) => (
              <li key={n} className={`fr-ev ${e.kind}`}>
                <span className="num fr-at">{e.kind === 'start' ? '0 s' : `+${Math.round(e.at)} s`}</span>
                <span>{eventText(e, base, simple)}</span>
              </li>
            ))}
            {phase === 'playing' && (
              <li className="fr-ev wait">
                <span className="fr-at" />
                <span>{word('Recording a reading every second.', 'Watching every second.')}</span>
              </li>
            )}
          </ol>
        </section>
      )}

      <details className="game-more fr-help">
        <summary>Tips, and why this is safe</summary>
        <section>
          <h4>{word('How to fill it, for real', 'How to fill the desk')}</h4>
          <ul>
            <li>{word('Open lots of browser tabs. Maps, video sites and big web apps use the most.', 'Open lots of browser tabs. Maps, videos and big web apps take the most room.')}</li>
            <li>{word('Open big apps you already have: Photos with a large library, Xcode, a video editor, a game.', 'Open big apps you already have, such as Photos, a video editor or a game.')}</li>
            <li>{word('Keep them all open and switch between them now and then, so older pages turn cold and get compressed.', 'Keep them all open and switch between them now and then.')}</li>
            <li>{word('A Mac with lots of RAM may never reach warn. Compression and swap growth still score.', 'A Mac with a big desk may never get tight. Folding and Overflow Storage still score.')}</li>
          </ul>
        </section>
        <section className="fr-safe">
          <h4>Safe, and easy to undo</h4>
          <p>
            {word(
              'This is harmless: macOS does exactly this every day. Nothing here runs code or changes settings, and this page holds no memory of its own. Save your work first, because at critical pressure macOS may ask you to quit apps.',
              "This can't hurt your Mac. It does this every day on its own. Nothing here runs anything or changes settings. Save your work first, in case macOS asks you to quit an app.",
            )}
          </p>
          <p>
            {word(
              'To undo, quit the apps you opened with Command-Q and close the extra tabs. Their memory frees at once. Swap and compressed memory shrink over the next minutes.',
              'To undo, quit the apps you opened with Command-Q and close the extra tabs. The desk clears at once. Overflow Storage empties over the next few minutes.',
            )}
          </p>
        </section>
      </details>

      <p className="fine game-how">
        {word(
          'Measured once a second: free, cached and compressed memory from host_statistics64, swap from vm.swapusage, and pressure from kern.memorystatus_vm_pressure_level. The Compression and swap lab explains each stage.',
          'The numbers come straight from macOS, once a second. The Compression and swap lab explains each stage.',
        )}
        <InfoButton topic="memory-pressure" />
      </p>
    </section>
  )
}
