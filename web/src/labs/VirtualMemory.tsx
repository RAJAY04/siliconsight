import { useState } from 'react'
import { bytes, num } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, lerp, phase, useSteps, type LabProps, type Step } from './kit.tsx'

// Virtual memory as one picture: two apps on the outside, each with its own page table, and the shared RAM in the
// middle. Every step moves an address through it. Coordinates are in the SVG's 960 x 540 viewBox.

const PAGE = 0x4000 // 16 KB, the Apple Silicon page; the live strip shows the reader's own hw.pagesize.
const REGIONS = ['App code', 'App code', 'Library data', 'Stack', 'Heap', 'Library code']
type Proc = 'A' | 'B'
/** Frame number, 'file' (on the SSD, not loaded) or null (never touched). */
type Map = (number | 'file' | null)[]
type FrameKind = 'A' | 'B' | 'shared' | 'kernel' | 'free'

const ROW = (v: number) => 70 + v * 52
const PAGE_X: Record<Proc, number> = { A: 20, B: 810 }
const TABLE_X: Record<Proc, number> = { A: 170, B: 690 }
const W_PAGE = 130
const W_TABLE = 100
const FRAME = (f: number) => ({ x: 330 + (f % 4) * 76, y: 70 + Math.floor(f / 4) * 76, w: 66, h: 64 })
const fc = (f: number): [number, number] => {
  const r = FRAME(f)
  return [r.x + r.w / 2, r.y + r.h / 2]
}
const TLB = { x: 380, y: 4, w: 200, h: 40 }
const KERNEL = { x: 100, y: 440, w: 760, h: 36 }
const SSD = { x: 300, y: 488, w: 360, h: 66 }
const FILE_APP: [number, number] = [390, 528]
const FILE_LIB: [number, number] = [570, 528]

// The state the story starts from. Later steps change it.
const START = {
  A: [0, 'file', 9, 6, null, 5] as Map,
  B: [2, 3, 9, 11, 12, 5] as Map,
  frames: ['A', 'kernel', 'B', 'B', 'free', 'shared', 'A', 'free', 'kernel', 'shared', 'free', 'B', 'B', 'kernel', 'free', 'free'] as FrameKind[],
  tlb: [] as string[],
}
type World = typeof START
const clone = (w: World): World => ({ A: [...w.A], B: [...w.B], frames: [...w.frames], tlb: [...w.tlb] })

/** What each step changes, applied once its animation passes `at` seconds. */
const CHANGES: { at: number; apply: (w: World) => void }[][] = [
  [],
  [],
  [{ at: 2.6, apply: (w) => w.tlb.push('Safari page 0 → frame 0') }],
  [
    {
      at: 4,
      apply: (w) => {
        w.A[4] = 4
        w.frames[4] = 'A'
      },
    },
  ],
  [
    {
      at: 4,
      apply: (w) => {
        w.A[1] = 7
        w.frames[7] = 'A'
      },
    },
  ],
  [],
  [
    {
      at: 4,
      apply: (w) => {
        w.B[2] = 10
        w.frames[10] = 'B'
      },
    },
  ],
  [],
]
function worldAt(i: number, t: number): World {
  const w = clone(START)
  CHANGES.forEach((cs, n) => cs.forEach((c) => (n < i || (n === i && t >= c.at)) && c.apply(w)))
  return w
}

const pageEdge = (p: Proc, v: number): [number, number] => [p === 'A' ? PAGE_X.A + W_PAGE : PAGE_X.B, ROW(v) + 20]
const tableIn = (p: Proc, v: number): [number, number] => [p === 'A' ? TABLE_X.A : TABLE_X.B + W_TABLE, ROW(v) + 20]
const tableOut = (p: Proc, v: number): [number, number] => [p === 'A' ? TABLE_X.A + W_TABLE : TABLE_X.B, ROW(v) + 20]
/** Page, then its row in the page table, then the frame. */
const walk = (p: Proc, v: number, f: number): [number, number][] => [pageEdge(p, v), tableIn(p, v), tableOut(p, v), fc(f)]

type Token = { at: [number, number]; label: string; kind: Proc | 'write' | 'data' | 'bad'; done?: boolean }
type Flash = { x: number; y: number; w: number; h: number; kind: 'fault' | 'hit' | 'miss' | 'ok' }
type Frame = {
  world: World
  tokens: Token[]
  flashes: Flash[]
  rows: { p: Proc; v: number }[]
  frames: number[]
  kernel: string | null
  split: number
  crash: number
  zeros: number
  copy: number
  fileRead: { from: [number, number]; to: number; k: number } | null
}

