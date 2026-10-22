import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Hardware, Sample } from '../types.ts'
import type { Live } from '../useStream.ts'
import { useSimple } from '../simple.ts'
import { Val } from '../ui.tsx'

// Shared parts for the labs: every lab is an SVG scene driven by a step-through story, a ticker for motion,
// live readings from this Mac, and a list of the sources its facts come from.

export type LabProps = { hw: Hardware; s: Sample; history: Sample[]; live: Live; demo: boolean }

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Seconds since `running` last turned on, re-rendering about 30 times a second while it is on and the tab is
 * visible. Under reduced motion it never ticks and stays at `rest`, so scenes must draw a sensible still frame
 * for whatever time they rest at.
 */
export function useTicker(running: boolean, rest = 0): number {
  const [t, setT] = useState(rest)
  useEffect(() => {
    if (!running || reducedMotion()) {
      setT(rest)
      return
    }
    const t0 = performance.now()
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 30) return
      last = now
      setT((now - t0) / 1000)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, rest])
  return t
}

/** 0..1 progress through a span of a timeline, clamped, with an ease in and out. */
export function phase(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)))
  return x * x * (3 - 2 * x)
}
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** A point part way along a polyline, for tokens that travel between boxes. */
export function along(pts: [number, number][], k: number): [number, number] {
  if (pts.length === 1) return pts[0]
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  let d = Math.min(1, Math.max(0, k)) * seg.reduce((a, b) => a + b, 0)
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? d / seg[i] : 0
      return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)]
    }
    d -= seg[i]
  }
  return pts[pts.length - 1]
}

export type Step = {
  title: string
  /** The narration, in technical words and in everyday words for Simple mode. */
  tech: ReactNode
  plain: ReactNode
  /** Seconds the animation for this step runs before Play moves on. */
  dur: number
}

/**
 * Which step of a story is showing, and how far into it the animation is. The animation replays when the step
 * changes; Play walks through every step and stops at the end.
 */
export function useSteps(steps: Step[]) {
  const [i, setI] = useState(0)
  const [auto, setAuto] = useState(false)
  // Bumped to replay the current step's animation.
  const [run, setRun] = useState(0)
  const t = useTicker(true, steps[i].dur)
  const key = `${i}.${run}`
  const t0 = useRef({ key, at: t })
  if (t0.current.key !== key) t0.current = { key, at: t }
  const local = reducedMotion() ? steps[i].dur : t - t0.current.at
  useEffect(() => {
    if (!auto || local < steps[i].dur + 1.2) return
    if (i < steps.length - 1) setI(i + 1)
    else setAuto(false)
  }, [auto, local, i, steps])
  return {
    i,
    /** Seconds into the current step, capped a little past its length so the end frame holds. */
    t: Math.min(local, steps[i].dur + 0.01),
    step: steps[i],
    go: (n: number) => {
      setI(Math.max(0, Math.min(steps.length - 1, n)))
      setRun((r) => r + 1)
    },
    replay: () => setRun((r) => r + 1),
    auto,
    setAuto,
    count: steps.length,
  }
}
export type Story = ReturnType<typeof useSteps>

/** Prev, the step dots, Next, Play; then the narration for the current step. Left and right arrows step too. */
export function StepBar({ story, steps }: { story: Story; steps: Step[] }) {
  const simple = useSimple()
  const { i, go, auto, setAuto, count, replay } = story
  return (
    <div className="lab-steps">
      <div
        className="lab-step-nav"
        role="group"
        aria-label="Steps"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(i + 1)
          else if (e.key === 'ArrowLeft') go(i - 1)
          else return
          e.preventDefault()
        }}
      >
        <button type="button" className="lab-btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous step">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M10 3 L5 8 L10 13" />
          </svg>
        </button>
        <ol className="lab-dots">
          {steps.map((s, n) => (
            <li key={s.title}>
              <button type="button" aria-current={n === i ? 'step' : undefined} className={n < i ? 'seen' : ''} onClick={() => go(n)} title={s.title}>
                <span className="sr-only">
                  Step {n + 1}: {s.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="lab-btn" onClick={() => go(i + 1)} disabled={i === count - 1} aria-label="Next step">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M6 3 L11 8 L6 13" />
          </svg>
        </button>
        <button type="button" className="lab-btn lab-play" onClick={() => (auto ? setAuto(false) : (i === count - 1 && go(0), setAuto(true)))} aria-pressed={auto}>
          {auto ? 'Pause' : 'Play all'}
        </button>
        <button type="button" className="lab-btn" onClick={replay} aria-label="Replay this step">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3.5 8 A4.5 4.5 0 1 0 5 4.6 M5 1.8 V4.8 H8" />
          </svg>
        </button>
      </div>
      <div className="lab-say" aria-live="polite">
        <h4>
          <span className="lab-step-n num">
            {i + 1}/{count}
          </span>
          {steps[i].title}
        </h4>
        <div className="lab-say-body">{simple ? steps[i].plain : steps[i].tech}</div>
      </div>
    </div>
  )
}

/** A reading from this Mac with a short label; shows n/a for null, never 0. */
export function LiveStat({ label, value, sub, hot }: { label: string; value: string; sub?: ReactNode; hot?: boolean }) {
  return (
    <div className={`lab-live-stat ${hot ? 'hot' : ''}`}>
      <span className="lab-live-label">{label}</span>
      <span className="lab-live-value">
        <Val v={value} />
      </span>
      {sub && <span className="lab-live-sub">{sub}</span>}
    </div>
  )
}

/** The "on your Mac right now" strip. Says when the numbers are simulated. */
export function LiveStrip({ demo, children, note }: { demo: boolean; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="lab-live" aria-label="Live readings">
      <div className="lab-live-head">
        <span className={`lab-live-dot ${demo ? 'demo' : ''}`} aria-hidden />
        {demo ? 'Demo data, not this Mac' : 'Live on this Mac'}
      </div>
      <div className="lab-live-row">{children}</div>
      {note && <p className="fine lab-live-note">{note}</p>}
    </section>
  )
}

export type Source = { title: string; url: string; note: string }

/** Where the lab's facts come from. Every claim a lab makes should trace to one of these. */
export function Sources({ list }: { list: Source[] }) {
  const simple = useSimple()
  return (
    <section className="card lab-sources">
      <h3>{simple ? 'Where the facts come from' : 'Sources'}</h3>
      <ul>
        {list.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
            <span className="fine"> {s.note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A titled prose card for the deeper reading under a lab. */
export function Deeper({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card lab-deeper">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** Everyday words in Simple mode, technical words otherwise. */
export function useWord() {
  const simple = useSimple()
  return (tech: string, plain: string) => (simple ? plain : tech)
}
