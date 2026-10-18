import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStream, type Mode } from './useStream.ts'
import { Scene, type View } from './Scene.tsx'
import { BatteryPanel, ChipPanel, IoPanel, MemoryPanel, PowerPanel } from './panels.tsx'
import { allCoreAvg, clusterAvg, detectStory, recentAvg, socW, usedBytes, type Story } from './story.ts'
import { NA, gpuMhz, memGB, mhz, num, pct, rate, watts } from './format.ts'
import { DieMap } from './DieMap.tsx'
import { Sparkline, Val } from './ui.tsx'
import type { Hardware, Sample } from './types.ts'

/** Where the source lives. Empty until the repository is public; the footer link is hidden while it is. */
const REPO_URL = ''

const VIEWS: Record<View, { title: string; Panel: typeof ChipPanel }> = {
  chip: { title: 'Chip', Panel: ChipPanel },
  memory: { title: 'Unified memory', Panel: MemoryPanel },
  battery: { title: 'Battery', Panel: BatteryPanel },
  io: { title: 'Storage and network', Panel: IoPanel },
  power: { title: 'Power', Panel: PowerPanel },
}
const isView = (h: string): h is View => h in VIEWS
const hashView = () => {
  const h = location.hash.slice(1)
  return isView(h) ? h : null
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
  const f = story.formula
  return (
    <section className={`story story-${story.kind}`} hidden={hidden}>
      {/* Titles are fixed per kind, so this announces when the story changes, not on every sample. */}
      <span className="sr-only" aria-live="polite">
        {story.title}
      </span>
      <div className="story-kicker">What's happening</div>
      <h2>{story.title}</h2>
      <p>{story.text}</p>
      {story.note && <p className="story-note">{story.note}</p>}
      {f && (
        <div className="formula">
          {f.peakGBs != null && f.maxTokS != null ? (
            <>
              <span className="num">{num(f.peakGBs)} GB/s</span>
              <span className="op">÷</span>
              <span className="num">{num(f.modelGB, 1)} GB</span>
              <span className="op">≈</span>
              <span className="num strong">{num(f.maxTokS)} tok/s</span>
              <span className="observed">Ceiling from the chip's peak memory bandwidth; real speed is lower.</span>
            </>
          ) : (
            <span>
              Ceiling ≈ peak memory bandwidth ÷ <span className="num">{num(f.modelGB, 1)} GB</span>. Real speed is lower.
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
  return (
    <button className="inset" hidden={hidden} onClick={(e) => open('chip', e.currentTarget)} aria-label={`${hw.chip}, magnified. ${watts(w)}. Open chip details.`}>
      <span className="inset-head">
        <span className="story-kicker">Magnified</span>
        <span className="inset-title">
          {hw.chip}
          <span className="num">{watts(w)}</span>
        </span>
      </span>
      <DieMap hw={hw} s={s} paused={hidden} />
      <span className="inset-foot num">
        P {mhz(s.cpu.pFreqMHz)} · E {mhz(s.cpu.eFreqMHz)} · GPU {gpuMhz(s.gpu.freqMHz)}
      </span>
    </button>
  )
}

/** A thin line from the inset to the real SoC on the board, with a ring around the SoC. */
function Loupe({ wrap, hidden }: { wrap: React.RefObject<HTMLDivElement | null>; hidden: boolean }) {
  const [line, setLine] = useState<{ a: Pt; b: Pt } | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el || hidden) return
    let raf = 0
    // The SoC only moves when the frame resizes or the layers finish sliding apart.
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
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('transitionend', measure)
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

function Rail({ hw, s, history, open }: { hw: Hardware; s: Sample; history: Sample[]; open: (v: View) => void }) {
  // Pad to a fixed 2-minute window so a fresh connection fills in from the right instead of stretching a few points.
  const h: (Sample | null)[] = [...Array<null>(Math.max(0, 120 - history.length)).fill(null), ...history.slice(-120)]
  const m = s.memory
  const items: { v: View; label: string; value: string; sub: string; spark: (number | null)[]; max?: number; why?: string }[] = [
    {
      v: 'chip',
      label: 'CPU',
      value: pct(allCoreAvg(s)),
      sub: `P ${pct(clusterAvg(s, 'P'))} · E ${pct(clusterAvg(s, 'E'))}`,
      spark: h.map((x) => (x ? allCoreAvg(x) : null)),
      max: 1,
    },
    { v: 'chip', label: 'GPU', value: pct(s.gpu.usage), sub: hw.gpuCores == null ? 'core count not reported' : `${hw.gpuCores} cores`, spark: h.map((x) => (x ? x.gpu.usage : null)), max: 1, why: 'GPU usage was not reported.' },
    { v: 'memory', label: 'Memory', value: memGB(usedBytes(s)), sub: `of ${memGB(m.totalBytes, 0)} · ${m.pressure}`, spark: h.map((x) => (x ? usedBytes(x) : null)), max: m.totalBytes },
    { v: 'power', label: 'Chip power', value: watts(socW(s)), sub: s.power.systemW == null ? 'CPU + GPU + ANE' : `system ${watts(recentAvg(history, (x) => x.power.systemW))}`, spark: h.map((x) => (x ? socW(x) : null)), why: 'Power counters were not readable.' },
    { v: 'io', label: 'SSD', value: rate(s.disk.readBps + s.disk.writeBps), sub: `read ${rate(s.disk.readBps)}`, spark: h.map((x) => (x ? x.disk.readBps + x.disk.writeBps : null)) },
    { v: 'io', label: 'Network', value: rate(s.net.rxBps + s.net.txBps), sub: `down ${rate(s.net.rxBps)}`, spark: h.map((x) => (x ? x.net.rxBps + x.net.txBps : null)) },
  ]
  if (s.battery) {
    const b = s.battery
    items.push({ v: 'battery', label: 'Battery', value: `${Math.round(b.percent)}%`, sub: b.chargeHeld ? 'held on AC' : b.charging ? 'charging' : b.acAttached ? 'on AC' : 'on battery', spark: h.map((x) => (x ? x.battery?.percent ?? null : null)), max: 100 })
  }
  return (
    <aside className="rail" aria-label="Live readings">
      {items.map((it) => (
        <button key={it.label} className="metric" onClick={() => open(it.v)} aria-label={`${it.label} ${it.value === NA ? `not available. ${it.why ?? ''}` : it.value}. Open details.`}>
          <span className="metric-label">{it.label}</span>
          <span className="metric-value">
            <Val v={it.value} why={it.why} />
          </span>
          <span className="metric-sub">{it.sub}</span>
          <span className="metric-spark">
            <Sparkline values={it.spark} max={it.max} w={120} h={28} />
          </span>
        </button>
      ))}
    </aside>
  )
}

export default function App() {
  const { hw, mode, history, latest } = useStream()
  const [view, setView] = useState<View | null>(hashView)
  const [origin, setOrigin] = useState('50% 50%')
  const main = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  // Return keyboard focus to whatever opened the panel, whether it closed by Back, Esc or the browser's back button.
  const refocus = () => requestAnimationFrame(() => opener.current?.focus())
  useEffect(() => {
    const on = () => {
      const v = hashView()
      setView(v)
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
  useEffect(() => {
    if (!view) return
    const on = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [close, view])

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
    if (view) heading.current?.focus()
  }, [view])

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

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden />
          <span className="name">MacOS visualizer</span>
        </div>
        <div className="machine">
          <span>{hw.chip}</span>
          <span className="sep" />
          <span className="num">{memGB(hw.memBytes, 0)}</span>
          <span className="sep" />
          <span>{hw.pCores}P + {hw.eCores}E</span>
          <span className="sep" />
          <span>macOS {hw.macosVersion}</span>
          <span className="sep" />
          <span className="muted">{hw.model}</span>
        </div>
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

      <main className={`main ${view ? 'zoomed' : ''}`}>
        <div className="stage-wrap" ref={main} style={{ '--origin': origin } as CSSProperties}>
          {/* Kept mounted while a panel is open so the columns, and the zoom origin, do not move. */}
          <StoryCard story={story} hidden={!!view} />
          <ChipInset hw={hw} s={latest} hidden={!!view} open={open} />
          <div className="scene-area">
            <Scene hw={hw} s={latest} systemW={recentAvg(history, (x) => x.power.systemW)} llm={story.kind === 'llm'} onOpen={open} hidden={!!view} />
          </div>
          <Loupe wrap={main} hidden={!!view} />
          {!hw.hasBattery && !view && <p className="layout-note">Drawn as a MacBook Air; this Mac's real layout isn't drawn yet.</p>}
          {/* The LLM note takes the bottom edge while it shows. */}
          {!view && story.kind !== 'llm' && <p className="hint">Click a part to look inside.</p>}
          {Panel && view && (
            <section className="detail" aria-labelledby="detail-title">
              <div className="detail-head">
                <button className="back" onClick={close} aria-label="Back to the overview (Esc)">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                    <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  </svg>
                  Back
                  <kbd>Esc</kbd>
                </button>
                <h1 id="detail-title" ref={heading} tabIndex={-1}>
                  {VIEWS[view].title}
                </h1>
              </div>
              <Panel hw={hw} s={latest} history={history} />
            </section>
          )}
        </div>
        <Rail hw={hw} s={latest} history={history} open={(v) => open(v)} />
      </main>

      <footer className="foot">
        <span>Not affiliated with Apple. Mac and macOS are trademarks of Apple Inc.</span>
        {REPO_URL && (
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        )}
      </footer>
    </div>
  )
}
