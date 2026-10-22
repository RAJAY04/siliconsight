import { useEffect, useReducer, useRef, useState } from 'react'
import { Sources, type LabProps, type Source } from '../labs/kit.tsx'
import { Unavailable, readBest, saveBest } from './kit.tsx'
import { InfoButton } from '../Learn.tsx'
import { useSimple } from '../simple.ts'
import type { WiFi } from '../types.ts'
import { HUNT_S, LOSS, PLAN, fractionOfMilliwatt, heat, powerRatio, quality, simLink, trend, type Material, type P, type Wall } from './wifi.ts'
import './play.css'
import './WifiHunt.css'

// Wi-Fi Hot and Cold: carry the Mac around and find the strongest signal. The reader sends the link's RSSI once a
// second from CoreWLAN; ?demo walks a laptop around a simulated flat instead.

const BEST = 'macviz.best.wifi'
const SPOT = 'macviz.wifi.spot'
type Phase = 'idle' | 'hunt' | 'done'
type Reading = { t: number; dbm: number }
type Mark = { t: number; dbm: number; name: string }

const SOURCES: Source[] = [
  { title: 'Apple: Resolve Wi-Fi and Bluetooth issues caused by wireless interference', url: 'https://support.apple.com/102319', note: 'Microwave ovens and cordless phones interfere; wood and glass block little, brick and water more, concrete and plaster a lot, metal most.' },
  { title: 'Apple: Wi-Fi roaming support in Apple devices', url: 'https://support.apple.com/102002', note: 'A Mac holds its access point until the signal falls past -75 dBm, then moves to one at least 12 dB stronger.' },
  { title: 'Wikipedia: dBm', url: 'https://en.wikipedia.org/wiki/DBm', note: 'Power level in decibels relative to one milliwatt, on a logarithmic scale.' },
  { title: 'Wikipedia: Log-distance path loss model', url: 'https://en.wikipedia.org/wiki/Log-distance_path_loss_model', note: 'Signal falls by a fixed number of dB per tenfold distance; the simulated flat uses it.' },
  { title: 'Wikipedia: Microwave oven', url: 'https://en.wikipedia.org/wiki/Microwave_oven', note: 'Home ovens heat at 2.45 GHz, inside the 2.4 GHz Wi-Fi band.' },
  { title: 'Apple: Wi-Fi specification details for Apple devices', url: 'https://support.apple.com/guide/deployment/dep268652e6c', note: 'Link rates, channel widths and streams for each Mac.' },
]

type Spot = { dbm: number; name: string }
function readSpot(): Spot | null {
  try {
    const v = JSON.parse(localStorage.getItem(SPOT) ?? 'null')
    return v && typeof v.dbm === 'number' && typeof v.name === 'string' ? v : null
  } catch {
    return null
  }
}
function saveSpot(s: Spot) {
  try {
    localStorage.setItem(SPOT, JSON.stringify(s))
  } catch {
    // Not saved; it still shows for this visit.
  }
}

