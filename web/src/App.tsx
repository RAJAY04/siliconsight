import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStream, type Live, type Mode } from './useStream.ts'
import { Scene, type View } from './Scene.tsx'
import { BatteryPanel, ChipPanel, IoPanel, MemoryPanel, PowerPanel, SensorsPanel } from './panels.tsx'
import { allCoreAvg, clusterAvg, detectStory, recentAvg, socW, usedBytes, type Story } from './story.ts'
import { NA, gpuMhz, memGB, mhz, num, pct, rate, watts } from './format.ts'
import { DieMap } from './DieMap.tsx'
import { Explainer, InfoButton, LearnContext } from './Learn.tsx'
import { CourseHome, LessonView, lessonAt } from './Course.tsx'
import { FOCUS_PART, FOCUS_READING } from './course.ts'
import { Sparkline, Val } from './ui.tsx'
import type { Hardware, Sample } from './types.ts'
import { PLAIN_STORY, SimpleContext, useSimple, useSimpleSetting } from './simple.ts'
import { Splitter, usePane } from './Splitter.tsx'
import { Games } from './Games.tsx'
import { Labs } from './Labs.tsx'
import { labAt } from './labs/index.ts'
import { gameAt } from './games.ts'

/** Where the source lives; the footer links to it. */
const REPO_URL = 'https://github.com/RAJAY04/siliconsight'

const VIEWS: Record<View, { title: string; Panel: (p: { hw: Hardware; s: Sample; history: Sample[]; live: Live; demo: boolean }) => React.ReactNode }> = {
  chip: { title: 'Chip', Panel: ChipPanel },
  memory: { title: 'Unified memory', Panel: MemoryPanel },
  battery: { title: 'Battery', Panel: BatteryPanel },
  io: { title: 'Storage and network', Panel: IoPanel },
  power: { title: 'Power', Panel: PowerPanel },
  sensors: { title: 'Sensors', Panel: SensorsPanel },
  learn: { title: 'Learn how your Mac works', Panel: CourseHome },
  lesson: { title: 'Lesson', Panel: LessonView },
  play: { title: 'Sensor games', Panel: Games },
  labs: { title: 'Labs', Panel: Labs },
}
/** Views that take the whole frame instead of docking beside the scene. */
const fullFrame = (v: View | null) => v === 'learn' || v === 'play' || v === 'labs'
const isView = (h: string): h is View => h in VIEWS
const hashView = () => {
  const h = location.hash.slice(1)
  // A lesson is #learn/NN; a bare #lesson is not a route.
  if (lessonAt(h)) return 'lesson'
  if (labAt(h)) return 'labs'
  if (gameAt(h)) return 'play'
  return isView(h) && h !== 'lesson' ? h : null
}

function Status({ mode }: { mode: Mode }) {
  const label = { connecting: 'Connecting', live: 'Live', demo: 'Demo data', reconnecting: 'Reconnecting', mismatch: 'Version mismatch' }[mode]
  return (
    <span className={`status status-${mode}`} role="status">
      <span className="dot" />
      {label}
    </span>
  )
}

function StoryCard({ story, hidden }: { story: Story; hidden: boolean }) {
  const simple = useSimple()
  const f = story.formula
  const { title, text } = simple ? PLAIN_STORY[story.kind] : story
  return (
    <section className={`story story-${story.kind}`} hidden={hidden}>
      {/* Titles are fixed per kind, so this announces when the story changes, not on every sample. */}
      <span className="sr-only" aria-live="polite">
        {title}
      </span>
      <div className="row-head">
        <span className="story-kicker">What's happening</span>
        <InfoButton topic="story" />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {story.note && <p className="story-note">{story.note}</p>}
      {story.inUse && <p className={`story-inuse ${story.inUse.includes('camera') ? 'cam' : 'mic'}`}>{story.inUse}</p>}
      {f && (
        <div className="formula">
          <InfoButton topic="llm-bandwidth" className="formula-info" />
          {f.peakGBs != null && f.maxTokS != null ? (
            <>
              <span className="num">{num(f.peakGBs)} GB/s</span>
              <span className="op">÷</span>
              <span className="num">{num(f.modelGB, 1)} GB</span>
              <span className="op">≈</span>
              <span className="num strong">{num(f.maxTokS)} tok/s</span>
              <span className="observed">{simple ? 'Highway Speed ÷ model size: the most words a second it could manage. Real speed is lower.' : "Ceiling from the chip's peak memory bandwidth; real speed is lower."}</span>
            </>
          ) : (
            <span>
              Ceiling ≈ {simple ? 'Highway Speed' : 'peak memory bandwidth'} ÷ <span className="num">{num(f.modelGB, 1)} GB</span>. Real speed is lower.
            </span>
          )}
          {f.observedTokS != null && (
            <span className="observed">
              Measured: <span className="num">{num(f.observedTokS)} tok/s</span>
            </span>
          )}
        </div>
      )}
    </section>
  )
}