/** Everything that moves at time t of step i. */
function frame(i: number, t: number, simple: boolean): Frame {
  const out: Frame = { world: worldAt(i, t), tokens: [], flashes: [], rows: [], frames: [], kernel: null, split: 0, crash: 0, zeros: 0, copy: 0, fileRead: null }
  // A leg that hands its token on to a later leg passes `until`, the time that leg starts.
  const tok = (p: Proc, path: [number, number][], from: number, to: number, label: string, kind: Token['kind'] = p, until = Infinity) => {
    if (t < from || t >= until) return
    const k = phase(t, from, to)
    out.tokens.push({ at: along(path, k), label, kind, done: k >= 1 })
  }
  const fault = (p: Proc, v: number, at: number, until: number) => {
    if (t >= at && t < until) out.flashes.push({ x: TABLE_X[p], y: ROW(v), w: W_TABLE, h: 40, kind: 'fault' })
  }
  switch (i) {
    case 0:
      out.rows.push({ p: 'A', v: 3 }, { p: 'B', v: 3 })
      tok('A', walk('A', 3, 6), 0.2, 2.4, '0xCA3C')
      tok('B', walk('B', 3, 11), 0.6, 2.8, '0xCA3C')
      if (t > 2.4) out.frames.push(6)
      if (t > 2.8) out.frames.push(11)
      break
    case 1:
      out.rows.push({ p: 'A', v: 3 })
      out.split = phase(t, 0.2, 1.2)
      tok('A', walk('A', 3, 6), 1.2, 4, '0xCA3C')
      if (t > 4) out.frames.push(6)
      break
    case 2: {
      const tlbIn: [number, number] = [TLB.x + 10, TLB.y + TLB.h / 2]
      // A miss: ask the TLB, then walk the table, then reach the frame. Then the same page again: a hit.
      if (t < 3.4) {
        tok('A', [pageEdge('A', 0), [300, 32], tlbIn], 0.2, 1.0, '0x0120', 'A', 1.6)
        if (t >= 1.0 && t < 1.6) out.flashes.push({ ...TLB, kind: 'miss' })
        tok('A', [tlbIn, [300, 32], tableIn('A', 0), tableOut('A', 0), fc(0)], 1.6, 3.2, '0x0120')
        if (t > 1.6) out.rows.push({ p: 'A', v: 0 })
      } else {
        tok('A', [pageEdge('A', 0), [300, 32], tlbIn], 3.6, 4.2, '0x0180', 'A', 4.2)
        if (t >= 4.2 && t < 4.9) out.flashes.push({ ...TLB, kind: 'hit' })
        tok('A', [tlbIn, [TLB.x + TLB.w / 2, TLB.y + TLB.h], fc(0)], 4.2, 4.8, '0x0180')
      }
      if (t > 3.2) out.frames.push(0)
      break
    }
    case 3:
      out.rows.push({ p: 'A', v: 4 })
      tok('A', [pageEdge('A', 4), tableIn('A', 4)], 0.2, 1.2, '0x10040', 'A', 4.5)
      fault('A', 4, 1.2, 4)
      if (t >= 1.2 && t < 4.4) out.kernel = simple ? 'Nothing here yet. macOS grabs an empty spot and wipes it clean.' : 'Page fault: no page behind this address yet. Take a free frame, fill it with zeros, map it.'
      if (t >= 1.8) out.frames.push(4)
      out.zeros = phase(t, 2, 3.4)
      tok('A', walk('A', 4, 4), 4.5, 6, '0x10040')
      break
    case 4:
      out.rows.push({ p: 'A', v: 1 })
      tok('A', [pageEdge('A', 1), tableIn('A', 1)], 0.2, 1.2, '0x4200', 'A', 4.5)
      fault('A', 1, 1.2, 4)
      if (t >= 1.2 && t < 4.4) out.kernel = simple ? "This part of the app is still on the SSD. macOS copies it in." : "Page fault: this page lives in the app's file. Read it from the SSD into a free frame."
      if (t >= 1.8 && t < 4) out.fileRead = { from: FILE_APP, to: 7, k: phase(t, 1.8, 3.8) }
      if (t >= 1.8) out.frames.push(7)
      tok('A', walk('A', 1, 7), 4.5, 6, '0x4200')
      break
    case 5:
      out.rows.push({ p: 'A', v: 5 }, { p: 'B', v: 5 })
      tok('A', walk('A', 5, 5), 0.2, 2.2, '0x14000')
      tok('B', walk('B', 5, 5), 0.2, 2.2, '0x14000')
      if (t > 2.2) out.frames.push(5)
      break
    case 6:
      out.rows.push({ p: 'B', v: 2 })
      tok('B', [pageEdge('B', 2), tableIn('B', 2)], 0.2, 1.2, 'write', 'write', 4.5)
      fault('B', 2, 1.2, 4)
      if (t >= 1.2 && t < 4.4) out.kernel = simple ? 'Two apps share this page, and Notes wants to change it. macOS gives Notes its own copy first.' : 'Page fault: write to a copy-on-write page. Copy frame 9 to a free frame, point Notes at the copy.'
      if (t >= 1.8) out.frames.push(9, 10)
      out.copy = t >= 1.8 && t < 4.2 ? phase(t, 1.8, 3.6) : 0
      tok('B', walk('B', 2, 10), 4.5, 6, 'write', 'write')
      break
    case 7:
      tok('A', [pageEdge('A', 6), [TABLE_X.A + 4, ROW(6) + 20]], 0.2, 1.2, '0x0', 'bad')
      if (t >= 1.2) out.flashes.push({ x: TABLE_X.A, y: ROW(6), w: W_TABLE, h: 40, kind: 'fault' })
      if (t >= 1.4) out.kernel = simple ? 'There is nothing at this address and never will be. macOS stops the app: it has crashed.' : 'No mapping at all, and none allowed: the kernel sends EXC_BAD_ACCESS (SIGSEGV) and the app crashes.'
      out.crash = phase(t, 1.6, 2.4)
      break
  }
  return out
}