export default function WifiHunt({ s, demo }: LabProps) {
  const simple = useSimple()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const [pos, setPos] = useState<P>({ x: 6, y: 7.3 })
  const [band, setBand] = useState<2.4 | 5>(2.4)
  const [microwave, setMicrowave] = useState(false)
  const [name, setName] = useState('')
  const g = useRef({
    phase: 'idle' as Phase,
    t0: 0,
    trail: [] as Reading[],
    marks: [] as Mark[],
    start: 0,
    peak: -200,
    best: readBest(BEST),
    spot: readSpot(),
    newBest: false,
    say: '',
  }).current

  const sim = simLink(pos, band, microwave)
  const wifi: WiFi | null | undefined = demo ? { rssiDbm: sim.rssi, noiseDbm: sim.noise, txRateMbps: null, channel: band === 5 ? 36 : 6, bandGHz: band, widthMHz: band === 5 ? 80 : 20 } : s.wifi
  const now = wifi?.rssiDbm ?? null

  const finish = () => {
    g.phase = 'done'
    const gain = Math.max(0, g.peak - g.start)
    g.newBest = gain > (g.best ?? 0)
    if (g.newBest) {
      g.best = gain
      saveBest(BEST, gain)
    }
    g.say = `Hunt over. You started at ${g.start} and found ${g.peak} dBm, ${gain} dB better.`
    render()
  }
  const take = (dbm: number) => {
    const t = (Date.now() - g.t0) / 1000
    if (t >= HUNT_S) return finish()
    const before = g.trail.slice(-3).map((r) => r.dbm)
    g.trail.push({ t, dbm })
    if (dbm > g.peak) g.peak = dbm
    const tr = trend(before, dbm)
    if (tr !== 'same') g.say = `${tr === 'warmer' ? 'Warmer' : 'Colder'}: ${dbm} dBm.`
    if (!g.spot || dbm > g.spot.dbm) {
      g.spot = { dbm, name: '' }
      saveSpot(g.spot)
    }
    render()
  }

  // One reading a second while hunting: the reader's sample, or the simulated laptop where it stands now.
  const latest = useRef(now)
  latest.current = now
  useEffect(() => {
    if (g.phase !== 'hunt' || demo || now == null) return
    take(now)
  }, [s.t]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (g.phase !== 'hunt' || !demo) return
    const id = setInterval(() => latest.current != null && take(latest.current), 1000)
    return () => clearInterval(id)
  }, [g.phase, demo]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo && s.wifi === undefined) return <Unavailable title="Wi-Fi signal not available">This reader is older than the Wi-Fi update, so it sends no signal readings. Pull the repo and run ./run.sh again to update it.</Unavailable>
  if (!demo && s.wifi === null)
    return (
      <Unavailable title="Wi-Fi is off or not connected">
        The reader found no joined Wi-Fi network. Turn Wi-Fi on and join a network, then come back. A Mac on Ethernet only has no radio signal to hunt.
      </Unavailable>
    )

  const start = () => {
    if (now == null) return
    Object.assign(g, { phase: 'hunt', t0: Date.now(), trail: [{ t: 0, dbm: now }], marks: [], start: now, peak: now, newBest: false })
    g.say = `Hunt on. Starting signal ${now} dBm. ${HUNT_S} seconds.`
    render()
  }
  const mark = () => {
    if (now == null) return
    const label = name.trim() || `Spot ${g.marks.length + 1}`
    g.marks.push({ t: g.phase === 'hunt' ? (Date.now() - g.t0) / 1000 : 0, dbm: now, name: label })
    if (g.spot && now >= g.spot.dbm) {
      g.spot = { dbm: now, name: label }
      saveSpot(g.spot)
    }
    setName('')
    g.say = `Marked ${label} at ${now} dBm.`
    render()
  }

  const q = now == null ? null : quality(now)
  const before = g.trail.slice(-4, -1).map((r) => r.dbm)
  const tr = g.phase === 'hunt' && now != null ? trend(before, now) : 'same'
  const left = g.phase === 'hunt' ? Math.max(0, HUNT_S - (Date.now() - g.t0) / 1000) : HUNT_S
  const snr = now != null && wifi?.noiseDbm != null ? now - wifi.noiseDbm : null
  const gain = Math.max(0, g.peak - g.start)
  const hint = tr === 'warmer' ? (simple ? 'Warmer!' : 'Warmer') : tr === 'colder' ? (simple ? 'Colder' : 'Colder') : g.phase === 'hunt' ? (simple ? 'Keep moving' : 'Holding steady') : ''

  return (
    <section className={`card wifi-game phase-${g.phase} trend-${tr}`} aria-labelledby="wifi-title">
      <p className="sr-only" aria-live="polite">
        {g.say}
      </p>
      <div className="game-head">
        <h3 id="wifi-title">Wi-Fi Hot and Cold</h3>
        {demo && <span className="sim-badge">Simulated flat: drag the laptop</span>}
        <span className="game-score">
          <span className="num">{g.phase === 'idle' ? 0 : `+${gain}`}</span> dB
          <span className="game-best">best +{g.best ?? 0} dB</span>
        </span>
      </div>

      <div className="wifi-top">
        <Gauge dbm={now} best={g.phase === 'idle' ? null : g.peak} />
        <div className="wifi-now">
          <span className={`wifi-dbm num tone-${q?.tone ?? ''}`}>{now == null ? 'n/a' : now}</span>
          <span className="wifi-unit">dBm</span>
          <span className={`wifi-q tone-${q?.tone ?? ''}`}>{q ? (simple ? q.plain : q.label) : ''}</span>
          <span className="wifi-trend" aria-hidden>
            {hint}
          </span>
        </div>
        <dl className="wifi-facts">
          <div>
            <dt>{simple ? 'Background hiss' : 'Noise'}</dt>
            <dd className="num">{wifi?.noiseDbm == null ? 'n/a' : `${wifi.noiseDbm} dBm`}</dd>
          </div>
          <div>
            <dt>{simple ? 'Signal above hiss' : 'SNR'}</dt>
            <dd className="num">{snr == null ? 'n/a' : `${snr} dB`}</dd>
          </div>
          <div>
            <dt>{simple ? 'Link speed' : 'TX rate'}</dt>
            <dd className="num">{wifi?.txRateMbps == null ? (demo ? 'not simulated' : 'n/a') : `${Math.round(wifi.txRateMbps)} Mbps`}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd className="num">{wifi?.channel == null ? 'n/a' : `${wifi.channel}${wifi.bandGHz ? `, ${wifi.bandGHz} GHz` : ''}${wifi.widthMHz ? `, ${wifi.widthMHz} MHz` : ''}`}</dd>
          </div>
        </dl>
      </div>

      {demo && <Flat pos={pos} setPos={setPos} band={band} setBand={setBand} microwave={microwave} setMicrowave={setMicrowave} hit={sim.walls} />}

      {g.phase !== 'idle' && <Timeline trail={g.trail} marks={g.marks} start={g.start} />}
      {g.phase === 'hunt' && (
        <div className="lid-timer" aria-hidden>
          <span style={{ width: `${(left / HUNT_S) * 100}%` }} />
        </div>
      )}

      <p className="game-goal">
        {g.phase === 'idle' &&
          (demo
            ? `${HUNT_S} seconds. Drag the laptop around the flat, or focus it and use the arrow keys, to find the strongest signal. Your score is how many dB you gain over where you started.`
            : `${HUNT_S} seconds. Pick up the Mac and walk around: rooms, corners, near the router, behind the fridge. The page updates once a second. Your score is how many dB you gain over where you started.`)}
        {g.phase === 'hunt' && (
          <>
            {simple ? 'Started at ' : 'Start '}
            <span className="num">{g.start} dBm</span>, {simple ? 'best so far ' : 'best '}
            <span className="num strong">{g.peak} dBm</span> · <span className="num">{Math.ceil(left)}</span> s
          </>
        )}
        {g.phase === 'done' && (
          <>
            {g.newBest ? 'New best: ' : ''}from <span className="num">{g.start}</span> to <span className="num strong">{g.peak} dBm</span>, <span className="num strong">+{gain} dB</span>
            {gain > 0 && <>, {simple ? 'about ' : ''}<span className="num">{formatRatio(powerRatio(g.peak, g.start))}</span> times the signal power</>}.
          </>
        )}
      </p>

      {g.phase === 'hunt' && (
        <form
          className="wifi-mark"
          onSubmit={(e) => {
            e.preventDefault()
            mark()
          }}
        >
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder={simple ? 'Name this spot, like Kitchen' : 'Spot name, like Kitchen'} aria-label="Spot name" maxLength={24} />
          <button type="submit" className="lab-btn">
            Mark this spot
          </button>
        </form>
      )}
      {g.marks.length > 0 && (
        <ul className="wifi-marks">
          {[...g.marks]
            .sort((a, b) => b.dbm - a.dbm)
            .map((m, i) => (
              <li key={`${m.t}-${i}`}>
                <span>{m.name}</span>
                <b className={`num tone-${quality(m.dbm).tone}`}>{m.dbm} dBm</b>
              </li>
            ))}
        </ul>
      )}
      {g.spot && (
        <p className="fine wifi-record">
          {simple ? 'Strongest spot this browser has seen' : 'Best spot on record in this browser'}: <span className="num">{g.spot.dbm} dBm</span>
          {g.spot.name ? `, ${g.spot.name}` : ''}.
        </p>
      )}

      <div className="game-actions">
        {g.phase !== 'hunt' && (
          <button type="button" className="game-go" onClick={start} disabled={now == null}>
            {g.phase === 'done' ? 'Hunt again' : 'Start the hunt'}
          </button>
        )}
        {g.phase === 'hunt' && (
          <button type="button" className="lab-btn" onClick={finish}>
            Finish now
          </button>
        )}
      </div>

      {g.phase === 'done' ? (
        <>
          <Lesson start={g.start} peak={g.peak} noise={wifi?.noiseDbm ?? null} demo={demo} />
          <Sources list={SOURCES} />
        </>
      ) : (
        <p className="fine game-how">
          {simple ? 'The Mac measures how loud the router sounds to its antennas.' : 'Signal and noise come from CoreWLAN once a second, with no location permission. The network name is never read.'}
          <InfoButton topic="wifi" />
        </p>
      )}
    </section>
  )
}