type Pt = { x: number; y: number }

/** The SoC drawn large and live. Clicking it opens the chip panel. */
function ChipInset({ hw, s, hidden, open }: { hw: Hardware; s: Sample; hidden: boolean; open: (v: View, el: Element) => void }) {
  const w = socW(s)
  const simple = useSimple()
  return (
    // A div with a stretched button, so the info button can sit inside without nesting buttons.
    <div className="inset" hidden={hidden}>
      <button className="inset-open" onClick={(e) => open('chip', e.currentTarget)} aria-label={`${hw.chip}, magnified. ${watts(w)}. Open chip details.`} />
      <span className="inset-head">
        <span className="row-head">
          <span className="story-kicker">Magnified</span>
          <InfoButton topic="soc" />
        </span>
        <span className="inset-title">
          {hw.chip}
          <span className="num">{watts(w)}</span>
        </span>
      </span>
      <DieMap hw={hw} s={s} paused={hidden} />
      <span className="inset-foot num">
        {simple
          ? `Busy: Fast ${pct(clusterAvg(s, 'P'))} · Eco ${pct(clusterAvg(s, 'E'))}`
          : `P ${mhz(s.cpu.pFreqMHz)} · E ${mhz(s.cpu.eFreqMHz)} · GPU ${gpuMhz(s.gpu.freqMHz)}`}
      </span>
    </div>
  )
}

/** A thin line from the inset to the real SoC on the board, with a ring around the SoC. */
function Loupe({ wrap, hidden }: { wrap: React.RefObject<HTMLDivElement | null>; hidden: boolean }) {
  const [line, setLine] = useState<{ a: Pt; b: Pt } | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el || hidden) return
    let raf = 0
    // The SoC only moves when the frame resizes or the camera moves.
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const inset = el.querySelector('.inset')
        const soc = el.querySelector('[data-anchor="soc"]')
        if (!inset || !soc) return
        const o = el.getBoundingClientRect()
        const r = inset.getBoundingClientRect()
        const c = soc.getBoundingClientRect()
        const b = { x: c.left - o.left, y: c.top - o.top }
        // Leave the inset from the edge that faces the chip: its right side when beside it, its top when below.
        const a = r.right <= c.left ? { x: r.right - o.left, y: r.top + r.height / 2 - o.top } : { x: r.left + r.width / 2 - o.left, y: r.top - o.top }
        setLine({ a, b })
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('transitionend', measure)
    // The scene sends this on every frame it turns, zooms or pulls apart.
    el.addEventListener('scenemove', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('transitionend', measure)
      el.removeEventListener('scenemove', measure)
    }
  }, [wrap, hidden])
  if (hidden || !line) return null
  const { a, b } = line
  return (
    <svg className="loupe" aria-hidden>
      <path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} className="loupe-line" />
      <circle cx={b.x} cy={b.y} r="26" className="loupe-ring" />
    </svg>
  )
}

const PLAIN_PRESSURE = { normal: 'plenty left', warn: 'getting full', critical: 'full' }

