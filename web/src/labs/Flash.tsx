import { useState } from 'react'
import { memGB, rate } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { amplification, apply, fold, makeFtl, replay, trim, viewOf, write, type FileOp, type FtlEvent, type View } from './ftl.ts'
import './Flash.css'

// One NAND die drawn as four blocks of six pages, run by the same FTL the simulator uses. Each step plays part of
// a scripted history, one flash event at a time. Coordinates are in the SVG's 960 x 560 viewBox.

const SB = 4
const SP = 6
const SL = 12
const NAMES = ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'C0', 'C1', 'C2', 'C3']
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)

/** Each step's writes, as logical pages; 't4' trims logical page 4. Steps run in order on one disk. */
const SCRIPTS: (number | string)[][] = [[], [], range(0, 8), [1, 2], [...range(4, 12), 1], Array.from({ length: 90 }, (_, i) => (i % 2 ? 2 : 1)), ['t4', 't5', 't6', 't7'], [], []]
const STORY = (() => {
  const f = makeFtl(SB, SP, SL)
  return SCRIPTS.map((ops) => {
    const before = viewOf(f)
    const at = f.log.length
    for (const o of ops) typeof o === 'number' ? write(f, o) : trim(f, Number(o.slice(1)))
    return { before, events: f.log.slice(at) }
  })
})()

const BX = (b: number) => 352 + b * 150
const PY = (p: number) => 74 + p * 50
const cell = (ppn: number) => ({ x: BX(Math.floor(ppn / SP)), y: PY(ppn % SP), w: 134, h: 42 })
const mid = (ppn: number): [number, number] => {
  const c = cell(ppn)
  return [c.x + c.w / 2, c.y + c.h / 2]
}
const IN: [number, number] = [640, 30]
/** Ciphertext stand-in: a fixed scramble of the page's name. */
const hex = (n: number) => ((n * 2654435761 + 977) >>> 0).toString(16).slice(0, 6)

type Frame = { view: View; ev: FtlEvent | null; k: number; from: [number, number] | null }

function frameAt(i: number, t: number, dur: number): Frame {
  const { before, events } = STORY[i]
  if (!events.length) return { view: before, ev: null, k: 0, from: null }
  const slot = (dur - 1.2) / events.length
  const x = Math.max(0, (t - 0.6) / slot)
  const n = Math.min(events.length, Math.floor(x))
  const ev = n < events.length ? events[n] : null
  let from: [number, number] | null = null
  if (ev?.kind === 'program') {
    const prev = events[n - 1]
    from = ev.gc && prev?.kind === 'stale' ? mid(prev.ppn) : IN
  }
  return { view: fold(before, events, n, SP), ev: slot > 0.08 ? ev : null, k: x - n, from }
}

/** A bell curve for one charge level on the voltage axis. */
function bell(cx: number, sd: number, base: number, h: number) {
  const pts = range(0, 25).map((j) => {
    const u = (j - 12) / 4
    return `${(cx + u * sd).toFixed(1)},${(base - h * Math.exp((-u * u) / 2)).toFixed(1)}`
  })
  return `M ${pts.join(' L ')}`
}

const KINDS = [
  { name: 'SLC', bits: 1 },
  { name: 'MLC', bits: 2 },
  { name: 'TLC', bits: 3 },
  { name: 'QLC', bits: 4 },
]

function Levels({ i, t }: { i: number; t: number }) {
  const simple = useSimple()
  const ax = { x: 470, w: 450 }
  // Step 2 walks a marker through QLC's 16 levels while the cell on the left fills to match.
  const q = Math.floor(phase(t, 0.5, 5.4) * 15.99)
  return (
    <g>
      <text className="fl-head" x={352} y={40}>
        {simple ? 'How full the cell is, from empty to full' : 'Threshold voltage of one cell'}
      </text>
      {KINDS.map((k, r) => {
        const L = 2 ** k.bits
        const y = 150 + r * 96
        const show = i === 0 ? (r === 0 ? 1 : 0.25) : phase(t, r * 0.6, r * 0.6 + 0.5) * 0.75 + 0.25
        const sd = ax.w / L / 6
        return (
          <g key={k.name} opacity={show} className={i === 1 && r === 3 ? 'fl-qlc' : ''}>
            <text className="fl-kind" x={352} y={y - 26}>
              {k.name}
            </text>
            <text className="fl-sub" x={352} y={y - 8}>
              {k.bits} {k.bits === 1 ? 'bit' : 'bits'}, {L} levels
            </text>
            <line className="fl-axis" x1={ax.x} x2={ax.x + ax.w} y1={y} y2={y} />
            {range(0, L).map((j) => {
              const cx = ax.x + ((j + 0.5) * ax.w) / L
              const on = i === 1 && r === 3 && j === q
              return <path key={j} className={`fl-bell ${on ? 'on' : ''}`} d={bell(cx, sd, y, 50)} />
            })}
            {range(1, L).map((j) => (
              <line key={j} className="fl-ref" x1={ax.x + (j * ax.w) / L} x2={ax.x + (j * ax.w) / L} y1={y - 56} y2={y + 4} />
            ))}
          </g>
        )
      })}
      <text className="fl-sub" x={ax.x} y={468}>
        {simple ? 'empty' : 'low voltage, erased'}
      </text>
      <text className="fl-sub" x={ax.x + ax.w} y={468} textAnchor="end">
        {simple ? 'full' : 'high voltage'}
      </text>
      <text className="fl-sub" x={ax.x} y={492}>
        {simple ? 'Dashed lines: where the chip draws the line between one level and the next.' : 'Dashed lines: the reference voltages a read compares against.'}
      </text>
    </g>
  )
}

