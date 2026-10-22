import { useMemo, useState } from 'react'
import { memGB } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { LAT_NS, estimateNs, humanTime, simulate, type Pattern } from './caches.ts'
import './Caches.css'

// The memory hierarchy as a ladder: registers at the top, the SSD at the bottom. Requests walk down until a
// level has the data, and the 128-byte line climbs back up, landing in each level on the way. 960 x 600 viewBox.

const KB = 1024
const MB = 1024 * KB
/** This Mac's top P-core clock, 4464 MHz, from its own frequency table (ioreg, lesson 4). Sets the human scale. */
const GHZ = 4.464
const SSD_NS = 73_000
const CX = 300
const ROW = (i: number) => ({ y: 44 + i * 78, h: 58, w: 180 + i * 76 })
const box = (i: number) => {
  const r = ROW(i)
  return { x: CX - r.w / 2, y: r.y, w: r.w, h: r.h }
}
const MID = (i: number) => ROW(i).y + 29
const slotCount = (i: number) => (i === 0 || i === 5 ? 0 : Math.min(4, Math.floor((box(i).w - 150) / 30)))
const slot = (i: number, n: number) => {
  const b = box(i)
  return { x: b.x + b.w - 14 - (slotCount(i) - n) * 30, y: b.y + b.h / 2 - 8, w: 26, h: 16 }
}
const STRIP = { x: 120, y: 520 }

type Level = { tech: string; plain: string; size: string; ns: number | null; nsText: string }

type Token = { at: [number, number]; kind: 'req' | 'line' | 'page' | 'val' | 'evict'; label: string }
type Frame = {
  shown: number
  lit: number[]
  miss: number[]
  hit: number | null
  tokens: Token[]
  /** Slots holding our lines, per level. */
  slots: Record<number, number>
  /** One cell per read: -1 not yet, 0 hit, 2 went to DRAM. */
  strip: number[] | null
  note: string
}

const DOWN = 0.45
const UP = 0.45

/** Down from the registers to level `at`, then the line back up to L1 and the value into a register. */
function access(f: Frame, t: number, t0: number, at: number, label: string, simple: boolean) {
  const tHit = t0 + at * DOWN
  const tTop = tHit + 0.5 + (at - 1) * UP
  if (t < t0) return
  if (t < tHit) f.tokens.push({ at: [CX, MID(0) + ((t - t0) / DOWN) * 78], kind: 'req', label })
  for (let i = 1; i < at; i++) if (t >= t0 + i * DOWN) f.miss.push(i)
  if (t >= tHit) f.hit = at
  if (t >= tHit + 0.5 && t < tTop) {
    const k = (t - tHit - 0.5) / ((at - 1) * UP)
    f.tokens.push({ at: [CX, MID(at) - k * (at - 1) * 78], kind: at === 5 ? 'page' : 'line', label: at === 5 ? '16 KB page' : simple ? '128-byte bundle' : '128-byte line' })
  }
  // A level holds the line once the line has passed it.
  for (let i = Math.min(at, 4); i >= 1; i--) if (t >= tHit + 0.5 + (at - i) * UP) f.slots[i] = Math.max(f.slots[i] ?? 0, 1)
  if (t >= tTop && t < tTop + 0.5) f.tokens.push({ at: [CX, MID(1) - phase(t, tTop, tTop + 0.45) * 78], kind: 'val', label: '8 B' })
}