function Rail({ hw, s, history, open, hot }: { hw: Hardware; s: Sample; history: Sample[]; open: (v: View) => void; hot: string | null }) {
  // Pad to a fixed 2-minute window so a fresh connection fills in from the right instead of stretching a few points.
  const h: (Sample | null)[] = [...Array<null>(Math.max(0, 120 - history.length)).fill(null), ...history.slice(-120)]
  const m = s.memory
  const simple = useSimple()
  const items: { v: View; topic: string; label: string; value: string; sub: string; spark: (number | null)[]; max?: number; why?: string }[] = [
    {
      v: 'chip',
      topic: 'cpu-usage',
      label: simple ? 'Workers' : 'CPU',
      value: pct(allCoreAvg(s)),
      sub: simple ? `Fast ${pct(clusterAvg(s, 'P'))} · Eco ${pct(clusterAvg(s, 'E'))}` : `P ${pct(clusterAvg(s, 'P'))} · E ${pct(clusterAvg(s, 'E'))}`,
      spark: h.map((x) => (x ? allCoreAvg(x) : null)),
      max: 1,
    },
    { v: 'chip', topic: 'gpu', label: simple ? 'Graphics' : 'GPU', value: pct(s.gpu.usage), sub: hw.gpuCores == null ? (simple ? '' : 'core count not reported') : `${hw.gpuCores} ${simple ? 'graphics workers' : 'cores'}`, spark: h.map((x) => (x ? x.gpu.usage : null)), max: 1, why: 'GPU usage was not reported.' },
    { v: 'memory', topic: 'memory-kinds', label: simple ? 'Desk Space' : 'Memory', value: memGB(usedBytes(s)), sub: `of ${memGB(m.totalBytes, 0)} · ${simple ? PLAIN_PRESSURE[m.pressure] : m.pressure}`, spark: h.map((x) => (x ? usedBytes(x) : null)), max: m.totalBytes },
    { v: 'power', topic: 'power', label: simple ? 'Energy use' : 'Chip power', value: watts(socW(s)), sub: s.power.systemW == null ? (simple ? 'the chip alone' : 'CPU + GPU + ANE') : `${simple ? 'whole Mac' : 'system'} ${watts(recentAvg(history, (x) => x.power.systemW))}`, spark: h.map((x) => (x ? socW(x) : null)), why: 'Power counters were not readable.' },
    { v: 'io', topic: 'ssd', label: simple ? 'Storage' : 'SSD', value: rate(s.disk.readBps + s.disk.writeBps), sub: `${simple ? 'opening' : 'read'} ${rate(s.disk.readBps)}`, spark: h.map((x) => (x ? x.disk.readBps + x.disk.writeBps : null)) },
    { v: 'io', topic: 'network-rates', label: simple ? 'Internet' : 'Network', value: rate(s.net.rxBps + s.net.txBps), sub: `${simple ? 'downloading' : 'down'} ${rate(s.net.rxBps)}`, spark: h.map((x) => (x ? x.net.rxBps + x.net.txBps : null)) },
  ]
  if (s.battery) {
    const b = s.battery
    items.push({ v: 'battery', topic: 'battery', label: 'Battery', value: `${Math.round(b.percent)}%`, sub: b.chargeHeld ? (simple ? 'plugged in, resting' : 'held on AC') : b.charging ? 'charging' : b.acAttached ? (simple ? 'plugged in' : 'on AC') : 'on battery', spark: h.map((x) => (x ? x.battery?.percent ?? null : null)), max: 100 })
  }
  return (
    <aside className="rail" aria-label="Live readings">
      {items.map((it) => (
        <div key={it.label} className="metric-wrap">
        <button className={`metric ${it.topic === hot ? 'metric-hot' : ''}`} onClick={() => open(it.v)} aria-label={`${it.label} ${it.value === NA ? `not available. ${it.why ?? ''}` : it.value}. Open details.`}>
          <span className="metric-label">{it.label}</span>
          <span className="metric-value">
            <Val v={it.value} why={it.why} />
          </span>
          <span className="metric-sub">{it.sub}</span>
          <span className="metric-spark">
            <Sparkline values={it.spark} max={it.max} w={120} h={28} />
          </span>
        </button>
        <InfoButton topic={it.topic} className="metric-info" />
        </div>
      ))}
    </aside>
  )
}