const formatRatio = (r: number) => (r >= 100 ? Math.round(r).toLocaleString('en-US') : r >= 10 ? r.toFixed(0) : r.toFixed(1))

/** A half dial from -90 to -30 dBm, cold to hot, with the needle at the reading and a tick at the best so far. */
function Gauge({ dbm, best }: { dbm: number | null; best: number | null }) {
  const C = { x: 150, y: 150 }
  const R = 120
  const at = (k: number, r: number) => {
    const a = Math.PI * (1 - k)
    return { x: C.x + r * Math.cos(a), y: C.y - r * Math.sin(a) }
  }
  const segs = 24
  const needle = dbm == null ? null : heat(dbm)
  const tip = needle == null ? null : at(needle, R - 14)
  return (
    <svg className="wifi-gauge" viewBox="0 0 300 172" role="img" aria-label={dbm == null ? 'No signal reading.' : `Signal ${dbm} dBm on a scale from minus 90, cold, to minus 30, hot.`}>
      {Array.from({ length: segs }, (_, i) => {
        const a = at(i / segs + 0.004, R)
        const b = at((i + 1) / segs - 0.004, R)
        return <path key={i} d={`M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`} className="wifi-seg" style={{ '--k': (i / (segs - 1)).toFixed(3) } as React.CSSProperties} />
      })}
      {[-90, -75, -60, -45, -30].map((d) => {
        const p = at(heat(d), R + 18)
        return (
          <text key={d} x={p.x} y={p.y + 4} className="wifi-tick">
            {d}
          </text>
        )
      })}
      {best != null && (() => {
        const a = at(heat(best), R - 12)
        const b = at(heat(best), R + 10)
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wifi-best" />
      })()}
      {tip && (
        <g className="wifi-needle" style={{ transform: `rotate(${(needle! * 180 - 90).toFixed(1)}deg)`, transformOrigin: `${C.x}px ${C.y}px` }}>
          <line x1={C.x} y1={C.y} x2={C.x} y2={C.y - R + 14} />
        </g>
      )}
      <circle cx={C.x} cy={C.y} r={8} className="wifi-hub" />
      <text x={C.x - R} y={C.y + 20} className="wifi-end">
        cold
      </text>
      <text x={C.x + R} y={C.y + 20} className="wifi-end">
        hot
      </text>
    </svg>
  )
}