function frame(i: number, t: number, simple: boolean): Frame {
  const f: Frame = { shown: 6, lit: [], miss: [], hit: null, tokens: [], slots: {}, strip: null, note: '' }
  const human = (ns: number) => humanTime(ns, GHZ)
  switch (i) {
    case 0:
      f.shown = Math.min(6, Math.floor(t / 0.4) + 1)
      f.note = simple ? 'Each step down holds more, and takes longer to reach.' : 'Each level down is bigger, slower and shared more widely.'
      break
    case 1:
      f.lit = [0]
      if (t > 0.3) f.tokens.push({ at: [CX - 34, MID(0)], kind: 'val', label: 'x' }, { at: [CX + 34, MID(0)], kind: 'val', label: 'y' })
      f.note = simple ? 'Adding two numbers already in hand: no trip anywhere.' : 'add x0, x1, x2: both inputs are already in registers, so no memory access at all.'
      break
    case 2:
      f.slots = { 1: 1 }
      access(f, t, 0.3, 1, 'load x', simple)
      f.note = t > 0.8 ? (simple ? `Found in the notebook: ${human(LAT_NS.l1)} on the stretched clock.` : `L1 hit: about ${LAT_NS.l1} ns, ${human(LAT_NS.l1)} at human scale.`) : ''
      break
    case 3:
      access(f, t, 0.3, 4, 'load y', simple)
      f.note = t > 2.1 ? (simple ? `Not found until the Desk: ${human(LAT_NS.dram)} on the stretched clock.` : `Missed L1, L2 and SLC. DRAM: about ${LAT_NS.dram} ns, ${human(LAT_NS.dram)} at human scale.`) : simple ? 'Looking for y...' : 'Lookup in progress...'
      break
    case 4: {
      f.slots = { 1: 1, 2: 1, 3: 1, 4: 1 }
      const n = Math.min(16, Math.floor(phase(t, 0.3, 4.6) * 16.99))
      f.strip = Array.from({ length: 16 }, (_, c) => (c < n ? (c === 0 ? 2 : 0) : -1))
      if (n > 0 && n < 16) f.tokens.push({ at: along([[CX, MID(1)], [CX, MID(0)]], (t * 4) % 1), kind: 'val', label: `y+${(n - 1) * 8}` })
      f.lit = [0, 1]
      f.note = simple ? `1 trip to the Desk, then ${Math.max(0, n - 1)} quick reads from the same bundle.` : `1 miss, then ${Math.max(0, n - 1)} hits: the other 15 eight-byte values came with the line.`
      break
    }
    case 5: {
      f.slots = { 1: 4, 2: 4, 3: 4, 4: 4 }
      f.lit = [1]
      const s0 = slot(1, 0)
      if (t > 0.3 && t < 2.2) f.tokens.push({ at: along([[s0.x + 13, s0.y + 8], [s0.x + 13, MID(2) + 4]], phase(t, 0.3, 2.0)), kind: 'evict', label: simple ? 'oldest out' : 'evict LRU' })
      if (t > 2.4) access(f, t, 2.4, 1, 'load y', simple)
      f.note = t < 2.4 ? (simple ? 'The notebook is full: the note used longest ago makes room.' : 'The L1 set is full: the least recently used line goes back to L2.') : simple ? 'y was used a moment ago, so it is still in the notebook.' : 'y was used recently, so it is still in L1: temporal locality.'
      break
    }
    case 6: {
      f.lit = [1, 4]
      // Reads walk forward one line at a time. After two misses in a row the prefetcher runs ahead.
      const reads = Math.min(6, Math.floor(phase(t, 0.2, 5.6) * 6.99))
      f.strip = Array.from({ length: 6 }, (_, c) => (c < reads ? (c < 2 ? 2 : 0) : -1))
      if (t > 2 && t < 5.3) f.tokens.push({ at: [CX + 90, MID(4) - (((t - 2) / 1.1) % 1) * 3 * 78], kind: 'line', label: simple ? 'fetched early' : 'prefetch' })
      f.slots = { 1: Math.min(3, reads), 2: Math.min(4, reads), 4: 4 }
      f.note = reads < 3 ? (simple ? 'Bundle after bundle... the helper spots the pattern.' : 'Two sequential misses: the prefetcher sees the stride.') : simple ? 'Bundles now arrive before they are asked for. Every read is quick.' : 'Lines arrive ahead of the loads, so they all hit in L1.'
      break
    }
    case 7:
      access(f, t, 0.3, 5, 'load z', simple)
      f.note = t > 2.6 ? (simple ? `Not on the Desk at all. Fetched from storage: ${human(SSD_NS)} on the stretched clock.` : `Page fault, read from the SSD: about 73 µs, ${human(SSD_NS)} at human scale.`) : simple ? 'Looking for z...' : 'Lookup in progress...'
      break
  }
  return f
}