function Cell({ fill }: { fill: number }) {
  const simple = useSimple()
  const dots = Math.round(fill * 15)
  return (
    <g>
      <text className="fl-head" x={30} y={40}>
        {simple ? 'One cell, cut open' : 'One flash cell, in cross-section'}
      </text>
      <rect className="fl-gate" x={60} y={90} width={200} height={50} rx={6} />
      <text x={160} y={120} textAnchor="middle">
        {simple ? 'top plate' : 'control gate'}
      </text>
      <rect className="fl-trap" x={60} y={160} width={200} height={60} rx={6} />
      <text className="fl-sub" x={160} y={238} textAnchor="middle">
        {simple ? 'charge is trapped in here' : 'charge storage layer'}
      </text>
      {range(0, 15).map((j) => (
        <circle key={j} className={`fl-e ${j < dots ? 'on' : ''}`} cx={78 + (j % 8) * 23} cy={176 + Math.floor(j / 8) * 26} r={6} />
      ))}
      <rect className="fl-chan" x={40} y={262} width={240} height={46} rx={6} />
      <text x={160} y={290} textAnchor="middle">
        {simple ? 'channel' : 'channel, source to drain'}
      </text>
      <text className="fl-sub" x={30} y={350}>
        {simple ? 'More trapped charge makes the cell' : 'Trapped electrons raise the voltage'}
      </text>
      <text className="fl-sub" x={30} y={370}>
        {simple ? 'harder to switch on. Reading asks:' : 'needed to turn the cell on. A read'}
      </text>
      <text className="fl-sub" x={30} y={390}>
        {simple ? 'how hard was it?' : 'tests which band it falls in.'}
      </text>
      <text className="fl-sub" x={30} y={420}>
        {simple ? 'The charge stays with the power off.' : 'Insulated, it holds with no power.'}
      </text>
    </g>
  )
}