/** The hunt so far: one dot a second, coloured by quality, with a dashed line at the start and the marked spots. */
function Timeline({ trail, marks, start }: { trail: Reading[]; marks: Mark[]; start: number }) {
  const W = 960
  const H = 170
  const L = 50
  const T = 14
  const B = 26
  const x = (t: number) => L + (Math.min(HUNT_S, t) / HUNT_S) * (W - L - 12)
  const y = (d: number) => T + (1 - (Math.min(-25, Math.max(-95, d)) + 95) / 70) * (H - T - B)
  const path = trail.map((r, i) => `${i ? 'L' : 'M'} ${x(r.t).toFixed(1)} ${y(r.dbm).toFixed(1)}`).join(' ')
  return (
    <svg className="wifi-timeline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Signal over the hunt: ${trail.length} readings, from ${trail[0]?.dbm} to ${trail.at(-1)?.dbm} dBm.`}>
      {[
        [-50, -25, 'ok'],
        [-60, -50, 'accent'],
        [-75, -60, 'warn'],
        [-95, -75, 'crit'],
      ].map(([lo, hi, tone]) => (
        <rect key={tone} x={L} width={W - L - 12} y={y(hi as number)} height={y(lo as number) - y(hi as number)} className={`wifi-zone tone-${tone}`} />
      ))}
      {[-90, -75, -60, -45, -30].map((d) => (
        <text key={d} x={L - 8} y={y(d) + 4} className="wifi-axis">
          {d}
        </text>
      ))}
      {[0, 30, 60, 90].map((t) => (
        <text key={t} x={x(t)} y={H - 6} className="wifi-axis wifi-axis-x">
          {t} s
        </text>
      ))}
      <line x1={L} x2={W - 12} y1={y(start)} y2={y(start)} className="wifi-start" />
      <path d={path} className="wifi-trail" />
      {trail.map((r, i) => (
        <circle key={i} cx={x(r.t)} cy={y(r.dbm)} r={3.5} className={`wifi-pt tone-${quality(r.dbm).tone}`} />
      ))}
      {marks.map((m, i) => (
        <g key={i} className="wifi-flag">
          <line x1={x(m.t)} x2={x(m.t)} y1={y(m.dbm)} y2={y(m.dbm) - 22} />
          <text x={x(m.t) + 4} y={y(m.dbm) - 16}>
            {m.name}
          </text>
        </g>
      ))}
    </svg>
  )
}