function Scene({ f, levels, simple }: { f: Frame; levels: Level[]; simple: boolean }) {
  const wide = f.strip?.length === 16
  const cell = wide ? 44 : 112
  return (
    <svg className="ca-scene" viewBox="0 0 960 600" role="img" aria-label="The memory hierarchy as a ladder from registers to the SSD, with a request walking down and a cache line climbing back up">
      <text className="ca-col" x={610} y={28}>
        {simple ? 'Wait, measured' : 'Latency here'}
      </text>
      <text className="ca-col" x={780} y={28}>
        {simple ? 'If a tick took 1 s' : 'If a cycle took 1 s'}
      </text>
      {levels.map((l, n) => {
        if (n >= f.shown) return null
        const b = box(n)
        const cls = `ca-level ${f.lit.includes(n) ? 'lit' : ''} ${f.miss.includes(n) ? 'miss' : ''} ${f.hit === n ? 'hit' : ''}`
        return (
          <g key={n} className={cls}>
            <rect className="ca-box" x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
            <text className="ca-name" x={b.x + 14} y={b.y + 24}>
              {simple ? l.plain : l.tech}
            </text>
            <text className="ca-size" x={b.x + 14} y={b.y + 44}>
              {l.size}
            </text>
            {Array.from({ length: slotCount(n) }, (_, s) => {
              const r = slot(n, s)
              return <rect key={s} className={`ca-slot ${s < (f.slots[n] ?? 0) ? 'full' : ''}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
            })}
            <line className="ca-guide" x1={b.x + b.w + 8} y1={MID(n)} x2={600} y2={MID(n)} />
            <text className="ca-ns" x={610} y={MID(n) + 5}>
              {l.nsText}
            </text>
            <text className="ca-human" x={780} y={MID(n) + 5}>
              {l.ns == null ? (simple ? 'instant' : 'no wait') : humanTime(l.ns, GHZ)}
            </text>
            {f.miss.includes(n) && (
              <text className="ca-tag miss" x={b.x - 10} y={MID(n) + 5} textAnchor="end">
                {simple ? 'not here' : 'miss'}
              </text>
            )}
            {f.hit === n && (
              <text className="ca-tag hit" x={b.x - 10} y={MID(n) + 5} textAnchor="end">
                {simple ? 'found' : 'hit'}
              </text>
            )}
          </g>
        )
      })}
      {f.strip && (
        <g className="ca-strip">
          <text className="ca-size" x={STRIP.x - 12} y={STRIP.y + 23} textAnchor="end">
            {wide ? (simple ? 'one bundle' : 'one line') : simple ? 'bundles' : 'lines'}
          </text>
          {f.strip.map((v, c) => (
            <rect key={c} className={`ca-cell s${v}`} x={STRIP.x + c * (cell + 4)} y={STRIP.y} width={cell} height={34} rx={4} />
          ))}
        </g>
      )}
      {f.tokens.map((tk, n) => (
        <g key={n} className={`ca-token ${tk.kind}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
          <rect x={-tk.label.length * 4 - 10} y={-11} width={tk.label.length * 8 + 20} height={22} rx={tk.kind === 'line' || tk.kind === 'page' ? 4 : 11} />
          <text y={4} textAnchor="middle">
            {tk.label}
          </text>
        </g>
      ))}
      <text className="ca-note" x={480} y={f.strip ? 584 : 560} textAnchor="middle">
        {f.note}
      </text>
    </svg>
  )
}

const SIZES = [32 * KB, 256 * KB, 4 * MB, 64 * MB, 512 * MB]
/** In 8-byte elements: 16 B, one line, half a page of lines, and a 32 KB power of two. */
const STRIDES = [2, 16, 64, 4096]
const fmtNs = (ns: number) => (ns < 1e3 ? `${ns.toFixed(0)} ns` : ns < 1e6 ? `${(ns / 1e3).toFixed(1)} µs` : `${(ns / 1e6).toFixed(2)} ms`)
const fmtSize = (b: number) => (b >= MB ? `${b / MB} MB` : b >= KB ? `${b / KB} KB` : `${b} B`)
const READS = 50_000

function TryIt({ simple }: { simple: boolean }) {
  const [pattern, setPattern] = useState<Pattern>('seq')
  const [size, setSize] = useState(64 * MB)
  const [stride, setStride] = useState(16)
  const [prefetch, setPrefetch] = useState(false)
  const r = useMemo(
    () => simulate({ pattern, arrayBytes: size, elemBytes: 8, strideElems: stride, reads: READS, lineBytes: 128, l1: { bytes: 128 * KB, ways: 8 }, l2: { bytes: 16 * MB, ways: 16 }, prefetch, seed: 1 }),
    [pattern, size, stride, prefetch],
  )
  const ns = estimateNs(r)
  const best = READS * LAT_NS.l1
  const names: Record<Pattern, string> = simple ? { seq: 'In order', random: 'Random', stride: 'Jumping' } : { seq: 'Sequential', random: 'Random', stride: 'Strided' }
  const bars = [
    { k: 's0', label: simple ? 'Notebook' : 'L1 hits', v: r.l1Hits },
    { k: 's1', label: simple ? 'Team shelf' : 'L2 hits', v: r.l2Hits },
    { k: 's2', label: simple ? 'Desk' : 'DRAM', v: r.dram },
  ]
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: walk through a list' : 'Try it: a tiny cache simulator'}</h3>
      <p className="fine">
        {simple
          ? 'A program reads 50,000 numbers of 8 bytes from a list. Choose how it walks the list and how big the list is, and see where each number was found.'
          : '50,000 loads of 8-byte elements through a simulated 128 KB 8-way L1 and 16 MB 16-way L2, with 128-byte lines and LRU replacement, sized like one Super core of this M5. Apple doesn\'t publish associativity, so the ways are a guess, and the model has no SLC.'}
      </p>
      <div className="lab-try-row">
        <div className="lab-seg" role="group" aria-label={simple ? 'How to walk' : 'Access pattern'}>
          {(['seq', 'random', 'stride'] as Pattern[]).map((p) => (
            <button key={p} type="button" aria-pressed={pattern === p} onClick={() => setPattern(p)}>
              {names[p]}
            </button>
          ))}
        </div>
        <div className="lab-seg" role="group" aria-label={simple ? 'List size' : 'Array size'}>
          {SIZES.map((b) => (
            <button key={b} type="button" aria-pressed={size === b} onClick={() => setSize(b)}>
              {fmtSize(b)}
            </button>
          ))}
        </div>
        {pattern === 'stride' && (
          <div className="lab-seg" role="group" aria-label={simple ? 'Jump size' : 'Stride'}>
            {STRIDES.map((s) => (
              <button key={s} type="button" aria-pressed={stride === s} onClick={() => setStride(s)}>
                {fmtSize(s * 8)}
              </button>
            ))}
          </div>
        )}
        <label className="ca-check">
          <input type="checkbox" checked={prefetch} onChange={(e) => setPrefetch(e.currentTarget.checked)} />
          {simple ? 'Helper fetches ahead' : 'Prefetcher'}
        </label>
      </div>
      <div className="ca-trace" role="img" aria-label={`Where each of the first ${r.trace.length} reads was found`}>
        {r.trace.map((v, n) => (
          <span key={n} className={`s${v}`} />
        ))}
      </div>
      <p className="fine ca-legend">
        {simple ? 'The first 160 reads, in order: ' : 'The first 160 loads: '}
        <span className="ca-key s0" /> {simple ? 'notebook' : 'L1'} <span className="ca-key s1" /> {simple ? 'team shelf' : 'L2'} <span className="ca-key s2" /> {simple ? 'Desk' : 'DRAM'}
      </p>
      <div className="ca-bars">
        {bars.map((b) => (
          <div key={b.k} className="ca-bar">
            <span>{b.label}</span>
            <span className="ca-bar-track">
              <span className={`ca-bar-fill ${b.k}`} style={{ width: `${(b.v / READS) * 100}%` }} />
            </span>
            <span className="num">{((b.v / READS) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <p className={`lab-verdict ${r.dram / READS > 0.3 ? 'bad' : 'ok'}`} aria-live="polite">
        {simple
          ? `About ${fmtNs(ns)} if each read waits for the one before, ${(ns / best).toFixed(1)} times as long as if every number were in the notebook.`
          : `Estimated ${fmtNs(ns)} for dependent loads, ${(ns / READS).toFixed(1)} ns each, ${(ns / best).toFixed(1)}× the all-L1 case. ${r.lines.toLocaleString('en')} distinct lines touched${prefetch ? `; ${r.prefetched.toLocaleString('en')} loads found a prefetched line` : ''}.`}
      </p>
      <p className="fine">
        {simple
          ? 'Try Jumping by 32 KB on a 256 KB list. The numbers all land in the same corner of the notebook and push each other out, even though the notebook has room to spare.'
          : 'Try a 32 KB stride on a 256 KB array. Every line maps to the same L1 set, so 8 lines fight over 8 ways and the cache thrashes while it is mostly empty. Times assume each load waits for the last; real cores overlap independent misses, so streaming code runs faster than this.'}
      </p>
    </section>
  )
}

export default function Caches({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const isM5 = hw.chip === 'Apple M5'
  const pageBytes = s.paging?.pageBytes ?? null
  const levels: Level[] = [
    { tech: 'Registers', plain: "Worker's hands", size: simple ? 'a few dozen numbers' : '31 × 64-bit, 32 × 128-bit', ns: null, nsText: 'none' },
    { tech: 'L1 data cache', plain: 'Pocket notebook', size: '128 KB per core', ns: LAT_NS.l1, nsText: `${LAT_NS.l1} ns` },
    { tech: 'L2 cache', plain: 'Team shelf', size: simple ? '16 MB per team of 4' : '16 MB, shared by 4 cores', ns: LAT_NS.l2, nsText: `~${LAT_NS.l2} ns` },
    { tech: 'System level cache', plain: 'Cupboard on the chip', size: simple ? 'maybe 32 MB, for everyone' : '~32 MB (estimate), whole chip', ns: LAT_NS.slc, nsText: `~${LAT_NS.slc} ns` },
    { tech: 'DRAM', plain: 'Desk Space', size: simple ? `${memGB(hw.memBytes, 0)}, the whole desk` : `${memGB(hw.memBytes, 0)} LPDDR5X`, ns: LAT_NS.dram, nsText: `~${LAT_NS.dram} ns` },
    { tech: 'SSD', plain: 'Storage room', size: simple ? 'all your files' : 'flash, read in pages', ns: SSD_NS, nsText: '~73 µs' },
  ]
  const steps: Step[] = [
    {
      title: simple ? 'From hands to storage room' : 'The memory hierarchy',
      dur: 2.6,
      tech: (
        <p>
          A core can't wait 88 ns for every load, so it keeps copies of recently used memory in small fast caches. Each level down is bigger, slower and shared by more of the chip. The middle column was measured on this Mac. The right column stretches time so one clock cycle at {GHZ} GHz, this Mac's top P-core clock, lasts one second.
        </p>
      ),
      plain: (
        <p>
          A worker can't walk to the Desk for every number, so it keeps what it used lately close by: in its hands, in a pocket notebook, on a shelf it shares with its team. Each step further away holds more and takes longer. On the right, time is stretched so one tick of the worker's clock lasts one second.
        </p>
      ),
    },
    {
      title: simple ? 'Already in hand' : 'Registers',
      dur: 2,
      tech: (
        <p>
          Registers are the core's working storage: 31 general 64-bit registers and 32 SIMD and floating point registers of 128 bits in the Arm64 architecture. An instruction like <code>add x0, x1, x2</code> reads and writes only registers, so it never touches memory. Compilers work hard to keep busy values here.
        </p>
      ),
      plain: (
        <p>
          The fastest place is the worker's own hands. Adding two numbers it's already holding needs no trip at all. Programs are built to keep the busiest numbers in hand.
        </p>
      ),
    },
    {
      title: simple ? 'Found in the notebook' : 'An L1 hit',
      dur: 2.2,
      tech: (
        <p>
          <code>load x</code> checks the L1 data cache first. The line holding x is there, a hit, and the value arrives in about {LAT_NS.l1} ns, roughly 3 cycles. Each {isM5 ? 'Super' : 'P'} core has its own 128 KB L1 data cache and a separate 192 KB L1 instruction cache for code.
        </p>
      ),
      plain: (
        <p>
          The worker needs x, which isn't in hand. It checks its pocket notebook first, and x is there. That takes about 3 ticks of its clock, 3 seconds on the stretched clock.
        </p>
      ),
    },
    {
      title: simple ? 'All the way to the Desk' : 'A miss to DRAM',
      dur: 4.6,
      tech: (
        <p>
          <code>load y</code> misses L1, then the cluster's 16 MB L2, then the system level cache, and goes to DRAM: about {LAT_NS.dram} ns, {humanTime(LAT_NS.dram, GHZ)} on the human clock. The cache doesn't fetch 8 bytes. It fetches the whole 128-byte line that holds y, and each level keeps a copy on the way up.
        </p>
      ),
      plain: (
        <p>
          Now y isn't in the notebook, or on the team shelf, or in the cupboard. The worker has to go all the way to the Desk, about {humanTime(LAT_NS.dram, GHZ)} on the stretched clock. It doesn't bring back one number. It brings a bundle of 128 bytes, and leaves a copy on each shelf it passes.
        </p>
      ),
    },
    {
      title: simple ? 'The neighbours come free' : 'Cache lines and spatial locality',
      dur: 5,
      tech: (
        <p>
          Lines on Apple Silicon are 128 bytes, as <code>sysctl hw.cachelinesize</code> shows. A loop over 8-byte values gets 16 per line, so one miss buys 15 hits. Programs that use memory next to what they just used, arrays rather than scattered objects, run fastest. That's spatial locality.
        </p>
      ),
      plain: (
        <p>
          The bundle holds y and its 15 neighbours. If the program reads the next number, and the next, they're already in the notebook. That's why reading a list in order is fast: one long trip, then 15 quick ones.
        </p>
      ),
    },
    {
      title: simple ? 'Recent things stay close' : 'Temporal locality and eviction',
      dur: 4.8,
      tech: (
        <p>
          Caches are small, so a new line pushes an old one out. Caches usually evict the line used least recently, a policy called LRU, or a cheap approximation of it; Apple doesn't document its policy. Data used again soon is probably still cached, which is temporal locality. A loop whose working set is bigger than a level misses that level on every pass.
        </p>
      ),
      plain: (
        <p>
          The notebook fills up, so something has to go. Usually it's the page used longest ago. Things used a moment ago stay, so using the same number again soon is quick.
        </p>
      ),
    },
    {
      title: simple ? 'A helper who fetches ahead' : 'Prefetching',
      dur: 6,
      tech: (
        <p>
          Cores watch the stream of misses. When addresses march forward by a steady step, a hardware prefetcher requests the next lines before the program asks, so sequential and strided loops hit in L1 although the data started in DRAM. Random access gives it no pattern to follow. Apple doesn't publish how its prefetchers work, so this shows the general idea.
        </p>
      ),
      plain: (
        <p>
          After a couple of trips in a row, a helper spots the pattern and starts fetching the next bundles before the worker asks. Reading in order ends up almost as fast as reading from the notebook. Jumping around at random gives the helper nothing to go on.
        </p>
      ),
    },
    {
      title: simple ? 'Down to the storage room' : 'A page fault to the SSD',
      dur: 4.4,
      tech: (
        <p>
          If the page isn't in RAM at all, the load faults and the kernel reads it from the SSD, 16 KB at a time. On this Mac an uncached random 16 KB read took about 73 µs: {humanTime(SSD_NS, GHZ)} on the human clock, against {humanTime(LAT_NS.dram, GHZ)} for DRAM. The virtual memory lab shows what the kernel does in that time.
        </p>
      ),
      plain: (
        <p>
          If z isn't even on the Desk, macOS fetches it from the storage room, the SSD. On the stretched clock that trip takes {humanTime(SSD_NS, GHZ)}. That's why a Mac short of Desk Space feels slow.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const f = frame(story.i, story.t, simple)
  const bw = s.memory.bandwidthGBs

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          isM5
            ? simple
              ? 'The cache sizes in this lab were read on an M5 like this one. Highway Speed is the traffic that got past every cache.'
              : 'Cache sizes were read with sysctl on an M5; the reader does not send them. DRAM traffic is what missed every cache level.'
            : `This lab shows the M5's cache sizes. Your ${hw.chip} differs: run sysctl hw.perflevel0 in Terminal to see its own.`
        }
      >
        <LiveStat label="Chip" value={hw.chip.replace('Apple ', '')} sub={`${hw.pCores} ${simple ? 'Fast' : 'P'} + ${hw.eCores} ${simple ? 'Eco' : 'E'} cores`} />
        <LiveStat label={simple ? 'Bundle size' : 'Cache line'} value="128 B" sub="hw.cachelinesize, M5" />
        <LiveStat label="Page size" value={pageBytes == null ? 'n/a' : `${pageBytes / KB} KB`} sub="hw.pagesize" />
        <LiveStat
          label={simple ? 'Highway Speed' : 'DRAM traffic'}
          value={bw == null ? 'n/a' : `${bw.toFixed(1)} GB/s`}
          sub={<Sparkline values={history.map((x) => x.memory.bandwidthGBs)} w={90} h={18} label="Memory bandwidth over the last minutes" />}
        />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene f={f} levels={levels} simple={simple} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <TryIt simple={simple} />

      <Deeper title={simple ? 'What this means for apps' : 'Caches on this Mac, in detail'}>
        {simple ? (
          <>
            <p>Most of the time the numbers a program needs are already close by, so the slow trips are rare. Programs that read lists in order and reuse what they just used stay fast. Programs that jump all over memory spend most of their time waiting.</p>
            <p>This Mac has two kinds of worker team. The 4 Fast Workers share a 16 MB shelf. The 6 Eco Workers share a smaller 6 MB shelf and have smaller notebooks. The cupboard and the Desk are shared by everything on the chip, including the graphics workers.</p>
          </>
        ) : (
          <>
            <p>What <code>sysctl</code> reports on this M5, per cluster:</p>
            <ul>
              <li>Super cores (<code>hw.perflevel0</code>, 4 cores): 192 KB L1 instruction and 128 KB L1 data per core, 16 MB L2 shared by all 4 (<code>cpusperl2</code> is 4).</li>
              <li>Efficiency cores (<code>hw.perflevel1</code>, 6 cores): 128 KB L1 instruction and 64 KB L1 data per core, 6 MB L2 shared by all 6.</li>
              <li>Line size 128 bytes. The plain <code>hw.l1dcachesize</code> and <code>hw.l2cachesize</code> keys report the smaller E cluster's values.</li>
              <li>The system level cache isn't listed by sysctl. It sits in front of DRAM and serves the CPU, GPU and every other block. Creative Strategies estimates about 32 MB on the base M5; Apple hasn't published it.</li>
            </ul>
            <p>
              The latencies come from a pointer chase: a random cycle through a buffer, one 128-byte line per step, so every load depends on the last and the prefetcher can't guess. Up to 96 KB took 0.7 ns a load, 2 to 14 MB took 7 to 9 ns, 16 to 20 MB took 17 to 21 ns, and 48 MB and up took 80 to 90 ns. The SLC band was noisy because everything else running shares it, and the larger sizes include TLB misses. On the M1, 7-cpu.com measured 3 cycles for L1, 18 for L2 and 18 cycles plus 91 ns for RAM, the same picture.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Igor Pavlov, 7-cpu.com: Apple M1', url: 'https://www.7-cpu.com/cpu/Apple_M1.html', note: 'Measured M1 latencies: L1 3 cycles, L2 18 cycles, RAM 18 cycles plus 91 ns. A cross-check for the M5 numbers measured here.' },
          { title: 'Chips and Cheese, iGPU cache setups compared, including M1', url: 'https://chipsandcheese.com/p/igpu-cache-setups-compared-including-m1', note: 'The M1 system level cache and how the CPU and GPU share it.' },
          { title: 'Creative Strategies, M5: it is all about the cache and tensors', url: 'https://www.creativestrategies.com/research/m5-apple-silicon-its-all-about-the-cache-and-tensors/', note: 'Estimate of about 32 MB of system level cache on the base M5. Not confirmed by Apple.' },
          { title: 'Ulrich Drepper, What every programmer should know about memory', url: 'https://www.akkadia.org/drepper/cpumemory.pdf', note: 'Free paper. Cache lines, associativity, LRU, prefetching, and how access patterns change run time.' },
          { title: 'Arpaci-Dusseau, OSTEP: Paging: Faster Translations (TLBs)', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-tlbs.pdf', note: 'Free textbook chapter with a clear aside on spatial and temporal locality.' },
          { title: 'Apple, Apple Silicon CPU Optimization Guide', url: 'https://developer.apple.com/documentation/apple-silicon/cpu-optimization-guide', note: "Apple's own guide to cache topologies and CPU structure sizes. Further reading; not quoted for numbers here." },
          { title: 'Wikipedia, AArch64', url: 'https://en.wikipedia.org/wiki/AArch64', note: '31 general-purpose 64-bit registers and 32 128-bit SIMD and floating point registers.' },
          { title: 'Wikipedia, Cache replacement policies', url: 'https://en.wikipedia.org/wiki/Cache_replacement_policies', note: 'LRU and its approximations.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac, an M5 MacBook Air: <code>sysctl hw.cachelinesize hw.perflevel0 hw.perflevel1</code> for the line and cache sizes; a C pointer chase at user-interactive QoS for the latencies; and timed <code>pread</code> calls of 16 KB at random offsets in a 512 MB file written and read with <code>F_NOCACHE</code>, median about 73 µs over 2,000 reads, for the SSD. The human scale uses 4464 MHz, the top of this Mac's P-cluster frequency table in <code>ioreg</code>.
      </p>
    </div>
  )
}