export default function App() {
  const { hw, mode, history, latest, live } = useStream()
  const [simple, toggleSimple] = useSimpleSetting()
  const [view, setView] = useState<View | null>(hashView)
  // Moving between lessons keeps the view, so the hash itself is state too.
  const [route, setRoute] = useState(location.hash)
  const [origin, setOrigin] = useState('50% 50%')
  // Both side columns can be dragged wider or narrower, or folded away so the scene takes the width.
  const left = usePane('macviz.left', 280, 220, 440)
  const right = usePane('macviz.rail', 220, 180, 360)
  const main = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  // The open explainer, and the button that opened it; related links swap the topic but keep the opener.
  const [topic, setTopic] = useState<string | null>(null)
  const learnFrom = useRef<HTMLElement | null>(null)
  const learnHash = useRef('')
  const learn = useCallback((id: string, from: HTMLElement) => {
    learnFrom.current = from
    learnHash.current = location.hash
    setTopic(id)
  }, [])
  const closeLearn = useCallback(() => {
    setTopic(null)
    const el = learnFrom.current
    // A lesson link in the explainer moves on to that lesson, whose heading takes focus instead.
    requestAnimationFrame(() => location.hash === learnHash.current && el?.focus())
  }, [])

  // Return keyboard focus to whatever opened the panel, whether it closed by Back, Esc or the browser's back button.
  const refocus = () => requestAnimationFrame(() => opener.current?.focus())
  useEffect(() => {
    const on = () => {
      const v = hashView()
      setView(v)
      setRoute(location.hash)
      if (!v) refocus()
    }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const close = useCallback(() => {
    if (location.hash) location.hash = ''
    // Drop the bare '#' left behind so the URL stays clean.
    if (location.href.endsWith('#')) window.history.replaceState(null, '', location.pathname + location.search)
    setView(null)
    refocus()
  }, [])
  // While an explainer is open, Esc belongs to it.
  useEffect(() => {
    if (!view || topic) return
    // A lesson steps back to the course; everything else back to the overview.
    const on = (e: KeyboardEvent) => e.key === 'Escape' && (view === 'lesson' ? (location.hash = 'learn') : labAt(location.hash) ? (location.hash = 'labs') : gameAt(location.hash) ? (location.hash = 'play') : close())
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [close, view, topic])

  const open = useCallback((v: View, el?: Element) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const box = (el?.closest('.stage') ?? main.current)?.getBoundingClientRect()
    if (el && box) {
      const r = el.getBoundingClientRect()
      setOrigin(`${r.left + r.width / 2 - box.left}px ${r.top + r.height / 2 - box.top}px`)
    }
    location.hash = v
  }, [])

  // Focus the panel heading on open so keyboard and screen reader users land in it.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!view) return
    // On phones the panel is a drawer over the lower half; bring the close-up above it into view.
    const drawer = !fullFrame(view) && matchMedia('(max-width: 820px)').matches
    heading.current?.focus({ preventScroll: drawer })
    if (drawer) main.current?.scrollIntoView({ block: 'start' })
  }, [view, route])

  if (mode === 'mismatch') {
    return (
      <div className="boot">
        <Status mode={mode} />
        <p className="boot-note">The reader speaks a different protocol version than this page. Update the app (pull and run ./run.sh again), then reload.</p>
      </div>
    )
  }
  if (!hw || !latest) {
    return (
      <div className="boot">
        <Status mode={mode} />
      </div>
    )
  }
  const story = detectStory(history, hw.chip)
  const Panel = view ? VIEWS[view].Panel : null
  // Part panels dock beside the live scene (a drawer on phones); the Learn index and the games take the whole frame.
  const docked = view && !fullFrame(view) ? view : null
  const lesson = view === 'lesson' ? lessonAt(route) : null
  const lab = view === 'labs' ? labAt(route) : null
  const game = view === 'play' ? gameAt(route) : null
  // A lesson, a lab or a game steps back to its index; everything else back to the overview.
  const up = lesson ? 'learn' : lab ? 'labs' : game ? 'play' : null

  return (
    <LearnContext.Provider value={learn}>
    <SimpleContext.Provider value={simple}>
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden />
          <span className="name">SiliconSight</span>
        </div>
        <div className="machine">
          <span>{hw.chip}</span>
          <span className="sep" />
          <span className="num">{memGB(hw.memBytes, 0)}</span>
          <span className="sep" />
          <span>{simple ? `${hw.pCores} Fast + ${hw.eCores} Eco Workers` : `${hw.pCores}P + ${hw.eCores}E`}</span>
          <span className="sep" />
          <span>macOS {hw.macosVersion}</span>
          <span className="sep" />
          <span className="muted">{hw.model}</span>
        </div>
        <button className="simple-toggle" role="switch" aria-checked={simple} onClick={toggleSimple} title="Swap tech terms for everyday words">
          <span className="switch" aria-hidden />
          Simple
        </button>
        <a
          className="learn-link"
          href="#learn"
          aria-current={view === 'learn' || view === 'lesson' ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            open('learn', e.currentTarget)
          }}
        >
          Learn
        </a>
        <a
          className="learn-link"
          href="#labs"
          aria-current={view === 'labs' ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            open('labs', e.currentTarget)
          }}
        >
          Labs
        </a>
        <a
          className="learn-link"
          href="#play"
          aria-current={view === 'play' ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            open('play', e.currentTarget)
          }}
        >
          Play
        </a>
        <Status mode={mode} />
      </header>

      {mode === 'demo' && (
        <div className="demo-hint">
          {new URLSearchParams(location.search).has('demo') ? (
            <>
              Demo data (forced with <code>?demo</code>). Remove <code>?demo</code> to see this Mac.
            </>
          ) : (
            <>
              Showing demo data. Run <code>./run.sh</code> in the repo to see this Mac live.
            </>
          )}
        </div>
      )}

      <main
        className={`main ${view ? 'zoomed' : ''} ${docked ? 'docked' : ''} ${left.pane.collapsed ? 'left-folded' : ''} ${right.pane.collapsed ? 'rail-folded' : ''}`}
        style={{ '--left-w': `${left.pane.collapsed ? 0 : left.pane.w}px`, '--rail-w': `${right.pane.collapsed ? 0 : right.pane.w}px` } as CSSProperties}
      >
        <div className="stage-wrap" ref={main} style={{ '--origin': origin } as CSSProperties}>
          <Splitter edge="left" label="story and chip column" ctl={left} />
          {/* Kept mounted while a panel is open so the columns, and the zoom origin, do not move. */}
          <StoryCard story={story} hidden={!!view} />
          <ChipInset hw={hw} s={latest} hidden={!!view} open={open} />
          <div className="scene-area">
            <Scene hw={hw} s={latest} live={live} systemW={recentAvg(history, (x) => x.power.systemW)} llm={story.kind === 'llm'} onOpen={open} panel={docked} part={lesson ? FOCUS_PART[lesson.focus] : undefined} hidden={fullFrame(view)} />
          </div>
          <Loupe wrap={main} hidden={!!view} />
          {!hw.hasBattery && !view && <p className="layout-note">Drawn as a MacBook Air; this Mac's real layout isn't drawn yet.</p>}
          {/* The LLM note takes the bottom edge while it shows. */}
          {!view && story.kind !== 'llm' && <p className="hint">Drag to turn it. Click a part to fly in.</p>}
          {Panel && view && (
            <section className="detail" aria-labelledby="detail-title">
              <div className="detail-head">
                <button className="back" onClick={up ? () => (location.hash = up) : close} aria-label={lesson ? 'Back to the course (Esc)' : lab ? 'Back to the labs (Esc)' : game ? 'Back to the games (Esc)' : docked ? 'Close details (Esc)' : 'Back to the overview (Esc)'}>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                    <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  </svg>
                  {lesson ? 'Course' : lab ? 'Labs' : game ? 'Games' : docked ? 'Close' : 'Back'}
                  <kbd>Esc</kbd>
                </button>
                <h1 id="detail-title" ref={heading} tabIndex={-1}>
                  {lesson ? lesson.title : lab ? (simple ? lab.plain : lab.title) : game ? game.name : simple && view === 'memory' ? 'Desk Space' : VIEWS[view].title}
                </h1>
              </div>
              <Panel hw={hw} s={latest} history={history} live={live} demo={mode === 'demo'} />
            </section>
          )}
        </div>
        <Splitter edge="right" label="readings column" ctl={right} />
        <Rail hw={hw} s={latest} history={history} open={(v) => open(v)} hot={lesson ? FOCUS_READING[lesson.focus] : null} />
      </main>

      <footer className="foot">
        <span>Not affiliated with Apple. Mac and macOS are trademarks of Apple Inc.</span>
        {REPO_URL && (
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        )}
      </footer>
      {topic && <Explainer id={topic} hw={hw} s={latest} history={history} onTopic={setTopic} onClose={closeLearn} />}
    </div>
    </SimpleContext.Provider>
    </LearnContext.Provider>
  )
}