const MAT_NAME: Record<Material, string> = { glass: 'glass', wood: 'wood door', brick: 'brick', concrete: 'concrete', metal: 'metal fridge' }

/** The simulated flat for ?demo: drag or arrow-key the laptop around; the straight line to the router lights each wall it crosses. */
function Flat({ pos, setPos, band, setBand, microwave, setMicrowave, hit }: { pos: P; setPos: (p: P) => void; band: 2.4 | 5; setBand: (b: 2.4 | 5) => void; microwave: boolean; setMicrowave: (m: boolean) => void; hit: Wall[] }) {
  const k = 80 // pixels per metre
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef(false)
  const toPlan = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: Math.min(PLAN.w - 0.3, Math.max(0.3, ((e.clientX - r.left) / r.width) * PLAN.w)), y: Math.min(PLAN.h - 0.3, Math.max(0.3, ((e.clientY - r.top) / r.height) * PLAN.h)) }
  }
  return (
    <div className="wifi-flat">
      <div className="wifi-flat-controls">
        <div className="game-toggle" role="group" aria-label="Wi-Fi band">
          <button type="button" aria-pressed={band === 2.4} onClick={() => setBand(2.4)}>
            2.4 GHz
          </button>
          <button type="button" aria-pressed={band === 5} onClick={() => setBand(5)}>
            5 GHz
          </button>
        </div>
        <button type="button" className="lab-btn" aria-pressed={microwave} onClick={() => setMicrowave(!microwave)}>
          Microwave {microwave ? 'on' : 'off'}
        </button>
        <span className="fine">{hit.length ? `Through: ${hit.map((w) => `${MAT_NAME[w.m]} -${LOSS[w.m]} dB`).join(', ')}` : 'Clear line to the router'}</span>
      </div>
      <svg
        ref={svg}
        className="wifi-plan"
        viewBox={`0 0 ${PLAN.w * k} ${PLAN.h * k}`}
        role="img"
        aria-label="A simulated flat with six rooms. The router is in the hall, top left. Drag the laptop to move it."
        onPointerDown={(e) => {
          drag.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setPos(toPlan(e))
        }}
        onPointerMove={(e) => drag.current && setPos(toPlan(e))}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
      >
        <rect x={0} y={0} width={PLAN.w * k} height={PLAN.h * k} rx={10} className="wifi-floor" />
        {/* Rings at 1, 2, 4 and 8 m: each doubling of distance costs 9 dB in this model. */}
        {[1, 2, 4, 8].map((m) => (
          <circle key={m} cx={PLAN.router.x * k} cy={PLAN.router.y * k} r={m * k} className="wifi-ring" />
        ))}
        {PLAN.rooms.map((r) => (
          <text key={r.name} x={r.x * k} y={r.y * k} className="wifi-room">
            {r.name}
          </text>
        ))}
        {PLAN.walls.map((w, i) => (
          <line key={i} x1={w.a.x * k} y1={w.a.y * k} x2={w.b.x * k} y2={w.b.y * k} className={`wifi-wall m-${w.m} ${hit.includes(w) ? 'hit' : ''}`} />
        ))}
        <rect x={0} y={0} width={PLAN.w * k} height={PLAN.h * k} rx={10} className="wifi-outer" />
        <line x1={PLAN.router.x * k} y1={PLAN.router.y * k} x2={pos.x * k} y2={pos.y * k} className="wifi-ray" />
        <g transform={`translate(${PLAN.router.x * k} ${PLAN.router.y * k})`} className="wifi-router">
          <rect x={-22} y={-10} width={44} height={20} rx={5} />
          <line x1={-14} y1={-10} x2={-18} y2={-26} />
          <line x1={14} y1={-10} x2={18} y2={-26} />
          <text y={34}>router</text>
        </g>
        <g transform={`translate(${PLAN.microwave.x * k} ${PLAN.microwave.y * k})`} className={`wifi-oven ${microwave ? 'on' : ''}`}>
          <rect x={-26} y={-16} width={52} height={32} rx={4} />
          <rect x={-20} y={-10} width={30} height={20} rx={2} className="wifi-oven-door" />
          <text y={-24}>microwave</text>
        </g>
        <g
          transform={`translate(${pos.x * k} ${pos.y * k})`}
          className="wifi-laptop"
          tabIndex={0}
          role="button"
          aria-label={`Laptop at ${pos.x.toFixed(1)} by ${pos.y.toFixed(1)} metres. Arrow keys move it.`}
          onKeyDown={(e) => {
            const d = { ArrowLeft: [-0.3, 0], ArrowRight: [0.3, 0], ArrowUp: [0, -0.3], ArrowDown: [0, 0.3] }[e.key]
            if (!d) return
            e.preventDefault()
            setPos({ x: Math.min(PLAN.w - 0.3, Math.max(0.3, pos.x + d[0])), y: Math.min(PLAN.h - 0.3, Math.max(0.3, pos.y + d[1])) })
          }}
        >
          <circle r={34} className="wifi-laptop-halo" />
          <rect x={-20} y={-16} width={40} height={26} rx={3} className="wifi-laptop-lid" />
          <rect x={-26} y={10} width={52} height={6} rx={3} className="wifi-laptop-base" />
        </g>
      </svg>
      <p className="fine">
        Simulated: -30 dBm at 1 m falling 30 dB for every tenfold distance, minus each wall on the straight line to the router. Wall losses are illustrative, ranked as in Apple's interference guide. Real rooms add reflections that this ignores.
      </p>
    </div>
  )
}

