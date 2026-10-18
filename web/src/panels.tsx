import { useState, type CSSProperties } from 'react'
import type { Hardware, Sample } from './types.ts'
import { NA, bytes, clamp, gpuMhz, memGB, mhz, minutes, num, pct, rate, temp, watts } from './format.ts'
import { byApp, chipLine, recentAvg, usedBytes } from './story.ts'
import { Sparkline, Stat, Val } from './ui.tsx'
import { DieMap } from './DieMap.tsx'

type P = { hw: Hardware; s: Sample; history: Sample[] }

/** Counts 0..3 with each sample; panel stripes and dashes step by it once per reading. */
const sampleStep = (s: Sample) => Math.round(s.t / 1000) % 4


export function ChipPanel({ hw, s, history }: P) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="panel-grid chip-grid">
      <div className="card">
        <p className="lede">{chipLine(s, hw)}</p>
        <DieMap hw={hw} s={s} onCore={setHover} />
        <div className="hover-line" aria-live="polite">
          {hover ?? 'Hover or focus a core to see its load. Tiles flicker faster and brighter when busier. Layout follows Apple\'s published die renders; block sizes are estimates.'}
        </div>
      </div>

      <div className="card">
        <h3>Clocks, heat and power</h3>
        <div className="stats">
          <Stat label="P-cluster" value={mhz(s.cpu.pFreqMHz)} />
          <Stat label="E-cluster" value={mhz(s.cpu.eFreqMHz)} />
          <Stat label="GPU" value={gpuMhz(s.gpu.freqMHz)} />
          <Stat label="CPU temp" value={temp(s.thermal.cpuTempC)} />
          <Stat label="GPU temp" value={temp(s.thermal.gpuTempC)} />
          <Stat label="Thermal state" value={s.thermal.state[0].toUpperCase() + s.thermal.state.slice(1)} />
          <Stat label="CPU power" value={watts(s.power.cpuW)} />
          <Stat label="GPU power" value={watts(s.power.gpuW)} />
          <Stat label="ANE power" value={watts(s.power.aneW)} />
        </div>
        <h3>Top processes by CPU</h3>
        <ol className="procs">
          {byApp(s.topCpu, (p) => p.cpu)
            .slice(0, 6)
            .map((p) => (
              <li key={p.name}>
                <span className="pname">
                  {p.name}
                  {p.n > 1 && <span className="pcount"> ×{p.n}</span>}
                </span>
                <span className="bar" style={{ '--w': clamp(p.v / (100 * (hw.pCores + hw.eCores)) * 4) } as CSSProperties} />
                <span className="num">{num(p.v)}%</span>
              </li>
            ))}
        </ol>
        <p className="fine">100% means one full core. This Mac has {hw.pCores + hw.eCores} cores, so the ceiling is {(hw.pCores + hw.eCores) * 100}%.</p>
      </div>
      <div className="card span-2">
        <h3>Last 60 seconds per core</h3>
        <CoreStrips history={history} />
      </div>
    </div>
  )
}

function CoreStrips({ history }: { history: Sample[] }) {
  const h = history.slice(-60)
  const cores = h.at(-1)?.cpu.cores ?? []
  return (
    <div className="strips" role="img" aria-label="Per-core load over the last 60 seconds">
      {cores.map((c) => (
        <div key={c.id} className="strip-row">
          <span className="strip-label">
            {c.kind}
            {c.id}
          </span>
          {Array.from({ length: 60 }, (_, i) => {
            const s = h[i - (60 - h.length)]
            const u = s?.cpu.cores.find((x) => x.id === c.id)?.usage
            return <span key={i} className={`strip ${c.kind === 'P' ? 'p' : 'e'}`} style={{ opacity: u == null ? 0.04 : 0.07 + 0.93 * u }} />
          })}
        </div>
      ))}
    </div>
  )
}

const BLOCKS = 256
const COLS = 32
const ROWS = BLOCKS / COLS
type Kind = 'wired' | 'app' | 'compressed' | 'cached' | 'free' | 'other'
const KIND_LABEL: Record<Kind, string> = {
  wired: 'Wired (kernel, cannot be paged out)',
  app: 'App memory',
  compressed: 'Compressed',
  cached: 'Cached files (reclaimable)',
  free: 'Free',
  other: 'Other',
}