function MapTable({ view, ev }: { view: View; ev: FtlEvent | null }) {
  const simple = useSimple()
  const at = (lpn: number) => view.pages.findIndex((p) => p.state === 'live' && p.lpn === lpn)
  const hot = ev?.kind === 'program' ? ev.lpn : null
  return (
    <g>
      <text className="fl-head" x={30} y={40}>
        {simple ? "The drive's address book" : 'FTL map: logical → physical'}
      </text>
      {NAMES.map((n, l) => {
        const p = at(l)
        return (
          <g key={n} className={`fl-row ${hot === l ? 'hot' : ''} ${p < 0 ? 'none' : ''}`}>
            <rect x={30} y={60 + l * 30} width={270} height={26} rx={5} />
            <text className="fl-mono" x={42} y={78 + l * 30}>
              {simple ? `file ${n[0]}, part ${n[1]}` : `LBA ${n}`}
            </text>
            <text className="fl-mono" x={290} y={78 + l * 30} textAnchor="end">
              {p < 0 ? (simple ? 'nowhere' : 'unmapped') : simple ? `box ${Math.floor(p / SP)}, slot ${p % SP}` : `blk ${Math.floor(p / SP)} pg ${p % SP}`}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Chip({ i, t }: { i: number; t: number }) {
  const simple = useSimple()
  const gone = i === 8 ? phase(t, 0.8, 1.8) : 0
  return (
    <g>
      <rect className="fl-chip" x={16} y={56} width={300} height={380} rx={14} />
      <text className="fl-head" x={30} y={82}>
        {simple ? "Apple's chip" : 'M-series SoC'}
      </text>
      <rect className="fl-box" x={40} y={100} width={252} height={70} rx={8} />
      <text x={56} y={128}>
        {simple ? 'Storage manager' : 'Storage controller'}
      </text>
      <text className="fl-sub" x={56} y={150}>
        {simple ? 'keeps the address book' : 'runs the FTL'}
      </text>
      <rect className="fl-box" x={40} y={196} width={252} height={70} rx={8} />
      <text x={56} y={224}>
        {simple ? 'Scrambler' : 'AES-256 engine'}
      </text>
      <text className="fl-sub" x={56} y={246}>
        {simple ? 'locks data on the way out' : 'on the path to flash'}
      </text>
      <rect className="fl-box fl-sep" x={40} y={292} width={252} height={120} rx={8} />
      <text x={56} y={320}>
        Secure Enclave
      </text>
      <text className="fl-sub" x={56} y={342}>
        {simple ? 'holds the only key' : 'holds the volume keys'}
      </text>
      <g className="fl-key" opacity={1 - gone * 0.7} transform="translate(170 380)">
        <circle r={12} />
        <path d="M 12 0 H 52 M 40 0 V 10 M 48 0 V 8" />
      </g>
      {gone > 0 && <path className="fl-cross" d="M 160 360 L 236 400 M 160 400 L 236 360" opacity={gone} />}
      <path className="fl-link" d="M 292 135 H 336" />
      <text className="fl-sub" x={340} y={470}>
        {simple ? 'The flash chips sit beside the chip on the board, and only store what they are given.' : 'Raw NAND packages on the logic board. The controller is not on them.'}
      </text>
    </g>
  )
}

function Scene({ i, t, dur }: { i: number; t: number; dur: number }) {
  const simple = useSimple()
  const f = frameAt(i, t, dur)
  const { view } = f
  const cellsOn = i < 2
  const cipher = i === 7 ? phase(t, 2.2, 3) : i === 8 ? 1 : 0
  const noise = i === 8 ? phase(t, 1.6, 2.6) : 0
  const tok = f.ev?.kind === 'program' && f.from ? along([f.from, mid(f.ev.ppn)], phase(f.k, 0, 0.85)) : null
  const encTok = i === 7 && phase(t, 0.4, 2.4) < 1 ? along([[166, 30], [166, 135], [166, 231], [320, 231], [336, 135], mid(0)], phase(t, 0.4, 2.4)) : null
  const wa = view.hostWrites ? view.programs / view.hostWrites : null
  const maxE = Math.max(6, ...view.erases)
  return (
    <svg className="fl-scene" viewBox="0 0 960 560" role="img" aria-label={`Flash memory, step ${i + 1}: four blocks of six pages, and the controller that manages them`}>
      {cellsOn ? (
        <>
          <Cell fill={i === 0 ? phase(t, 0.6, 3.2) : phase(t, 0.5, 5.4)} />
          <Levels i={i} t={t} />
        </>
      ) : (
        <>
          {i >= 7 ? <Chip i={i} t={t} /> : <MapTable view={view} ev={f.ev} />}
          {i < 7 && (
            <g>
              <rect className="fl-in" x={560} y={12} width={160} height={28} rx={14} />
              <text className="fl-sub" x={640} y={31} textAnchor="middle">
                {simple ? 'writes from macOS' : 'host writes'}
              </text>
            </g>
          )}
          {range(0, SB).map((b) => {
            const erasing = f.ev?.kind === 'erase' && f.ev.block === b
            return (
              <g key={b} className={`fl-block ${erasing ? 'erasing' : ''}`}>
                <rect className="fl-blk" x={BX(b) - 6} y={64} width={146} height={306} rx={10} />
                <text className="fl-sub" x={BX(b) + 67} y={58} textAnchor="middle">
                  {simple ? `box ${b}` : `block ${b}`}
                </text>
                {range(0, SP).map((p) => {
                  const ppn = b * SP + p
                  const pg = view.pages[ppn]
                  const c = cell(ppn)
                  const label = pg.lpn == null ? '' : noise > 0.5 ? hex(ppn * 7 + 3) : cipher > 0.5 && pg.state === 'live' ? hex(pg.lpn) : NAMES[pg.lpn]
                  return (
                    <g key={p} className={`fl-page ${pg.state} ${noise > 0.5 ? 'noise' : ''}`}>
                      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={6} />
                      <text className="fl-mono" x={c.x + c.w / 2} y={c.y + 26} textAnchor="middle">
                        {pg.state === 'free' ? (simple ? 'empty' : 'erased') : label}
                      </text>
                    </g>
                  )
                })}
                <rect className="fl-wear-bg" x={BX(b)} y={384} width={134} height={8} rx={4} />
                <rect className="fl-wear" x={BX(b)} y={384} width={(134 * view.erases[b]) / maxE} height={8} rx={4} />
                <text className="fl-sub" x={BX(b)} y={412}>
                  {simple ? `wiped ${view.erases[b]}×` : `${view.erases[b]} erases`}
                </text>
              </g>
            )
          })}
          {tok && f.ev?.kind === 'program' && (
            <g className={`fl-tok ${f.ev.gc ? 'gc' : ''}`} transform={`translate(${tok[0]} ${tok[1]})`}>
              <rect x={-24} y={-12} width={48} height={24} rx={12} />
              <text y={5} textAnchor="middle">
                {NAMES[f.ev.lpn]}
              </text>
            </g>
          )}
          {encTok && (
            <g className="fl-tok" transform={`translate(${encTok[0]} ${encTok[1]})`}>
              <rect x={-30} y={-12} width={60} height={24} rx={12} />
              <text y={5} textAnchor="middle">
                {phase(t, 0.4, 2.4) > 0.55 ? hex(0) : 'A0'}
              </text>
            </g>
          )}
          {i < 7 && (
            <g className="fl-stats">
              {[
                [simple ? 'Saves from macOS' : 'Host writes', String(view.hostWrites)],
                [simple ? 'Writes to flash' : 'Flash writes', String(view.programs)],
                [simple ? 'Extra work' : 'Write amplification', wa == null ? 'n/a' : `${wa.toFixed(2)}×`],
                [simple ? 'Boxes wiped' : 'Block erases', String(view.erases.reduce((a, b) => a + b, 0))],
              ].map(([l, v], n) => (
                <g key={l}>
                  <rect x={352 + n * 150} y={436} width={134} height={64} rx={8} />
                  <text className="fl-sub" x={364 + n * 150} y={458}>
                    {l}
                  </text>
                  <text className="fl-val" x={364 + n * 150} y={488}>
                    {v}
                  </text>
                </g>
              ))}
            </g>
          )}
          {i === 8 && (
            <text className="fl-gone" x={647} y={530} textAnchor="middle" opacity={noise}>
              {simple ? 'Same charges, no key: nothing anyone can read.' : 'Key destroyed: every page is now unreadable ciphertext.'}
            </text>
          )}
        </>
      )}
    </svg>
  )
}

// The simulator: 8 blocks of 8 pages holding 40 logical pages, so a fifth of the flash is spare.
const B = 8
const PB = 8
const L = 40

const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)

function Simulator() {
  const simple = useSimple()
  const [ops, setOps] = useState<FileOp[]>([])
  const [useTrim, setTrim] = useState(true)
  const d = replay(B, PB, L, useTrim, ops)
  const other = replay(B, PB, L, !useTrim, ops)
  const nextName = () => `F${ops.filter((o) => o.op === 'write').length + 1}`
  const add = (o: FileOp) => {
    // Only keep operations that apply, so the history replays the same under either TRIM setting.
    if (apply(replay(B, PB, L, useTrim, ops), o)) setOps([...ops, o])
  }
  const busy = () => {
    const r = seeded(ops.length + 7)
    const sim = replay(B, PB, L, useTrim, ops)
    const out = [...ops]
    let made = out.filter((o) => o.op === 'write').length
    for (let n = 0; n < 20; n++) {
      const files = sim.files
      const x = r()
      const o: FileOp =
        files.length && x < 0.45
          ? { op: 'rewrite', name: files[Math.floor(r() * files.length)].name }
          : files.length > 2 && x < 0.75
            ? { op: 'delete', name: files[Math.floor(r() * files.length)].name }
            : { op: 'write', name: `F${++made}`, pages: 2 + Math.floor(r() * 5) }
      if (apply(sim, o)) out.push(o)
    }
    setOps(out)
  }
  const wa = amplification(d.ftl)
  const waOther = amplification(other.ftl)
  const fileOf = (lpn: number | null) => (lpn == null ? null : (d.files.find((x) => x.lpns.includes(lpn))?.name ?? null))
  const minE = Math.min(...d.ftl.erases)
  const maxE = Math.max(...d.ftl.erases)
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: be the storage drive for a day' : 'Try it: an FTL simulator'}</h3>
      <p className="fine">
        {simple
          ? 'Save, change and delete files, and watch what the flash has to do. Eight boxes of eight slots hold up to 40 slots of files, so some room is always kept spare. Grey slots are old copies waiting to be wiped.'
          : 'Eight blocks of eight pages, with 40 logical pages exposed, so 20% of the flash is over-provisioned. The FTL is page-mapped with greedy garbage collection and wear levelling. Grey pages are stale; outlined pages are live data the SSD still thinks matters.'}
      </p>
      <div className="lab-try-row">
        <button type="button" className="lab-btn" onClick={() => add({ op: 'write', name: nextName(), pages: 3 })}>
          {simple ? 'Save a small file' : 'Write 3-page file'}
        </button>
        <button type="button" className="lab-btn" onClick={() => add({ op: 'write', name: nextName(), pages: 8 })}>
          {simple ? 'Save a big file' : 'Write 8-page file'}
        </button>
        <button type="button" className="lab-btn" onClick={busy}>
          {simple ? 'A busy day: 20 changes' : '20 random operations'}
        </button>
        <div className="lab-seg" role="group" aria-label="TRIM">
          <button type="button" aria-pressed={useTrim} onClick={() => setTrim(true)}>
            {simple ? 'Tell the drive' : 'TRIM on'}
          </button>
          <button type="button" aria-pressed={!useTrim} onClick={() => setTrim(false)}>
            {simple ? "Don't tell it" : 'TRIM off'}
          </button>
        </div>
        <button type="button" className="lab-btn" onClick={() => setOps([])} disabled={!ops.length}>
          Reset
        </button>
      </div>
      <div className="lab-stage fl-sim-stage">
        <svg className="fl-sim" viewBox="0 0 960 250" role="img" aria-label="The simulated flash: eight blocks of eight pages">
          {range(0, B).map((b) => (
            <g key={b}>
              <text className="fl-sub" x={8 + b * 119} y={14}>
                {simple ? `box ${b}` : `block ${b}`}
              </text>
              {range(0, PB).map((p) => {
                const pg = d.ftl.pages[b * PB + p]
                const name = fileOf(pg.lpn)
                const ghost = pg.state === 'live' && name == null
                return (
                  <g key={p} className={`fl-page ${pg.state} ${ghost ? 'ghost' : ''}`}>
                    <rect x={8 + b * 119} y={22 + p * 24} width={108} height={20} rx={4} />
                    <text className="fl-mono" x={62 + b * 119} y={37 + p * 24} textAnchor="middle">
                      {pg.state === 'free' ? '' : pg.state === 'stale' ? 'stale' : (name ?? (simple ? 'deleted?' : 'dead, untrimmed'))}
                    </text>
                  </g>
                )
              })}
              <rect className="fl-wear-bg" x={8 + b * 119} y={220} width={108} height={7} rx={3} />
              <rect className="fl-wear" x={8 + b * 119} y={220} width={(108 * d.ftl.erases[b]) / Math.max(5, maxE)} height={7} rx={3} />
              <text className="fl-sub" x={8 + b * 119} y={244}>
                {d.ftl.erases[b]} {simple ? 'wipes' : 'erases'}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <dl className="fl-dl">
        <div>
          <dt>{simple ? 'Saves from macOS' : 'Host writes'}</dt>
          <dd className="num">{d.ftl.hostWrites}</dd>
        </div>
        <div>
          <dt>{simple ? 'Writes to flash' : 'Flash writes'}</dt>
          <dd className="num">{d.ftl.programs}</dd>
        </div>
        <div>
          <dt>{simple ? 'Extra work' : 'Write amplification'}</dt>
          <dd className="num">{wa == null ? 'n/a' : `${wa.toFixed(2)}×`}</dd>
        </div>
        <div>
          <dt>{simple ? `Same day, ${useTrim ? 'not telling it' : 'telling it'}` : `Same history, TRIM ${useTrim ? 'off' : 'on'}`}</dt>
          <dd className="num">{waOther == null ? 'n/a' : `${waOther.toFixed(2)}×`}</dd>
        </div>
        <div>
          <dt>{simple ? 'Wipes per box' : 'Erases per block'}</dt>
          <dd className="num">
            {minE} to {maxE}
          </dd>
        </div>
        <div>
          <dt>{simple ? 'Room left' : 'Free logical pages'}</dt>
          <dd className="num">
            {d.freeLpns.length} of {L}
          </dd>
        </div>
      </dl>
      {d.files.length > 0 && (
        <ul className="fl-files" aria-label="Files">
          {d.files.map((x) => (
            <li key={x.name}>
              <span className="num">
                {x.name}, {x.lpns.length} {simple ? 'slots' : 'pages'}
              </span>
              <button type="button" className="lab-btn" onClick={() => add({ op: 'rewrite', name: x.name })}>
                {simple ? 'Change' : 'Rewrite'}
              </button>
              <button type="button" className="lab-btn" onClick={() => add({ op: 'delete', name: x.name })}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="lab-verdict" aria-live="polite">
        {!ops.length
          ? simple
            ? 'Save a few files, then change and delete some. Try the busy day a few times with TRIM on, then switch TRIM off.'
            : 'Fill the disk, then churn it. Write amplification stays at 1.00 until garbage collection has to copy live pages.'
          : d.freeLpns.length === 0
            ? simple
              ? 'The disk is full. Delete a file to make room.'
              : 'No free logical pages: delete a file first.'
            : wa != null && waOther != null && Math.abs(wa - waOther) > 0.005
              ? simple
                ? `${useTrim ? 'Telling the drive' : 'Not telling it'}, it did ${wa.toFixed(2)}× the work; ${useTrim ? 'not telling it' : 'telling it'}, ${waOther.toFixed(2)}×. If nobody tells it, the storage drive keeps copying deleted files.`
                : `${useTrim ? 'With TRIM' : 'Without TRIM'} the flash wrote ${wa.toFixed(2)} pages per page saved; ${useTrim ? 'without' : 'with'} it, ${waOther.toFixed(2)}. Without TRIM, GC keeps copying deleted data it was never told is dead.`
              : simple
                ? 'Telling it makes no difference yet. It matters once files are deleted and the boxes have to be tidied.'
                : 'TRIM makes no difference yet: it matters once deleted data would otherwise be copied by GC.'}
      </p>
    </section>
  )
}

export default function Flash({ s, history, demo }: LabProps) {
  const simple = useSimple()
  const swap = s.memory.swapUsedBytes
  const steps: Step[] = [
    {
      title: simple ? 'A cell holds charge' : 'A cell holds charge',
      dur: 4,
      tech: (
        <p>
          NAND flash stores bits as electric charge trapped in a cell, an insulated layer inside a transistor. Programming pushes electrons in. The more charge, the higher the voltage needed to switch the transistor on, so a read tests that threshold against reference voltages. The charge stays when the power is off, which is what makes the SSD keep your files.
        </p>
      ),
      plain: (
        <p>
          Your files live in billions of tiny cells. Each one is like a sealed cup that can hold a bit of electric charge. Filling it changes how hard the cell is to switch on, and reading it means checking how full it is. The charge stays put with the power off, so your files stay too.
        </p>
      ),
    },
    {
      title: simple ? 'More levels, more bits' : 'SLC, MLC, TLC, QLC',
      dur: 6,
      tech: (
        <p>
          One cell can stand for more than one bit if the controller tells apart more levels of charge: 2 levels make 1 bit (SLC), 4 make 2 bits (MLC), 8 make 3 (TLC) and 16 make 4 (QLC). More bits per cell means more storage per chip, but narrower gaps between levels, so reads and writes are slower and the cell tolerates fewer erase cycles. OSTEP quotes rough figures of 25 µs to read SLC and about 75 µs for TLC, and program times from 200 to over 900 µs. Apple doesn't say which kind its Macs use.
        </p>
      ),
      plain: (
        <p>
          Instead of just empty or full, a cell can be a quarter full, half full and so on. Two levels store one bit, four store two, eight store three and sixteen store four. Packing more into each cell makes cheaper, bigger storage, but the levels get so close that reading and writing slow down and the cells wear out sooner. Apple doesn't say which kind it uses.
        </p>
      ),
    },
    {
      title: simple ? 'Slots and boxes' : 'Pages and blocks',
      dur: 5,
      tech: (
        <p>
          Cells are grouped into pages, the unit of reading and writing, and pages into blocks, the unit of erasing. A page can only be written once after its block is erased: you can't overwrite a page in place, and you can only erase the whole block. Modern chips use pages of 4 to 16 KiB and erase blocks of several MiB. Here files A and B fill block 0 and spill into block 1, one page at a time.
        </p>
      ),
      plain: (
        <p>
          Cells are grouped into slots, and slots into boxes. You can fill an empty slot, but you can't rub one slot out on its own. To reuse any slot you have to wipe the whole box at once. Here two files, A and B, fill box 0 and spill into box 1.
        </p>
      ),
    },
    {
      title: simple ? 'Changing a file' : 'The flash translation layer',
      dur: 4.5,
      tech: (
        <p>
          macOS overwrites A1 and A2. The controller can't rewrite those pages, so it writes the new data to fresh pages, marks the old ones stale, and updates its map from logical block addresses to physical pages. This map is the flash translation layer. macOS never sees it: it keeps writing to the same addresses, and the SSD keeps moving the data.
        </p>
      ),
      plain: (
        <p>
          You change part of file A. The SSD can't write over the old slots, so it puts the new version in empty slots, crosses out the old ones, and updates its address book so macOS still finds the file in the same place. macOS never knows the data moved.
        </p>
      ),
    },
    {
      title: simple ? 'Tidying up' : 'Garbage collection and write amplification',
      dur: 7,
      tech: (
        <p>
          More writes use up the erased blocks. To make room, the controller picks the block with the fewest live pages, here block 0, copies its live pages A0 and A3 to a fresh block, and erases it. Those copies are writes macOS never asked for. Flash writes divided by host writes is the write amplification: above 1 means extra wear and extra time. Spare capacity the host can't see gives garbage collection room to work.
        </p>
      ),
      plain: (
        <p>
          Soon the empty boxes run out. The SSD picks the box with the most crossed-out slots, moves the few still-useful slots into a fresh box, then wipes the old box clean. Moving those slots is extra work you never asked for. The "extra work" number counts it: 1 would mean none.
        </p>
      ),
    },
    {
      title: simple ? 'Sharing the wear' : 'Wear levelling',
      dur: 7,
      tech: (
        <p>
          Each erase wears a block a little; OSTEP gives ratings of 10,000 cycles for MLC and 100,000 for SLC, and Howard Oakley estimates at least 3,000 for Mac SSDs. Here A1 and A2 are rewritten 90 times. Writes always go to the least-worn erased block, and when a block holding data that never changes falls too far behind, the controller moves that data so the block shares the wear. Watch the erase counts stay close.
        </p>
      ),
      plain: (
        <p>
          Every wipe wears a box out a little, so the SSD spreads the wipes around. Here the same two slots change 90 times. The SSD always writes into the least-used empty box, and now and then moves files that never change out of their box so that box can take a turn too. The wipe counts stay close together.
        </p>
      ),
    },
    {
      title: simple ? 'Telling the storage drive what was deleted' : 'TRIM',
      dur: 4,
      tech: (
        <p>
          You delete file B. The file system marks its blocks free, but the SSD only learns about it through TRIM: macOS sends the deleted ranges, and the controller marks those pages stale at once. Without TRIM, the SSD would keep treating B's pages as live and copy them during every garbage collection until something overwrote those addresses. TRIM Support reads Yes for this Mac's internal SSD in System Information.
        </p>
      ),
      plain: (
        <p>
          You delete file B. macOS tells the SSD straight away, so it crosses out B's slots and won't waste time moving them when it tidies up. Without that message the SSD would keep carefully moving a file you already threw away.
        </p>
      ),
    },
    {
      title: simple ? 'The manager lives in Apple\'s chip' : 'Controller in the SoC, encryption in line',
      dur: 5,
      tech: (
        <p>
          On a PC, an SSD carries its own controller. On Apple silicon the storage controller is part of the M-series chip, and the NAND packages on the logic board are raw flash. Apple's Platform Security guide describes an AES-256 engine on the path between flash and memory, with keys managed by the Secure Enclave and never exposed to the CPU. Every APFS volume has its own encryption key, FileVault or not, so what lands in the cells is always ciphertext.
        </p>
      ),
      plain: (
        <p>
          In most PCs the SSD has its own manager. In this Mac the manager is part of Apple's main chip, and the flash chips on the board just hold charge. On the way out, everything passes through a scrambler with a key kept in the Secure Enclave, a locked-off corner of the chip. So the flash only ever holds scrambled data, even with FileVault off.
        </p>
      ),
    },
    {
      title: simple ? 'Throw away the key' : 'Erase by destroying the key',
      dur: 4,
      tech: (
        <p>
          Erasing a volume on Apple silicon doesn't rewrite the flash. The Secure Enclave deletes the volume encryption key, and the data in the cells becomes ciphertext no one can decrypt, which is why erasing a Mac takes seconds. Apple's guide also describes a media key the Secure Enclave can erase to make a whole volume cryptographically inaccessible.
        </p>
      ),
      plain: (
        <p>
          To wipe the Mac, macOS doesn't have to empty every cell. It just destroys the key. The scrambled data is still there, but nobody can ever unscramble it again. That's why erasing a Mac takes seconds.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          simple
            ? 'Every write here passes through the steps below, and so does Overflow Storage when the Desk Space runs short.'
            : 'Disk rates come from the block storage byte counters. Swap is written to /System/Volumes/VM and is encrypted like everything else.'
        }
      >
        <LiveStat label={simple ? 'Storage reads' : 'Disk reads'} value={rate(s.disk.readBps)} sub={<Sparkline values={history.map((x) => x.disk.readBps)} w={90} h={18} label="Disk reads over the last minutes" />} />
        <LiveStat label={simple ? 'Storage writes' : 'Disk writes'} value={rate(s.disk.writeBps)} sub={<Sparkline values={history.map((x) => x.disk.writeBps)} w={90} h={18} label="Disk writes over the last minutes" />} hot={s.disk.writeBps > 200e6} />
        <LiveStat label={simple ? 'Overflow Storage' : 'Swap used'} value={memGB(swap)} sub={swap > 0 ? (simple ? 'on the storage drive now' : 'in swap files on the SSD') : simple ? 'none needed' : 'no swap in use'} hot={swap > 2 ** 30} />
        <LiveStat label={simple ? 'Desk Space pressure' : 'Memory pressure'} value={s.memory.pressure} sub={simple ? 'high means more Overflow' : 'warn or critical means swapping'} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene i={story.i} t={story.t} dur={story.step.dur} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <Simulator />

      <Deeper title={simple ? 'Should I worry about wearing out my storage drive?' : 'Wear, swap and what you can check'}>
        {simple ? (
          <>
            <p>For everyday use, no. Howard Oakley estimates a 512 GB Mac SSD could take around 1,500 TB of writes, which is decades at a normal pace. The one habit that adds a lot of writes is running out of Desk Space all day, because Overflow Storage lives on the SSD.</p>
            <p>The number in the simulator called extra work is why SSDs keep spare room you can't see, and why a nearly full disk can get slower: the manager has less space to tidy up in.</p>
          </>
        ) : (
          <>
            <p>
              Apple publishes no endurance rating for Mac SSDs. Howard Oakley's working estimate is at least 3,000 erase cycles per cell, so a 512 GB SSD could take about 1,500 TB of writes. Swap is the largest avoidable source of writes, so enough RAM to rarely swap is the best thing for SSD life.
            </p>
            <ul>
              <li>
                <code>system_profiler SPNVMeDataType</code> shows the model and TRIM Support. Here: APPLE SSD AP0512Z, TRIM Support: Yes.
              </li>
              <li>
                <code>diskutil info disk0</code> reports the protocol as Apple Fabric, not NVMe.
              </li>
              <li>
                <code>fdesetup status</code> says whether FileVault adds your password to the key protection. The data is encrypted either way.
              </li>
              <li>
                <code>iostat -d -w 1 disk0</code> shows what reaches the SSD each second. Lesson 11 uses it to show macOS caching writes in RAM before flushing them.
              </li>
            </ul>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Arpaci-Dusseau, OSTEP: Flash-based SSDs', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/file-ssd.pdf', note: 'Cells, SLC, MLC and TLC, pages and blocks, the FTL, garbage collection, write amplification, wear levelling, TRIM, and the latency and endurance figures quoted here.' },
          { title: 'Wikipedia, Flash memory', url: 'https://en.wikipedia.org/wiki/Flash_memory', note: 'Pages of 4 to 16 KiB and modern erase blocks of 1 to 128 MiB.' },
          { title: 'Wikipedia, Multi-level cell', url: 'https://en.wikipedia.org/wiki/Multi-level_cell', note: 'QLC: four bits and sixteen levels per cell.' },
          { title: 'Apple Platform Security: The Secure Enclave', url: 'https://support.apple.com/guide/security/sec59b0b31ff', note: 'The AES engine and key handling in the Secure Enclave.' },
          { title: 'Apple Platform Security: Volume encryption with FileVault', url: 'https://support.apple.com/guide/security/sec4c6dc1b6e', note: 'Volume keys with FileVault on and off, keys never exposed to the CPU, and erasing by deleting keys.' },
          { title: 'TidBITS, Clarifying the lack of Mac Studio SSD upgradability', url: 'https://tidbits.com/2022/03/23/clarifying-the-lack-of-mac-studio-ssd-upgradability/', note: 'The controller is in the SoC; the flash modules are raw NAND.' },
          { title: 'Eclectic Light, How long will my Mac\'s SSD last?', url: 'https://eclecticlight.co/2026/02/26/how-long-will-my-macs-ssd-last/', note: 'Endurance estimates, wear and swap.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>system_profiler SPNVMeDataType</code> lists APPLE SSD AP0512Z with TRIM Support: Yes, and <code>diskutil info disk0</code> reports Protocol: Apple Fabric. The scene and the simulator run a small model FTL; Apple's controller firmware is not public, so block sizes, the collection policy and the spare capacity here are illustrations. Lesson 11 has more on this Mac's SSD.
      </p>
    </div>
  )
}