const tableText = (m: number | 'file' | null, simple: boolean) => (m === null ? (simple ? 'nothing yet' : 'not mapped') : m === 'file' ? (simple ? 'still on SSD' : 'in file') : `frame ${m}`)

function Scene({ f, names }: { f: Frame; names: Record<Proc, string> }) {
  const simple = useSimple()
  const { world } = f
  const lit = (p: Proc, v: number) => f.rows.some((r) => r.p === p && r.v === v)
  const shake = f.crash ? Math.sin(f.crash * 40) * 4 * (1 - f.crash) : 0
  return (
    <svg className="vm-scene" viewBox="0 0 960 560" role="img" aria-label="Two apps, their page tables, and the RAM frames they map to">
      {/* Mapping lines from each table row to its frame, faint, so the whole map reads at a glance. */}
      {(['A', 'B'] as Proc[]).map((p) =>
        world[p].map((m, v) => {
          if (typeof m !== 'number') return null
          const [x1, y1] = tableOut(p, v)
          const [x2, y2] = fc(m)
          return <path key={`${p}${v}`} className={`vm-link vm-${p} ${lit(p, v) ? 'lit' : ''}`} d={`M ${x1} ${y1} C ${lerp(x1, x2, 0.5)} ${y1}, ${lerp(x1, x2, 0.5)} ${y2}, ${x2} ${y2}`} />
        }),
      )}

      {(['A', 'B'] as Proc[]).map((p) => (
        <g key={p} className={`vm-proc vm-${p} ${p === 'A' && f.crash ? 'crashed' : ''}`} transform={p === 'A' ? `translate(${shake} 0)` : undefined}>
          <text className="vm-head" x={PAGE_X[p] + W_PAGE / 2} y={44} textAnchor="middle">
            {names[p]}
          </text>
          <text className="vm-sub" x={TABLE_X[p] + W_TABLE / 2} y={44} textAnchor="middle">
            {simple ? 'its map' : 'page table'}
          </text>
          {REGIONS.map((r, v) => (
            <g key={v}>
              <rect className={`vm-page ${lit(p, v) ? 'lit' : ''}`} x={PAGE_X[p]} y={ROW(v)} width={W_PAGE} height={40} rx={7} />
              <text className="vm-page-n" x={PAGE_X[p] + 10} y={ROW(v) + 17}>
                {simple ? `spot ${v}` : `page ${v}`}
              </text>
              <text className="vm-page-r" x={PAGE_X[p] + 10} y={ROW(v) + 32}>
                {r}
              </text>
              <rect className={`vm-row ${lit(p, v) ? 'lit' : ''} ${world[p][v] === null ? 'empty' : world[p][v] === 'file' ? 'file' : ''}`} x={TABLE_X[p]} y={ROW(v)} width={W_TABLE} height={40} rx={6} />
              <text className="vm-row-t" x={TABLE_X[p] + W_TABLE / 2} y={ROW(v) + 25} textAnchor="middle">
                {tableText(world[p][v], simple)}
              </text>
            </g>
          ))}
          {/* The address no table covers, used by the last step. */}
          {p === 'A' && (
            <g className="vm-void">
              <rect x={PAGE_X.A} y={ROW(6)} width={W_PAGE} height={40} rx={7} />
              <text x={PAGE_X.A + 10} y={ROW(6) + 25}>
                {simple ? 'address 0' : 'address 0x0'}
              </text>
            </g>
          )}
        </g>
      ))}

      <text className="vm-head" x={480} y={66} textAnchor="middle">
        {simple ? 'The real desk (RAM), in 16 KB spots' : 'Physical RAM, in 16 KB frames'}
      </text>
      {world.frames.map((k, n) => {
        const r = FRAME(n)
        const hot = f.frames.includes(n)
        return (
          <g key={n} className={`vm-frame k-${k} ${hot ? 'hot' : ''}`}>
            <rect x={r.x} y={r.y + 8} width={r.w} height={r.h - 8} rx={8} />
            <text className="vm-frame-n" x={r.x + 7} y={r.y + 22}>
              {n}
            </text>
            <text className="vm-frame-k" x={r.x + r.w / 2} y={r.y + 50} textAnchor="middle">
              {k === 'A' ? names.A : k === 'B' ? names.B : k === 'shared' ? 'shared' : k === 'kernel' ? 'kernel' : 'free'}
            </text>
          </g>
        )
      })}
      {f.zeros > 0 && (
        <text className="vm-zeros" x={fc(4)[0]} y={fc(4)[1] - 4} textAnchor="middle" opacity={f.zeros}>
          {'0000'.slice(0, Math.ceil(f.zeros * 4))}
        </text>
      )}
      {f.copy > 0 && (
        <rect className="vm-ghost" x={lerp(FRAME(9).x, FRAME(10).x, f.copy)} y={FRAME(9).y + 8} width={66} height={56} rx={8} />
      )}

      <g className={`vm-tlb ${f.flashes.some((x) => x.kind === 'hit') ? 'hit' : f.flashes.some((x) => x.kind === 'miss') ? 'miss' : ''}`}>
        <rect x={TLB.x} y={TLB.y} width={TLB.w} height={TLB.h} rx={8} />
        <text className="vm-tlb-t" x={TLB.x + TLB.w / 2} y={TLB.y + 16} textAnchor="middle">
          {simple ? 'Cheat sheet (TLB)' : 'TLB: recent translations'}
        </text>
        <text className="vm-tlb-e" x={TLB.x + TLB.w / 2} y={TLB.y + 32} textAnchor="middle">
          {world.tlb.length ? world.tlb.join(', ') : 'empty'}
        </text>
      </g>

      <g className={`vm-kernel ${f.kernel ? 'on' : ''}`} opacity={1 - f.split}>
        <rect x={KERNEL.x} y={KERNEL.y} width={KERNEL.w} height={KERNEL.h} rx={8} />
        <text x={KERNEL.x + 14} y={KERNEL.y + 23}>
          <tspan className="vm-kernel-k">{simple ? 'macOS' : 'Kernel'}</tspan> {f.kernel ?? (simple ? 'waits until an app needs help' : 'idle: translation is all hardware until something goes wrong')}
        </text>
      </g>

      <g className="vm-ssd">
        <rect x={SSD.x} y={SSD.y} width={SSD.w} height={SSD.h} rx={10} />
        <text className="vm-sub" x={SSD.x + 14} y={SSD.y + 18}>
          SSD
        </text>
        <rect className="vm-file" x={FILE_APP[0] - 70} y={FILE_APP[1] - 14} width={140} height={28} rx={5} />
        <text className="vm-file-t" x={FILE_APP[0]} y={FILE_APP[1] + 5} textAnchor="middle">
          {names.A} app file
        </text>
        <rect className="vm-file" x={FILE_LIB[0] - 70} y={FILE_LIB[1] - 14} width={140} height={28} rx={5} />
        <text className="vm-file-t" x={FILE_LIB[0]} y={FILE_LIB[1] + 5} textAnchor="middle">
          {simple ? 'shared library file' : 'dyld shared cache'}
        </text>
      </g>
      {f.fileRead && (
        <g className="vm-token data" transform={`translate(${along([f.fileRead.from, [f.fileRead.from[0], 380], fc(f.fileRead.to)], f.fileRead.k).join(' ')})`}>
          <rect x={-34} y={-11} width={68} height={22} rx={11} />
          <text y={4} textAnchor="middle">
            16 KB
          </text>
        </g>
      )}

      {f.flashes
        .filter((x) => x.kind === 'fault')
        .map((x, n) => (
          <g key={n} className="vm-fault">
            <rect x={x.x - 3} y={x.y - 3} width={x.w + 6} height={x.h + 6} rx={8} />
            <text x={x.x + x.w / 2} y={x.y - 8} textAnchor="middle">
              {simple ? 'stuck!' : 'fault'}
            </text>
          </g>
        ))}

      {f.split > 0 && <Split k={f.split} />}

      {f.tokens.map((tk, n) => (
        <g key={n} className={`vm-token ${tk.kind} ${tk.done ? 'done' : ''}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
          <rect x={-tk.label.length * 4.2 - 10} y={-11} width={tk.label.length * 8.4 + 20} height={22} rx={11} />
          <text y={4} textAnchor="middle">
            {tk.label}
          </text>
        </g>
      ))}

      {f.crash > 0 && (
        <g className="vm-crash" opacity={f.crash}>
          <rect x={14} y={20} width={300} height={360} rx={12} />
          <text x={164} y={190} textAnchor="middle">
            {names.A} quit unexpectedly
          </text>
          <text className="vm-crash-sub" x={164} y={212} textAnchor="middle">
            EXC_BAD_ACCESS (SIGSEGV)
          </text>
        </g>
      )}
    </svg>
  )
}

/** Step 2's overlay: the 16 bits of 0xCA3C, cut into page number and offset, then glued onto frame 6. */
function Split({ k }: { k: number }) {
  const simple = useSimple()
  const bits = (0xca3c).toString(2).padStart(16, '0')
  const phys = (6 * PAGE + 0xa3c).toString(2).padStart(17, '0')
  const x0 = 222
  const bw = 26
  return (
    <g className="vm-split" opacity={k}>
      <rect x={170} y={384} width={620} height={152} rx={12} />
      <text className="vm-split-l" x={190} y={410}>
        {simple ? 'The address the app uses' : 'Virtual address 0xCA3C'}
      </text>
      {[...bits].map((b, n) => (
        <g key={n} className={n < 2 ? 'vpn' : 'off'}>
          <rect x={x0 + n * bw + (n >= 2 ? 10 : 0)} y={418} width={bw - 3} height={26} rx={4} />
          <text x={x0 + n * bw + (n >= 2 ? 10 : 0) + (bw - 3) / 2} y={436} textAnchor="middle">
            {b}
          </text>
        </g>
      ))}
      <text className="vm-split-tag vpn" x={x0 + bw - 1} y={458} textAnchor="middle">
        {simple ? 'which spot: 3' : 'page 3'}
      </text>
      <text className="vm-split-tag off" x={x0 + 10 + 9 * bw} y={458} textAnchor="middle">
        {simple ? 'where inside the spot: the last 14 digits stay the same' : 'offset 0xA3C: the low 14 bits, because 2^14 = 16,384 = one page'}
      </text>
      <text className="vm-split-l" x={190} y={490}>
        {simple ? 'The real place in RAM' : 'Physical 0x18A3C'}
      </text>
      {[...phys].map((b, n) => (
        <g key={n} className={n < 3 ? 'pfn' : 'off'}>
          <rect x={x0 - bw + n * bw + (n >= 3 ? 10 : 0)} y={498} width={bw - 3} height={26} rx={4} />
          <text x={x0 - bw + n * bw + (n >= 3 ? 10 : 0) + (bw - 3) / 2} y={516} textAnchor="middle">
            {b}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Translate any address by hand against the map as it stands at the end of the story. */
function Translator({ names }: { names: Record<Proc, string> }) {
  const simple = useSimple()
  const [p, setP] = useState<Proc>('A')
  const [text, setText] = useState('0xCA3C')
  const end = worldAt(CHANGES.length, 0)
  const n = /^(0x)?[0-9a-f]{1,8}$/i.test(text.trim()) ? parseInt(text.trim().replace(/^0x/i, ''), 16) : null
  const v = n == null ? null : Math.floor(n / PAGE)
  const off = n == null ? 0 : n % PAGE
  const m = v == null ? undefined : v < REGIONS.length ? end[p][v] : null
  const hex = (x: number) => '0x' + x.toString(16).toUpperCase()
  let verdict: string
  let cls = ''
  if (n == null) verdict = 'Type a hex address such as 0xCA3C.'
  else if (typeof m === 'number') {
    verdict = `${names[p]}'s page ${v}, offset ${hex(off)} → frame ${m} → physical ${hex(m * PAGE + off)}`
    cls = 'ok'
  } else if (m === 'file') verdict = `Page ${v} is still in the app's file: touching it is a page fault, and macOS reads it in from the SSD.`
  else if (v != null && v < REGIONS.length) verdict = `Page ${v} has never been touched: the first touch is a page fault, and macOS hands over a zero-filled frame.`
  else {
    verdict = `Page ${v} is not in ${names[p]}'s map at all. Touching it crashes the app with EXC_BAD_ACCESS.`
    cls = 'bad'
  }
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: look up an address' : 'Try it: translate an address'}</h3>
      <p className="fine">
        {simple
          ? 'Pick an app and type an address. Each spot is 16 KB, which is 0x4000 in hex, so 0x0 to 0x3FFF is spot 0, 0x4000 to 0x7FFF is spot 1, and so on.'
          : 'Uses the page tables as they stand after the story. Pages are 0x4000 bytes, so the page number is the address divided by 0x4000 and the offset is the remainder.'}
      </p>
      <div className="lab-try-row">
        <div className="lab-seg" role="group" aria-label="App">
          {(['A', 'B'] as Proc[]).map((x) => (
            <button key={x} type="button" aria-pressed={p === x} onClick={() => setP(x)}>
              {names[x]}
            </button>
          ))}
        </div>
        <label className="lab-field">
          <span>{simple ? 'Address' : 'Virtual address'}</span>
          <input value={text} onChange={(e) => setText(e.currentTarget.value)} spellCheck={false} autoComplete="off" inputMode="text" className="num" />
        </label>
      </div>
      <p className={`lab-verdict ${cls}`} aria-live="polite">
        {verdict}
      </p>
    </section>
  )
}

export default function VirtualMemory({ s, history, demo }: LabProps) {
  const simple = useSimple()
  const names: Record<Proc, string> = { A: 'Safari', B: 'Notes' }
  const pg = s.paging ?? null
  const pageBytes = pg?.pageBytes ?? null
  const per = (v: number | null | undefined) => (v == null ? '' : ` That's ${num(v)} a second on this Mac right now.`)
  const steps: Step[] = [
    {
      title: simple ? 'Two apps, one address' : 'Same address, different memory',
      dur: 3.2,
      tech: (
        <p>
          Safari and Notes both read address <code>0xCA3C</code>. They get different bytes. Each process has its own page table, a map from its virtual pages to physical frames of RAM, so the same virtual address lands in frame 6 for Safari and frame 11 for Notes. Neither app can even name the other's memory.
        </p>
      ),
      plain: (
        <p>
          Safari and Notes both ask for the thing at spot <code>0xCA3C</code>. They get different things. Each app has its own private map of the desk, so the same spot number leads each one to a different place. One app can't reach into another's papers.
        </p>
      ),
    },
    {
      title: simple ? 'Cutting the address in two' : 'Page number and offset',
      dur: 4.6,
      tech: (
        <p>
          The hardware cuts the address in two. Pages here are 16 KB, which is 2<sup>14</sup> bytes, so the low 14 bits are the offset inside the page and pass through unchanged. Only the bits above them, the page number, get looked up. Page 3 maps to frame 6, so <code>0xCA3C</code> becomes <code>6 × 0x4000 + 0xA3C = 0x18A3C</code>.
        </p>
      ),
      plain: (
        <p>
          The Mac reads the spot number in two halves. The first half says which 16 KB box to use. The second half says where inside the box, and that part never changes. So the Mac only has to look up the box, not every single byte.
        </p>
      ),
    },
    {
      title: simple ? 'A cheat sheet for speed' : 'The TLB',
      dur: 5,
      tech: (
        <p>
          Walking the page table costs extra memory reads on every access, which would be far too slow. So each core keeps a small cache of recent translations, the translation lookaside buffer. The first read of page 0 misses and walks the table. The second read of the same page hits, and the walk never happens. Programs that stay inside a few pages at a time run fastest.
        </p>
      ),
      plain: (
        <p>
          Looking at the map every time would be slow. So each worker keeps a tiny cheat sheet of the last few lookups. The first time, the worker has to check the map. The next time, the answer is already on the cheat sheet and it goes straight there.
        </p>
      ),
    },
    {
      title: simple ? 'A brand new spot' : 'Page fault: zero fill',
      dur: 6.2,
      tech: (
        <p>
          Safari's heap grows into page 4, which has never been touched, so the table has no entry. The hardware stops and raises a page fault. The kernel finds a free frame, fills it with zeros so no old data leaks from another app, maps it, and replays the instruction, which now succeeds. Memory an app asks for costs nothing until it's touched.{per(pg?.zeroFills)}
        </p>
      ),
      plain: (
        <p>
          Safari needs more room and reaches for spot 4, which it has never used. The Mac stops it for a moment, takes an empty part of the desk, wipes it clean so no other app's old papers show through, and lets Safari carry on. Apps only get desk space when they actually use it.{per(pg?.zeroFills)}
        </p>
      ),
    },
    {
      title: simple ? 'Fetched from the SSD' : 'Page fault: read from a file',
      dur: 6.2,
      tech: (
        <p>
          Page 1 holds part of Safari's code, which macOS never loaded, because launching an app maps its file without reading it. The first jump into that code faults, the kernel reads those 16 KB from the SSD into a free frame, and the jump is replayed. That's why an app's first use of a feature can stutter while later uses don't.{per(pg?.pageins)}
        </p>
      ),
      plain: (
        <p>
          When you open an app, the Mac doesn't copy the whole thing off the SSD. It only fetches each piece the first time it's needed. Here Safari needs a bit of its code that's still on the SSD, so the Mac fetches that one piece.{per(pg?.pageins)}
        </p>
      ),
    },
    {
      title: simple ? 'One copy, two apps' : 'Shared pages',
      dur: 3.2,
      tech: (
        <p>
          Both apps use the same system libraries. macOS keeps them in one file, the dyld shared cache, and every process maps its read-only pages to the same frames. Frame 5 appears in both page tables, so the code exists once in RAM however many apps use it. Run <code>vmmap</code> on any app and you'll see the shared cache marked <code>SM=COW</code>.
        </p>
      ),
      plain: (
        <p>
          Lots of apps use the same building blocks from macOS. Instead of each app keeping its own copy, they all point at one copy on the desk. Both maps lead to spot 5, so it only takes up room once.
        </p>
      ),
    },
    {
      title: simple ? 'Copy only when you change it' : 'Copy on write',
      dur: 6.2,
      tech: (
        <p>
          Frame 9 holds library data both apps start with. It's shared, but marked read-only and copy on write. When Notes writes to it, the write faults. The kernel copies the frame, points Notes's table at the copy, and replays the write. Safari still sees the original. Sharing costs nothing until somebody changes something.
        </p>
      ),
      plain: (
        <p>
          Spot 9 is shared too, but Notes now wants to change it. Changing a shared page would mess up Safari, so the Mac makes Notes its own copy first, then lets it write. Safari keeps the original. Copies are only made when someone actually changes something.
        </p>
      ),
    },
    {
      title: simple ? 'Reaching for nothing' : 'No mapping at all: a crash',
      dur: 3,
      tech: (
        <p>
          A bug makes Safari read address 0, a null pointer. Every 64-bit Mac app starts with a 4 GB region called <code>__PAGEZERO</code> that maps nothing and can't be touched, exactly so this crashes at once instead of quietly reading junk. There's nothing for the kernel to load, so it ends the process with <code>EXC_BAD_ACCESS</code>. The same mechanism that makes memory private also contains the damage: Notes keeps running.
        </p>
      ),
      plain: (
        <p>
          A mistake in Safari makes it reach for spot 0. Nothing is there, on purpose: every app starts with a big fenced-off area at the bottom of its map. So instead of reading rubbish, Safari stops right away. That's a crash. Notes keeps working, because its map is its own.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const f = frame(story.i, story.t, simple)
  const faults = history.map((x) => x.paging?.faults ?? null)

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          pg == null
            ? 'This reader is older than the paging update, so it sends no paging counters. Pull the repo and run ./run.sh again.'
            : simple
              ? 'Every "stuck" moment in the story below is one of these. A busy Mac handles thousands a second without you noticing.'
              : 'Counted by the kernel in host_statistics64, per second since the last sample. Each fault in the story is one tick of these counters.'
        }
      >
        <LiveStat label={simple ? 'Box size' : 'Page size'} value={pageBytes == null ? 'n/a' : bytes(pageBytes, 0)} sub={simple ? 'every spot on the desk' : 'hw.pagesize'} />
        <LiveStat label={simple ? 'Stuck moments' : 'Page faults'} value={pg?.faults == null ? 'n/a' : `${num(pg.faults)}/s`} sub={<Sparkline values={faults} w={90} h={18} label="Page faults over the last minutes" />} hot={(pg?.faults ?? 0) > 20000} />
        <LiveStat label={simple ? 'Fresh spots' : 'Zero fills'} value={pg?.zeroFills == null ? 'n/a' : `${num(pg.zeroFills)}/s`} sub={simple ? 'new, wiped clean' : 'step 4'} />
        <LiveStat label={simple ? 'Fetched from SSD' : 'Page-ins'} value={pg?.pageins == null ? 'n/a' : `${num(pg.pageins)}/s`} sub={pg?.pageins == null || pageBytes == null ? 'step 5' : `${bytes(pg.pageins * pageBytes)}/s, step 5`} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene f={f} names={names} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <Translator names={names} />

      <Deeper title={simple ? 'Why bother with all this?' : 'Why virtual memory exists'}>
        {simple ? (
          <>
            <p>Without private maps, any app could read your passwords out of another app, and one buggy app could scribble over everything. Maps fix that, and they bring three bonuses.</p>
            <ul>
              <li>Apps only use desk space for what they actually touch.</li>
              <li>Common building blocks are kept once and shared.</li>
              <li>The Mac can quietly move rarely used things off the desk and fetch them back later. The next lab, about squeezing and swapping, shows how.</li>
            </ul>
          </>
        ) : (
          <>
            <p>Virtual memory gives every process the same clean, private address space and lets the kernel decide, page by page, where each piece really lives. Four things fall out of that one idea.</p>
            <ul>
              <li>Isolation. A process can only reach frames its own table points to, and the table is the kernel's to edit.</li>
              <li>Lazy allocation. Asking for a gigabyte costs nothing until the pages are touched, one fault at a time.</li>
              <li>Sharing. Libraries, the shared cache and memory-mapped files exist once in RAM, mapped into many processes.</li>
              <li>Overcommit. Pages can be compressed or written to swap and faulted back in later, so the total of every app's memory can exceed the RAM. The next lab covers that.</li>
            </ul>
            <p>
              On this Mac, translation is the CPU's job, done in hardware by the MMU on every load and store. The kernel only steps in on a fault. Run <code>vmmap $$</code> in Terminal to see the map of your shell: <code>__PAGEZERO</code> first, then the program, libraries, heap and stack, each with its permissions.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Apple, About the Virtual Memory System', url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/ManagingMemory/Articles/AboutMemory.html', note: 'Pages, page faults, paging in and out, and copy-on-write VM objects, from Apple. Older and written for Intel-era 4 KB pages; Apple Silicon uses 16 KB, as hw.pagesize shows.' },
          { title: 'Arpaci-Dusseau, OSTEP: Paging: Introduction', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf', note: 'Free textbook chapter. Virtual page numbers, offsets and page tables, with worked examples.' },
          { title: 'Arpaci-Dusseau, OSTEP: Paging: Faster Translations (TLBs)', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-tlbs.pdf', note: 'Why the TLB exists and what a hit and a miss cost.' },
          { title: 'Arpaci-Dusseau, OSTEP: Beyond Physical Memory: Mechanisms', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys.pdf', note: 'Page faults and what the OS does on one.' },
          { title: 'Apple XNU source, vm_fault.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_fault.c', note: "The macOS kernel's page fault handler: zero fill, copy on write, and paging in." },
          { title: 'Apple, Investigating memory access crashes', url: 'https://developer.apple.com/documentation/xcode/investigating-memory-access-crashes', note: 'What EXC_BAD_ACCESS means and why a null pointer crashes.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>sysctl hw.pagesize</code> prints 16384, and <code>otool -l /bin/ls</code> shows <code>__PAGEZERO</code> with a vmsize of 0x100000000, which is 4 GB.
      </p>
    </div>
  )
}