export function MemoryPanel({ s, history }: P) {
  const m = s.memory
  const blockBytes = m.totalBytes / BLOCKS
  const appKnown = m.appBytes != null
  const appBytes = m.appBytes ?? m.activeBytes
  const parts: [Kind, number][] = [
    ['wired', m.wiredBytes],
    ['app', appBytes],
    ['compressed', m.compressedBytes],
    ['cached', m.inactiveBytes],
    ['free', m.freeBytes],
  ]
  const cells: { kind: Kind; proc?: number }[] = []
  for (const [k, b] of parts) {
    const n = Math.min(BLOCKS - cells.length, Math.round(b / blockBytes))
    for (let i = 0; i < n; i++) cells.push({ kind: k })
  }
  while (cells.length < BLOCKS) cells.push({ kind: 'other' })

  // Paint the top processes onto the app region, biggest first.
  const appStart = cells.findIndex((c) => c.kind === 'app')
  const appCount = cells.filter((c) => c.kind === 'app').length
  const labels: { name: string; start: number; n: number; b: number }[] = []
  let cur = appStart
  for (const p of [...s.topMem].sort((a, b) => b.bytes - a.bytes)) {
    const n = Math.min(Math.round(p.bytes / blockBytes), appStart + appCount - cur)
    if (n <= 0 || appStart < 0) break
    for (let i = 0; i < n; i++) cells[cur + i].proc = labels.length
    labels.push({ name: p.name, start: cur, n, b: p.bytes })
    cur += n
  }
  const swapBlocks = Math.ceil(m.swapUsedBytes / blockBytes)
  const used = usedBytes(s)

  return (
    <div className="panel-grid">
      <div className="card span-2 mem-card">
        <div className="mem-head">
          <p className="lede">
            {memGB(used)} of {memGB(m.totalBytes, 0)} in use. Each block is {memGB(blockBytes)}. The CPU, GPU and Neural Engine all share this one pool.
          </p>
          <span className={`badge pressure-${m.pressure}`}>Pressure: {m.pressure}</span>
        </div>
        <div className="mem-wrap">
          <div className="mem-grid" role="img" aria-label="Memory blocks by type">
            {cells.map((c, i) => (
              <div
                key={i}
                className={`blk k-${c.kind} ${c.proc == null ? '' : c.proc % 2 ? 'proc odd' : 'proc'}`}
                title={c.proc == null ? KIND_LABEL[c.kind] : `${labels[c.proc].name}, ${memGB(labels[c.proc].b)}`}
              />
            ))}
            {labels.map((l, li) => {
                const col = l.start % COLS
                const span = Math.min(COLS - col, l.n)
                if (span < 3) return null
                const pos = { left: `${(col / COLS) * 100}%`, top: `${(Math.floor(l.start / COLS) / ROWS) * 100}%`, width: `${(span / COLS) * 100}%`, height: `${100 / ROWS}%` }
                return (
                  <div key={l.name + l.start} className={`blk-label ${li % 2 ? 'odd' : ''}`} style={pos} aria-hidden>
                    {l.name} <span className="num">{memGB(l.b)}</span>
                  </div>
                )
              })}
          </div>
          <div className="swap">
            <div className="swap-arrow" aria-hidden>
              {swapBlocks > 0 ? 'spills to' : ''}
            </div>
            <div className={`ssd-tray ${swapBlocks ? 'active' : ''}`}>
              <div className="ssd-title">SSD swap</div>
              <div className="swap-blocks">
                {Array.from({ length: Math.min(swapBlocks, 48) }, (_, i) => (
                  <div key={i} className="blk k-swapped" style={{ animationDelay: `${(i % 8) * 0.06}s` }} />
                ))}
              </div>
              <div className="ssd-sub">{m.swapUsedBytes > 0 ? `${memGB(m.swapUsedBytes)} moved out of RAM` : 'No swap in use'}</div>
            </div>
          </div>
        </div>
        <ul className="legend">
          {parts.map(([k, b]) => (
            <li key={k}>
              <span className={`sw blk k-${k}`} />
              {k === 'app' && !appKnown ? 'Active (app memory not reported)' : KIND_LABEL[k]}
              <span className="num">{memGB(b)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Memory bandwidth</h3>
        <div className="big">
          <Val v={m.bandwidthGBs == null ? NA : `${num(m.bandwidthGBs)} GB/s`} why="The reader could not read DRAM bandwidth counters." />
        </div>
        <Sparkline values={history.slice(-120).map((x) => x.memory.bandwidthGBs)} w={300} h={60} label="Bandwidth, last 2 minutes" />
        <p className="fine">Reads plus writes between the chip and its memory, last 2 minutes.</p>
        <h3>Used memory, last 10 minutes</h3>
        <Sparkline values={history.map(usedBytes)} max={m.totalBytes} w={300} h={60} label="Used memory, last 10 minutes" />
      </div>
      <div className="card">
        <h3>Top processes by memory</h3>
        <ol className="procs">
          {byApp(s.topMem, (p) => p.bytes).map((p) => (
            <li key={p.name}>
              <span className="pname">
                {p.name}
                {p.n > 1 && <span className="pcount"> ×{p.n}</span>}
              </span>
              <span className="bar" style={{ '--w': clamp(p.v / m.totalBytes * 3) } as CSSProperties} />
              <span className="num">{memGB(p.v)}</span>
            </li>
          ))}
        </ol>
        <p className="fine">
          Compressed blocks are drawn squeezed: macOS shrinks idle pages in RAM before it writes anything to the SSD. Swap only grows when compression is not enough.
        </p>
      </div>
    </div>
  )
}

export function BatteryPanel({ hw, s, history }: P) {
  const b = s.battery
  if (!b) {
    return (
      <div className="card">
        <p className="lede">{hw.hasBattery ? 'The reader could not read the battery.' : 'This Mac has no battery. It runs from the wall.'}</p>
      </div>
    )
  }
  const w = b.watts
  const flow = w == null ? NA : w > 0.2 ? `${watts(w)} in` : w < -0.2 ? `${watts(-w)} out` : '0 W, idle'
  const status = b.chargeHeld
    ? `Plugged in and held at ${Math.round(b.percent)}%. macOS pauses charging below 100% (Optimized Battery Charging or a charge limit) to slow battery wear. The Mac runs from the adapter meanwhile.`
    : b.charging
      ? `Charging from the adapter.`
      : b.acAttached
        ? `On the adapter. The battery is not charging.`
        : `Running on battery.`
  return (
    <div className="panel-grid" style={{ '--step': sampleStep(s) } as CSSProperties}>
      <div className="card">
        <div className="batt-pct num">{Math.round(b.percent)}%</div>
        <p className="lede">{status}</p>
        <div className="batt-big" aria-label={`Battery ${Math.round(b.percent)} percent`}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="batt-cell">
              <div className={`batt-fill ${b.charging ? 'charging' : ''}`} style={{ width: `${b.percent}%` }} />
            </div>
          ))}
          {b.chargeHeld && (
            <div className="batt-lock">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
                <path d="M5 7 V5 a3 3 0 0 1 6 0 V7" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
              Held at {Math.round(b.percent)}%
            </div>
          )}
        </div>
        <h3>Charge, last 10 minutes</h3>
        <Sparkline values={history.map((x) => x.battery?.percent ?? null)} max={100} w={600} h={44} label="Battery percent, last 10 minutes" />
      </div>
      <div className="card">
        <h3>Where the power goes</h3>
        <PowerPath b={b} systemW={recentAvg(history, (x) => x.power.systemW)} />
        <div className="stats">
          <Stat label="Battery flow" value={flow} why="The reader could not read battery current." />
          <Stat label="Adapter" value={b.acAttached ? watts(b.adapterW) : 'not connected'} />
          {/* A new pack can report more than its design capacity; show 100% and keep the raw figure visible. */}
          <Stat
            label="Health"
            value={pct(b.healthPct == null ? null : Math.min(100, b.healthPct), 1)}
            why="Maximum capacity versus design capacity was not reported."
            sub={b.healthPct != null && b.healthPct > 100 ? <span title="Maximum capacity divided by design capacity, as reported">reported {pct(b.healthPct, 1)}</span> : undefined}
          />
          <Stat label="Cycles" value={num(b.cycleCount)} />
          <Stat label="Temperature" value={temp(s.thermal.batteryTempC)} />
          <Stat label={b.charging ? 'Time to full' : 'Time left'} value={minutes(b.timeRemainingMin)} why="macOS gives no estimate right now, for example while plugged in and not charging." />
        </div>
      </div>
    </div>
  )
}

/** Adapter, Mac and battery as three nodes; the animated links show which way energy moves. */
function PowerPath({ b, systemW }: { b: NonNullable<Sample['battery']>; systemW: number | null }) {
  const w = b.watts ?? 0
  const toBatt = b.acAttached && w > 0.2
  const fromBatt = w < -0.2 || !b.acAttached
  return (
    <svg viewBox="0 0 380 130" className="ppath" role="img" aria-label="Power path between adapter, Mac and battery">
      <path d="M 106 41 H 190" className={`link ${b.acAttached ? 'on' : ''}`} />
      <path d="M 238 60 V 88" className={`link ${toBatt ? 'on' : fromBatt ? 'on rev' : b.chargeHeld ? 'held' : ''}`} />
      {[
        { x: 10, y: 22, t: 'Adapter', v: b.acAttached ? watts(b.adapterW) : 'unplugged' },
        { x: 190, y: 22, t: 'This Mac', v: watts(systemW) },
        { x: 190, y: 88, t: 'Battery', v: b.chargeHeld ? `held at ${Math.round(b.percent)}%` : w > 0.2 ? `+${watts(w)}` : w < -0.2 ? watts(w) : 'idle' },
      ].map((n) => (
        <g key={n.t} transform={`translate(${n.x} ${n.y})`}>
          <rect width="96" height="38" rx="9" className="pnode" />
          <text x="10" y="16" className="pnode-t">
            {n.t}
          </text>
          <text x="10" y="30" className="pnode-v">
            {n.v}
          </text>
        </g>
      ))}
      {b.chargeHeld && (
        <text x="294" y="111" className="pnote">
          Charging paused
        </text>
      )}
    </svg>
  )
}

function IoCard({ title, a, b, la, lb, hist, sub }: { title: string; a: number; b: number; la: string; lb: string; hist: [number, number][]; sub?: string }) {
  const sa = hist.reduce((t, x) => t + x[0], 0)
  const sb = hist.reduce((t, x) => t + x[1], 0)
  const top = Math.max(1, ...hist.flat())
  return (
    <div className="card">
      <h3>
        {title}
        {sub && <span className="h-sub">{sub}</span>}
      </h3>
      <div className="io-row">
        <div>
          <div className="stat-label">{la}</div>
          <div className="big num">{rate(a)}</div>
        </div>
        <div>
          <div className="stat-label">{lb}</div>
          <div className="big num alt">{rate(b)}</div>
        </div>
      </div>
      <div className="io-spark">
        <Sparkline values={hist.map((x) => x[0])} max={top} w={400} h={70} label={`${la}, last 10 minutes`} />
        <div className="overlay">
          <Sparkline values={hist.map((x) => x[1])} max={top} w={400} h={70} color="var(--accent-alt)" label={`${lb}, last 10 minutes`} />
        </div>
      </div>
      <p className="fine">
        Last {Math.round(hist.length / 60) || 1} min: {bytes(sa)} {la.toLowerCase()}, {bytes(sb)} {lb.toLowerCase()}. Peak {rate(top)}.
      </p>
    </div>
  )
}

export function IoPanel({ s, history }: P) {
  return (
    <div className="panel-grid">
      <IoCard title="SSD" a={s.disk.readBps} b={s.disk.writeBps} la="Read" lb="Written" hist={history.map((x) => [x.disk.readBps, x.disk.writeBps])} />
      <IoCard title="Network" sub={s.net.iface ?? undefined} a={s.net.rxBps} b={s.net.txBps} la="Received" lb="Sent" hist={history.map((x) => [x.net.rxBps, x.net.txBps])} />
      <div className="card span-2">
        <p className="fine">
          The SSD controller lives inside the chip; the NAND packages on the board only store data. Wi-Fi is a separate radio module with antennas routed up through the hinge.
        </p>
      </div>
    </div>
  )
}

const SEGS = [
  { k: 'cpuW', label: 'CPU', cls: 'seg-cpu' },
  { k: 'gpuW', label: 'GPU', cls: 'seg-gpu' },
  { k: 'aneW', label: 'Neural Engine', cls: 'seg-ane' },
  { k: 'dramW', label: 'Memory', cls: 'seg-dram' },
] as const

export function PowerPanel({ s, history }: P) {
  const pw = s.power
  const parts = SEGS.map((g) => ({ ...g, v: pw[g.k] }))
  const sum = parts.reduce((t, x) => t + (x.v ?? 0), 0)
  const systemW = recentAvg(history, (x) => x.power.systemW)
  const other = systemW != null ? Math.max(0, systemW - sum) : null
  const total = systemW ?? sum
  const all = [...parts, { k: 'other', label: 'Rest of system', cls: 'seg-other', v: other }]
  const h = history.slice(-120)
  const hTop = Math.max(5, ...h.map((x) => x.power.systemW ?? SEGS.reduce((t, g) => t + (x.power[g.k] ?? 0), 0)))
  const bw = 600
  const bh = 120
  // Stacked area, bottom up in SEGS order.
  const areas = SEGS.map((_, gi) => {
    const top = h.map((x, i) => [i, SEGS.slice(0, gi + 1).reduce((t, g) => t + (x.power[g.k] ?? 0), 0)] as const)
    const bot = h.map((x, i) => [i, SEGS.slice(0, gi).reduce((t, g) => t + (x.power[g.k] ?? 0), 0)] as const)
    const X = (i: number) => (h.length > 1 ? (i / (h.length - 1)) * bw : bw)
    const Y = (v: number) => bh - (v / hTop) * bh
    return [...top.map(([i, v]) => `${X(i)},${Y(v)}`), ...bot.reverse().map(([i, v]) => `${X(i)},${Y(v)}`)].join(' ')
  })
  return (
    <div className="panel-grid" style={{ '--step': sampleStep(s) } as CSSProperties}>
      <div className="card span-2">
        <p className="lede">
          {total > 0 ? (
            <>
              The Mac is drawing <span className="num strong">{watts(total)}</span>
              {pw.systemW == null ? ' across the chip blocks the reader can see' : ' in total'}.
            </>
          ) : (
            'The reader could not read power counters on this Mac.'
          )}
        </p>
        <div className="power-bar" role="img" aria-label="Power split">
          {all.map((g) =>
            g.v != null && g.v > 0 ? <div key={g.k} className={`seg ${g.cls}`} style={{ flexGrow: g.v }} title={`${g.label}: ${watts(g.v)}`} /> : null,
          )}
        </div>
        <ul className="legend">
          {all.map((g) => (
            <li key={g.k}>
              <span className={`sw ${g.cls}`} />
              {g.label}
              <Val v={watts(g.v)} why={g.k === 'other' ? 'Needs total system power, which was not reported.' : undefined} />
            </li>
          ))}
        </ul>
      </div>
      <div className="card span-2">
        <h3>Last 2 minutes</h3>
        <svg viewBox={`0 0 ${bw} ${bh}`} preserveAspectRatio="none" className="area" role="img" aria-label="Power by block, last 2 minutes">
          {areas.map((pts, i) => (
            <polygon key={i} points={pts} className={SEGS[i].cls} />
          ))}
        </svg>
        <p className="fine">
          Power figures come from the chip's own energy counters. The rest of the system covers the display, SSD, radios and conversion losses. Scale tops out at {watts(hTop)}.
        </p>
      </div>
      {s.fans.length > 0 && (
        <div className="card span-2">
          <h3>Fans</h3>
          <div className="stats">
            {s.fans.map((f, i) => (
              <Stat key={i} label={s.fans.length > 1 ? `Fan ${i + 1}` : 'Fan'} value={`${num(f.rpm)} rpm`} sub={f.minRpm != null && f.maxRpm != null ? `range ${num(f.minRpm)} to ${num(f.maxRpm)} rpm` : undefined} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