function Lesson({ start, peak, noise, demo }: { start: number; peak: number; noise: number | null; demo: boolean }) {
  const simple = useSimple()
  const gain = peak - start
  return (
    <div className="game-lesson">
      <h4>{simple ? 'What those minus numbers mean' : 'dBm, and why walls and microwaves matter'}</h4>
      {simple ? (
        <>
          <p>
            Wi-Fi signal is measured in dBm. The numbers are below zero because the signal reaching your Mac is tiny: {peak} dBm is about one {fractionOfMilliwatt(peak)}th of a thousandth of a watt. Closer to zero is stronger.
          </p>
          <p>
            The scale jumps, not steps. Every 3 more means about twice the power, and every 10 more means ten times. So going from {start} to {peak} {gain > 0 ? `gave you about ${formatRatio(powerRatio(peak, start))} times the signal` : 'kept the same signal'}, even though the number only moved by {gain}.
          </p>
          <p>
            Walls soak up the signal. Wood and glass take a little, brick more, concrete a lot, and metal, like a fridge, the most. A microwave oven cooks with the same kind of radio waves as 2.4 GHz Wi-Fi, so it can drown the signal out while it runs. 5 GHz Wi-Fi avoids that, but fades a little faster with distance.
          </p>
        </>
      ) : (
        <>
          <p>
            dBm is power in decibels relative to one milliwatt: 10·log10(P / 1 mW). Received Wi-Fi is a tiny fraction of a milliwatt, so the numbers are negative: {peak} dBm is about 1 / {fractionOfMilliwatt(peak)} of a milliwatt. The scale is logarithmic: +3 dB is about double the power, +10 dB is ten times. Your hunt gained {gain} dB, {gain > 0 ? `${formatRatio(powerRatio(peak, start))} times the received power` : 'no change in power'}.
          </p>
          <p>
            What sets the link rate is the gap above the noise floor{noise != null ? `, here ${noise} dBm` : ''}. A higher signal-to-noise ratio lets the radio pick a denser modulation and coding scheme (MCS). Lesson 13 measured it on an M5 Air: -58 dBm gave MCS 5 at 648 Mbps, and -26 dBm gave MCS 11 at 1200 Mbps on the same channel. Below -75 dBm a Mac starts roaming, but only to an access point at least 12 dB stronger.
          </p>
          <p>
            Each wall on the path subtracts a fixed number of dB, so two walls cost twice as much in dB, which is a multiplication in power. Apple ranks materials: wood, glass and most plastics low; water, brick and marble medium; plaster, concrete and bulletproof glass high; metal very high. A microwave oven runs at 2.45 GHz, inside the 2.4 GHz band, and Apple lists it as a common source of interference: it raises the noise, not your signal. The 5 GHz band avoids it, at the cost of about 6 dB more free-space loss for the same distance.
          </p>
        </>
      )}
      <p className="fine">{demo ? 'This hunt was in the simulated flat. Run it without ?demo to read this Mac\'s radio.' : 'Your readings came from this Mac\'s Wi-Fi radio through CoreWLAN, once a second. They swing a few dB even when the Mac sits still, so trust moves of 3 dB or more.'}</p>
    </div>
  )
}
