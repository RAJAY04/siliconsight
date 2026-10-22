import { useState, type KeyboardEvent } from 'react'
import { mhz } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { EXIT, ITER, LOOP, STAGES, STREAMS, cyclesOf, ooo, predictTaken, runLoop, runPredictor, schedule, seeded, type Row, type StreamId, type Uop } from './pipeline.ts'
import './Pipeline.css'

// One CPU core, three ways: the loop and its registers, a classic 5-stage pipeline drawn as a timing grid, and a
// wide out-of-order core with a reorder buffer. Every frame comes from the models in pipeline.ts at a whole cycle.
// Coordinates are in the SVG's 960 x 540 viewBox.

const ARRAY = [5, 3, 8, 2]
const TRACE = runLoop(ARRAY).slice(0, 8)
const SEC_PER_INS = 0.9

const PIPE = {
  serial: schedule(ITER, 'serial'),
  ideal: schedule(ITER, 'pipelined', false),
  stall: schedule(ITER, 'pipelined'),
  exit: schedule(EXIT, 'pipelined'),
}
const PIPE_SPC = { serial: 0.32, ideal: 0.6, stall: 0.6, exit: 0.55 }
type PipeKey = keyof typeof PIPE

const CORE = {
  wide: ooo({ iters: 8 }),
  slow: ooo({ iters: 8, slowIter: 1, slowLat: 20 }),
  flush: ooo({ iters: 4, mispredictLast: true }),
}
const CORE_SPC = { wide: 0.55, slow: 0.38, flush: 0.7 }
// The cycle each story stops on, so the still frame shows the point: a full pipe, a full buffer behind the slow
// load, and the moment of the flush.
const slowLoad = CORE.slow.uops.find((u) => u.op === 'ldr' && u.iter === 1)!
const CORE_HOLD = { wide: 8, slow: slowLoad.done! - 1, flush: CORE.flush.uops.find((u) => u.wrong)!.flushed! }
type CoreKey = keyof typeof CORE

/** Step 1: the loop, its registers and the array, one instruction at a time. */
function ProgScene({ t }: { t: number }) {
  const simple = useSimple()
  const k = Math.min(TRACE.length - 1, Math.floor(t / SEC_PER_INS))
  const started = t > 0.05
  const cur = TRACE[k]
  const prev = k > 0 ? TRACE[k - 1].regs : { x0: 0x1000, x1: ARRAY.length, x8: 0, x9: 0, z: false }
  const regs = started ? cur.regs : prev
  const pc = started ? cur.pc : -1
  const ran = k + (started ? 1 : 0)
  const local = t - k * SEC_PER_INS
  const changed = (r: keyof typeof regs) => started && regs[r] !== prev[r]
  const notes = simple
    ? ['grab the next number, move the finger along', 'add it to the running total', 'one fewer left to do', 'any left? go back to the top']
    : ['x9 = memory[x0], then x0 = x0 + 8', 'x8 = x9 + x8', 'x1 = x1 - 1, set Z if the result is 0', 'if Z is clear, jump back to loop']
  const regBox: { r: keyof typeof regs; label: string; sub: string; hex?: boolean }[] = [
    { r: 'x0', label: 'x0', sub: simple ? 'finger on the list' : 'pointer into a[]', hex: true },
    { r: 'x1', label: 'x1', sub: simple ? 'how many left' : 'count left' },
    { r: 'x8', label: 'x8', sub: simple ? 'running total' : 'sum s' },
    { r: 'x9', label: 'x9', sub: simple ? 'number just grabbed' : 'loaded value' },
    { r: 'z', label: 'Z flag', sub: simple ? 'reached zero?' : 'last result was 0' },
  ]
  const cell = (i: number) => ({ x: 520 + i * 104, y: 330 })
  const ptr = (regs.x0 - 0x1000) / 8
  const flying = started && cur.pc === 0 && local < 0.7
  const from: [number, number] = [cell(Math.max(0, ptr - 1)).x + 46, cell(0).y]
  const tok = along([from, [from[0], 250], [652 + 70, 146 + 41]], phase(local, 0.05, 0.65))
  return (
    <svg className="pl-scene" viewBox="0 0 960 540" role="img" aria-label="The summing loop as ARM64 instructions, with the registers and the array they work on">
      <defs>
        <marker id="pl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="pl-arrowhead" />
        </marker>
      </defs>
      <text className="pl-head" x={30} y={36}>
        {simple ? 'What you write' : 'C source'}
      </text>
      <rect className="pl-code" x={30} y={48} width={420} height={56} rx={10} />
      <text className="pl-mono" x={46} y={72}>
        for (long i = 0; i {'<'} n; i++)
      </text>
      <text className="pl-mono" x={46} y={92} xmlSpace="preserve">
        {'    s += a[i];'}
      </text>
      <text className="pl-head" x={30} y={140}>
        {simple ? 'What the core actually runs' : 'ARM64, as clang -O1 compiles it on this Mac'}
      </text>
      <rect className="pl-code" x={30} y={152} width={420} height={250} rx={10} />
      <text className="pl-mono pl-label" x={46} y={180}>
        loop:
      </text>
      {LOOP.map((ins, i) => (
        <g key={i} className={`pl-line ${pc === i ? 'on' : ''}`}>
          <rect x={40} y={192 + i * 50} width={392} height={44} rx={7} />
          <text className="pl-mono" x={56} y={211 + i * 50} xmlSpace="preserve">
            {ins}
          </text>
          <text className="pl-note" x={56} y={228 + i * 50}>
            {notes[i]}
          </text>
        </g>
      ))}
      <path className={`pl-back ${pc === 3 && !regs.z ? 'on' : ''}`} d="M 434 362 C 462 362, 462 214, 434 214" markerEnd="url(#pl-arrow)" />
      <text className="pl-fine" x={30} y={430}>
        {simple ? 'Each line is one instruction: 4 bytes the core reads, works out, and does.' : 'Every A64 instruction is 4 bytes, so the loop body is 16 bytes.'}
      </text>

      <text className="pl-head" x={500} y={36}>
        {simple ? "The worker's hands (registers)" : 'Registers'}
      </text>
      {regBox.map((b, i) => {
        const x = 500 + (i % 3) * 152
        const y = 50 + Math.floor(i / 3) * 96
        const v = regs[b.r]
        return (
          <g key={b.r} className={`pl-reg ${changed(b.r) ? 'lit' : ''}`}>
            <rect x={x} y={y} width={140} height={82} rx={9} />
            <text className="pl-reg-n" x={x + 12} y={y + 20}>
              {b.label}
            </text>
            <text className="pl-reg-v" x={x + 12} y={y + 50}>
              {typeof v === 'boolean' ? (v ? '1' : '0') : b.hex ? '0x' + v.toString(16) : String(v)}
            </text>
            <text className="pl-note" x={x + 12} y={y + 70}>
              {b.sub}
            </text>
          </g>
        )
      })}
      <text className="pl-head" x={500} y={310}>
        {simple ? 'The list in memory' : 'a[] in memory, 8 bytes each'}
      </text>
      {ARRAY.map((v, i) => {
        const c = cell(i)
        return (
          <g key={i} className={`pl-mem ${i < ptr ? 'read' : ''}`}>
            <rect x={c.x} y={c.y} width={92} height={56} rx={8} />
            <text className="pl-reg-v" x={c.x + 46} y={c.y + 37} textAnchor="middle">
              {v}
            </text>
            <text className="pl-note" x={c.x + 46} y={c.y + 76} textAnchor="middle">
              {'0x' + (0x1000 + i * 8).toString(16)}
            </text>
          </g>
        )
      })}
      {ptr < ARRAY.length && (
        <g className="pl-ptr" transform={`translate(${cell(ptr).x + 46} ${cell(0).y + 96})`}>
          <path d="M 0 -6 L -8 8 L 8 8 z" />
          <text y={26} textAnchor="middle">
            x0
          </text>
        </g>
      )}
      {flying && (
        <g className="pl-token" transform={`translate(${tok[0]} ${tok[1]})`}>
          <circle r={15} />
          <text y={5} textAnchor="middle">
            {cur.loaded}
          </text>
        </g>
      )}
      <text className="pl-fine" x={500} y={496}>
        {simple
          ? `${Math.floor(ran / 4)} of 4 trips done. Running total: ${regs.x8}.`
          : `${ran} instructions run, ${Math.floor(ran / 4)} full trips: s = ${regs.x8}. The whole array sums to ${ARRAY.reduce((a, b) => a + b, 0)}.`}
      </text>
    </svg>
  )
}

const STAGE_NAMES = { F: ['Fetch', 'Read'], D: ['Decode', 'Understand'], X: ['Execute', 'Do'], M: ['Memory', 'Memory'], W: ['Write back', 'Save'] }

/** Steps 2 to 5: the five stages up top, and the timing grid of which instruction is where in each cycle. */
function PipeScene({ rows, cycle, k }: { rows: Row[]; cycle: number; k: PipeKey }) {
  const simple = useSimple()
  const cols = rows[0].cells.length
  const cw = Math.min(50, 640 / cols)
  const gx = 290
  const gy = 150
  const rh = 36
  const now = rows.map((r) => r.cells[cycle])
  const total = rows.filter((r) => !r.flushed).length
  const done = rows.filter((r) => !r.flushed && r.cells.lastIndexOf('W') <= cycle).length
  const bubble = now.includes('stall') && !now.includes('X')
  const br = rows.findIndex((r) => r.text.startsWith('b.ne'))
  const brX = rows[br].cells.indexOf('X')
  const resolved = k === 'exit' && cycle >= brX
  const finished = cycle + 1 >= cyclesOf(rows)
  return (
    <svg className="pl-scene" viewBox="0 0 960 540" role="img" aria-label="A five-stage pipeline, and a grid of which instruction is in which stage each cycle">
      <defs>
        <marker id="pl-arrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="pl-arrowhead" />
        </marker>
      </defs>
      {STAGES.map((s, i) => {
        const row = now.indexOf(s)
        const x = 40 + i * 180
        const wrong = row >= 0 && rows[row].wrong
        return (
          <g key={s} className={`pl-stage ${row >= 0 ? 'busy' : ''} ${s === 'X' && bubble ? 'bubble' : ''} ${wrong ? 'wrong' : ''}`}>
            <rect x={x} y={20} width={160} height={74} rx={10} />
            <text className="pl-stage-n" x={x + 12} y={40}>
              {s}: {STAGE_NAMES[s][simple ? 1 : 0]}
            </text>
            <text className="pl-stage-i" x={x + 80} y={74} textAnchor="middle">
              {row >= 0 ? rows[row].text.split(/\s+/)[0] : s === 'X' && bubble ? (simple ? 'gap' : 'bubble') : ''}
            </text>
          </g>
        )
      })}
      {STAGES.slice(0, -1).map((s, i) => (
        <path key={s} className="pl-flow" d={`M ${202 + i * 180} 57 L ${218 + i * 180} 57`} markerEnd="url(#pl-arrow2)" />
      ))}

      <text className="pl-head" x={30} y={gy - 12}>
        Instruction
      </text>
      <text className="pl-head" x={gx} y={gy - 34}>
        {simple ? 'Clock tick' : 'Cycle'}
      </text>
      {Array.from({ length: cols }, (_, c) => (
        <text key={c} className={`pl-cyc ${c === cycle ? 'on' : ''}`} x={gx + c * cw + cw / 2} y={gy - 12} textAnchor="middle">
          {c + 1}
        </text>
      ))}
      <rect className="pl-cursor" x={gx + cycle * cw} y={gy - 4} width={cw} height={rows.length * rh + 2} rx={4} />
      {rows.map((r, i) => {
        const lastLive = Math.max(...r.cells.map((s, c) => (s ? c : -1)))
        return (
          <g key={i} className={`pl-row ${r.wrong ? 'wrong' : ''} ${r.flushed && resolved ? 'flushed' : ''}`}>
            <text className="pl-mono" x={30} y={gy + i * rh + 20} xmlSpace="preserve">
              {r.text}
            </text>
            {r.cells.map((s, c) =>
              s == null || c > cycle ? null : (
                <g key={c} className={`pl-cell s-${s}`}>
                  <rect x={gx + c * cw + 2} y={gy + i * rh} width={cw - 4} height={rh - 6} rx={5} />
                  <text x={gx + c * cw + cw / 2} y={gy + i * rh + 20} textAnchor="middle">
                    {s === 'stall' ? (cw > 40 ? 'wait' : '-') : s}
                  </text>
                </g>
              ),
            )}
            {r.flushed && resolved && (
              <>
                <line className="pl-strike" x1={24} x2={gx + (lastLive + 1) * cw} y1={gy + i * rh + 15} y2={gy + i * rh + 15} />
                <text className="pl-flushed-t" x={gx + (lastLive + 1) * cw + 8} y={gy + i * rh + 20}>
                  {simple ? 'thrown away' : 'flushed'}
                </text>
              </>
            )}
          </g>
        )
      })}
      {k === 'exit' && cycle >= rows[br].cells.indexOf('F') && (
        <g className={`pl-guess ${resolved ? 'bad' : ''}`}>
          <rect x={30} y={gy + rows.length * rh + 4} width={900} height={36} rx={9} />
          <text x={46} y={gy + rows.length * rh + 27}>
            {resolved
              ? simple
                ? 'Wrong guess: the list had ended. The two half-done jobs are thrown away and reading restarts on the right path.'
                : 'b.ne resolves in X: Z is set, so it falls through. Flush the two younger instructions and fetch the fall-through.'
              : simple
                ? 'The worker guesses "go round again" and starts the next trip before it knows.'
                : 'Predicted taken: fetch carries on at loop: before b.ne has executed.'}
          </text>
        </g>
      )}
      <text className="pl-sum" x={30} y={516}>
        <tspan className="pl-sum-v">{done}</tspan> of {total} {simple ? 'instructions finished after' : 'instructions written back after'} <tspan className="pl-sum-v">{cycle + 1}</tspan> {simple ? 'ticks.' : 'cycles.'}
        {finished && <tspan className="pl-sum-k">{simple ? `  About ${(total / cyclesOf(rows)).toFixed(2)} per tick.` : `  ${(total / cyclesOf(rows)).toFixed(2)} instructions per cycle.`}</tspan>}
      </text>
    </svg>
  )
}

const UNIT_ROW: { kind: 'alu' | 'load' | 'fp'; label: string; branch?: boolean }[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ kind: 'alu' as const, label: 'ALU', branch: i < 2 })),
  { kind: 'load', label: 'ST' },
  ...Array.from({ length: 3 }, () => ({ kind: 'load' as const, label: 'LD' })),
  ...Array.from({ length: 4 }, () => ({ kind: 'fp' as const, label: 'FP' })),
]
const ROB_SHOWN = 24
const iterLabel = (u: Uop) => (u.op === 'mov' || u.op === 'ret' ? 'exit' : `#${u.iter + 1}`)
const DST: Partial<Record<Uop['op'], string>> = { ldr: 'x9', add: 'x8', subs: 'x1', mov: 'x0' }

/** Steps 6 to 8: a wide out-of-order core, drawn from the ooo() model one cycle at a time. */
function CoreScene({ k, cycle }: { k: CoreKey; cycle: number }) {
  const simple = useSimple()
  const { uops, cycles } = CORE[k]
  const c = Math.min(cycle, cycles - 1)
  const decoded = uops.filter((u) => u.dec === c)
  const issued = uops.filter((u) => u.issue === c && (u.flushed == null || u.flushed > c))
  const rob = uops.filter((u) => u.dec <= c && (u.retire == null || u.retire > c) && (u.flushed == null || u.flushed >= c))
  const retired = uops.filter((u) => u.retire != null && u.retire <= c).length
  const wasted = uops.filter((u) => u.flushed != null && u.flushed <= c).length
  const flushing = uops.some((u) => u.flushed === c)
  // Put each issued uop in a free unit of the right kind; branches only go to the two that branch.
  const slots: (Uop | null)[] = UNIT_ROW.map(() => null)
  for (const u of issued) {
    const want = u.op === 'ldr' ? 'load' : 'alu'
    const branchy = u.op === 'b.ne' || u.op === 'ret'
    const pick = (ok: (s: (typeof UNIT_ROW)[number]) => boolean) => UNIT_ROW.findIndex((s, j) => !slots[j] && s.kind === want && s.label !== 'ST' && ok(s))
    const j = branchy ? pick((s) => !!s.branch) : pick((s) => !s.branch) >= 0 ? pick((s) => !s.branch) : pick(() => true)
    if (j >= 0) slots[j] = u
  }
  const lastBr = uops.filter((u) => u.op === 'b.ne' && !u.wrong).at(-1)
  const guessing = k === 'flush' && lastBr != null && c >= lastBr.dec && lastBr.done != null && c < lastBr.done
  const state = (u: Uop) => (u.flushed != null && u.flushed <= c ? 'flushed' : u.done != null && u.done <= c ? 'done' : u.issue != null && u.issue <= c ? 'exec' : 'wait')
  const renames = decoded.filter((u) => DST[u.op]).map((u) => `${DST[u.op]}→p${u.phys}`)
  return (
    <svg className="pl-scene" viewBox="0 0 960 540" role="img" aria-label="A wide out-of-order core: fetch, eight decode slots, rename, execution units, and the reorder buffer">
      <g className="pl-box">
        <rect x={20} y={40} width={132} height={62} rx={10} />
        <text className="pl-stage-n" x={32} y={62}>
          {simple ? 'Read' : 'Fetch'}
        </text>
        <text className="pl-note" x={32} y={82}>
          {simple ? 'follows one jump' : 'one taken branch'}
        </text>
        <text className="pl-note" x={32} y={96}>
          {simple ? 'per tick' : 'per cycle'}
        </text>
      </g>
      <text className="pl-head" x={170} y={30}>
        {simple ? 'Understand: up to 8 per tick' : 'Decode: 8 wide, as measured on M1 P cores'}
      </text>
      {Array.from({ length: 8 }, (_, i) => {
        const u = decoded[i]
        return (
          <g key={i} className={`pl-slot ${u ? 'busy' : ''} ${u?.wrong ? 'wrong' : ''}`}>
            <rect x={170 + i * 62} y={40} width={56} height={62} rx={8} />
            {u && (
              <>
                <text className="pl-slot-op" x={198 + i * 62} y={68} textAnchor="middle">
                  {u.op}
                </text>
                <text className="pl-note" x={198 + i * 62} y={88} textAnchor="middle">
                  {iterLabel(u)}
                </text>
              </>
            )}
          </g>
        )
      })}
      <g className={`pl-box pl-pred ${guessing ? 'guess' : ''} ${flushing ? 'bad' : ''}`}>
        <rect x={680} y={40} width={260} height={62} rx={10} />
        <text className="pl-stage-n" x={694} y={62}>
          {simple ? 'Guesser' : 'Branch predictor'}
        </text>
        <text className="pl-note" x={694} y={84}>
          {flushing
            ? simple
              ? 'Wrong! Throw the guessed work away.'
              : 'Mispredicted: flush everything younger.'
            : guessing
              ? simple
                ? 'Guessed "go round again". Not checked yet.'
                : 'Last b.ne guessed taken, unresolved.'
              : simple
                ? 'Guesses "go round again" at each fork.'
                : 'Predicts each b.ne taken.'}
        </text>
      </g>

      <g className="pl-box">
        <rect x={170} y={118} width={490} height={44} rx={9} />
        <text className="pl-stage-n" x={184} y={145}>
          {simple ? 'Fresh labels' : 'Rename'}
        </text>
        <text className="pl-mono pl-small" x={290} y={145} xmlSpace="preserve">
          {renames.length ? renames.slice(0, 4).join('   ') : simple ? 'nothing new this tick' : 'nothing decoded this cycle'}
        </text>
      </g>

      <text className="pl-head" x={30} y={198}>
        {simple ? 'Tools: what started this tick' : 'Execution units: issued this cycle'}
      </text>
      {UNIT_ROW.map((s, i) => {
        const u = slots[i]
        const x = 30 + i * 64
        return (
          <g key={i} className={`pl-unit k-${s.kind} ${u ? 'busy' : ''} ${u?.wrong ? 'wrong' : ''}`}>
            <rect x={x} y={208} width={58} height={70} rx={8} />
            <text className="pl-note" x={x + 29} y={226} textAnchor="middle">
              {s.label}
              {s.branch ? '+br' : ''}
            </text>
            {u && (
              <>
                <text className="pl-slot-op" x={x + 29} y={250} textAnchor="middle">
                  {u.op}
                </text>
                <text className="pl-note" x={x + 29} y={268} textAnchor="middle">
                  {iterLabel(u)}
                </text>
              </>
            )}
          </g>
        )
      })}

      <text className="pl-head" x={30} y={318}>
        {simple ? `To-do list, in order (${ROB_SHOWN} spots here)` : `Reorder buffer (${ROB_SHOWN} entries in this model)`}
      </text>
      <text className="pl-note" x={930} y={318} textAnchor="end">
        {simple ? 'oldest on the left, crossed off in order' : 'oldest on the left; retires in order from there'}
      </text>
      {Array.from({ length: ROB_SHOWN }, (_, i) => {
        const u = rob[i]
        const x = 30 + i * 37.5
        return (
          <g key={i} className={`pl-rob ${u ? state(u) : 'empty'} ${u?.wrong ? 'wrong' : ''}`}>
            <rect x={x} y={328} width={33} height={70} rx={6} />
            {u && (
              <>
                <text className="pl-rob-op" x={x + 16.5} y={356} textAnchor="middle">
                  {u.op}
                </text>
                <text className="pl-rob-i" x={x + 16.5} y={380} textAnchor="middle">
                  {iterLabel(u)}
                </text>
              </>
            )}
          </g>
        )
      })}
      {rob.length >= ROB_SHOWN && (
        <text className="pl-full" x={930} y={420} textAnchor="end">
          {simple ? 'List full: nothing new can start' : 'ROB full: decode stalls'}
        </text>
      )}

      {(['wait', 'exec', 'done', 'flushed'] as const).map((s, i) => (
        <g key={s} className={`pl-rob pl-legend ${s}`} transform={`translate(${30 + i * 176} 438)`}>
          <rect width={16} height={16} rx={4} />
          <text x={24} y={13}>
            {simple ? ['waiting for its inputs', 'being done', 'done, not crossed off', 'thrown away'][i] : ['waiting for operands', 'executing', 'done, waiting to retire', 'flushed'][i]}
          </text>
        </g>
      ))}
      <text className="pl-sum" x={30} y={494} xmlSpace="preserve">
        {simple ? 'Tick' : 'Cycle'} <tspan className="pl-sum-v">{c + 1}</tspan>
        {'     '}
        {simple ? 'Finished' : 'Retired'} <tspan className="pl-sum-v">{retired}</tspan>
        {'     '}
        {simple ? 'Per tick so far' : 'IPC so far'} <tspan className="pl-sum-v">{(retired / (c + 1)).toFixed(2)}</tspan>
        {k === 'flush' && (
          <>
            {'     '}
            {simple ? 'Thrown away' : 'Flushed'} <tspan className="pl-sum-v pl-bad">{wasted}</tspan>
          </>
        )}
      </text>
      <text className="pl-note" x={30} y={520}>
        {k === 'slow'
          ? simple
            ? 'The grab in trip #2 has to fetch its number from far away. The 20-tick wait is made up for the picture.'
            : 'The load in trip #2 misses the cache. Its 20-cycle latency is illustrative; the caches lab has real ones.'
          : simple
            ? 'A grab takes 4 ticks and an add takes 1, as measured on M1 Fast Workers.'
            : "Load-to-use 4 cycles, ALU 1 cycle, from Dougall Johnson's M1 measurements."}
      </text>
    </svg>
  )
}

/** The guessing game: you and a 2-bit counter call the same branch stream. */
function BranchGame() {
  const simple = useSimple()
  const N = 24
  const [id, setId] = useState<StreamId>('loop')
  const [seed, setSeed] = useState(7)
  const [mine, setMine] = useState<boolean[]>([])
  const stream = STREAMS.find((s) => s.id === id)!
  const actual = stream.gen(N, seeded(seed))
  const bot = runPredictor(actual)
  const pos = mine.length
  const over = pos >= N
  const youRight = mine.filter((g, i) => g === actual[i]).length
  const botRight = bot.guesses.slice(0, pos).filter((g, i) => g === actual[i]).length
  const state = over ? null : bot.states[pos]
  const guess = (g: boolean) => !over && setMine([...mine, g])
  const restart = (next?: StreamId) => {
    if (next) setId(next)
    setSeed((x) => x + 1)
    setMine([])
  }
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const key = e.key.toLowerCase()
    if (key === 't') guess(true)
    else if (key === 'n') guess(false)
    else return
    e.preventDefault()
  }
  const states = simple ? ['sure: stay', 'thinks: stay', 'thinks: jump', 'sure: jump'] : ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken']
  const T = simple ? 'jump' : 'taken'
  const NT = simple ? 'stay' : 'not taken'
  const verdict = {
    random: simple ? 'Nobody can guess coin flips. Real chips lose the most time on forks like this one.' : 'Random data defeats every predictor. That is why sorting the data first made the same loop 9 to 11 times faster on this Mac.',
    pattern: simple ? 'You can see the pattern; the 4-mood guesser cannot. Real chips also remember the last few forks to catch patterns like this.' : 'The counter misses every taken branch. Real predictors index their tables by recent branch history, which catches patterns like this.',
    loop: simple ? 'The guesser only misses the last trip of each loop.' : 'The counter misses only each loop exit, and its strong state means one exit does not unlearn the loop.',
    sorted: simple ? 'Easy for both: one long run of stays, then one long run of jumps.' : 'Sorted data turns the branch into two long runs, so the counter misses about twice.',
  }[id]
  return (
    <section className="card lab-try pl-game" onKeyDown={onKey}>
      <h3>{simple ? 'Try it: out-guess the guesser' : 'Try it: beat the branch predictor'}</h3>
      <p className="fine">
        {simple
          ? 'A branch is a fork in the road: jump back, or stay on the path. Guess each one before you see it, using what came before. A tiny guesser with 4 moods plays the same forks next to you. Press T or N, or use the buttons.'
          : 'Call each outcome of one branch before it resolves, from the history so far. A 2-bit saturating counter calls the same stream: it takes two wrong calls in a row to flip its prediction. Press T or N, or use the buttons.'}
      </p>
      <div className="lab-try-row">
        <div className="lab-seg pl-seg" role="group" aria-label={simple ? 'Which fork' : 'Branch stream'}>
          {STREAMS.map((s) => (
            <button key={s.id} type="button" aria-pressed={id === s.id} onClick={() => restart(s.id)}>
              {simple ? s.plain : s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="pl-game-code">
        <code>{stream.code}</code>
      </p>
      <ol className="pl-chips" aria-label="Branch outcomes so far">
        {actual.map((a, i) => (
          <li key={i} className={i < pos ? (a ? 'tk' : 'nt') : i === pos ? 'now' : ''}>
            <span className="pl-chip-o">{i < pos ? (a ? 'T' : 'N') : i === pos ? '?' : ''}</span>
            {i < pos && (
              <span className="pl-chip-m">
                <span className={mine[i] === a ? 'ok' : 'bad'}>you</span>
                <span className={bot.guesses[i] === a ? 'ok' : 'bad'}>{simple ? 'bot' : 'ctr'}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="fine pl-key">{simple ? 'Green means that guess was right, red means wrong.' : 'Under each outcome: your call and the counter\'s, green if right, red if wrong.'}</p>
      <div className="lab-try-row pl-game-row">
        <button type="button" className="lab-btn pl-big" onClick={() => guess(true)} disabled={over}>
          {simple ? 'Jump (T)' : 'Taken (T)'}
        </button>
        <button type="button" className="lab-btn pl-big" onClick={() => guess(false)} disabled={over}>
          {simple ? 'Stay (N)' : 'Not taken (N)'}
        </button>
        <button type="button" className="lab-btn" onClick={() => restart()}>
          New round
        </button>
      </div>
      <div className="pl-counter" role="img" aria-label={state == null ? 'Round over' : `Counter state ${state}: ${states[state]}`}>
        {states.map((x, i) => (
          <span key={x} className={`${i === state ? 'on' : ''} ${i >= 2 ? 'tk' : 'nt'}`}>
            <b className="num">{i.toString(2).padStart(2, '0')}</b> {x}
          </span>
        ))}
      </div>
      <p className={`lab-verdict ${over ? (youRight >= botRight ? 'ok' : 'bad') : ''}`} aria-live="polite">
        You {youRight}/{pos}, {simple ? 'guesser' : 'counter'} {botRight}/{pos}.{' '}
        {over ? verdict : state != null && `${simple ? 'The guesser says' : 'The counter predicts'} ${predictTaken(state) ? T : NT}.`}
      </p>
    </section>
  )
}

export default function Pipeline({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const pMHz = s.cpu.pFreqMHz
  const eMHz = s.cpu.eFreqMHz
  const perNs = pMHz ? (1000 / pMHz).toFixed(2) : null
  const live = pMHz
    ? simple
      ? ` Right now this Mac's Fast Workers tick ${(pMHz / 1000).toFixed(2)} billion times a second.`
      : ` Right now this Mac's P cluster runs at ${mhz(pMHz)}: one cycle every ${perNs} ns.`
    : ''
  const pipeDur = (k: PipeKey) => PIPE[k][0].cells.length * PIPE_SPC[k] + 0.4
  const coreDur = (k: CoreKey) => (CORE_HOLD[k] + 1) * CORE_SPC[k] + 0.4
  const steps: Step[] = [
    {
      title: simple ? 'A tiny program' : 'The loop, in real instructions',
      dur: TRACE.length * SEC_PER_INS + 0.3,
      tech: (
        <p>
          A C loop that sums an array compiles to four ARM64 instructions. <code>ldr</code> loads <code>a[i]</code> into <code>x9</code> and bumps the pointer in <code>x0</code> by 8. <code>add</code> adds it to the sum in <code>x8</code>. <code>subs</code> counts <code>x1</code> down and sets the Z flag when it reaches zero. <code>b.ne</code> jumps back while Z is clear. Everything a core does comes down to this: read an instruction, do it, read the next.
        </p>
      ),
      plain: (
        <p>
          Here is a tiny job: add up a list of numbers. The core does it with four small instructions, over and over: grab the next number, add it to the total, count one fewer left, and go back to the top if any are left. Watch the worker's hands, called registers, change after each one.
        </p>
      ),
    },
    {
      title: simple ? 'One instruction at a time' : 'Fetch, decode, execute, one at a time',
      dur: pipeDur('serial'),
      tech: (
        <p>
          Each instruction passes through five stages: fetch it from the instruction cache, decode it, execute it, access memory if it's a load or store, and write the result back to a register. Done strictly one after another, every instruction costs five cycles, so 4 instructions take 20, and most of the hardware sits idle at any moment.{live}
        </p>
      ),
      plain: (
        <p>
          Each instruction takes five steps: read it, understand it, do it, use memory if needed, and save the answer. If the worker finishes one instruction completely before starting the next, four instructions take 20 ticks, and most of its tools sit unused.{live}
        </p>
      ),
    },
    {
      title: simple ? 'An assembly line' : 'Pipelining',
      dur: pipeDur('ideal'),
      tech: (
        <p>
          A pipeline overlaps them like an assembly line. While <code>ldr</code> executes, <code>add</code> decodes and <code>subs</code> is fetched. Once the pipe is full, one instruction finishes every cycle: the same 4 take 8 cycles, and a long loop approaches 1 instruction per cycle. For now this grid pretends no instruction needs another one's result.
        </p>
      ),
      plain: (
        <p>
          Now the worker runs an assembly line. While one instruction is being done, the next is being understood and the one after is being read. Once the line is full, one instruction comes off the end every tick. The same 4 take 8 ticks instead of 20. For now, pretend no instruction needs another one's answer.
        </p>
      ),
    },
    {
      title: simple ? 'Waiting for an answer' : 'A hazard and a stall',
      dur: pipeDur('stall'),
      tech: (
        <p>
          But <code>add x8, x9, x8</code> needs <code>x9</code>, and <code>ldr</code> only has it at the end of its memory stage. Forwarding passes a result straight to the next instruction without waiting for write back, which is in time for ALU results but a cycle late for a load. So the pipe holds <code>add</code> in decode for a cycle and a bubble travels down the line. Putting <code>subs</code> before <code>add</code> would hide the gap; a big core does that reordering by itself.
        </p>
      ),
      plain: (
        <p>
          But the add needs the number that the grab just before it is still fetching. The answer isn't ready in time, so the add waits one tick, and an empty gap travels down the line. Doing the countdown first would fill the gap. Big cores spot gaps like this and fill them on their own, as you'll see soon.
        </p>
      ),
    },
    {
      title: simple ? 'Guessing at forks' : 'Branch prediction and a flush',
      dur: pipeDur('exit'),
      tech: (
        <p>
          The pipe must fetch the next instruction before <code>b.ne</code> has executed, so it guesses. Loop branches are usually taken, so it predicts taken and keeps fetching the next trip. On the last trip that's wrong: when <code>b.ne</code> resolves in execute, the two instructions behind it are flushed and fetch restarts at the fall-through. In this 5-stage pipe a wrong guess costs 2 cycles. In a deep, wide core it throws away far more.
        </p>
      ),
      plain: (
        <p>
          At "any left?" the worker has to pick the next instruction before it knows the answer, so it guesses "yes, go round again". That's right every time but the last. On the last trip the guess is wrong: the two half-done instructions are thrown away and the worker starts again on the right path. Here that wastes 2 ticks.
        </p>
      ),
    },
    {
      title: simple ? 'Many per tick' : 'Superscalar: many per cycle',
      dur: coreDur('wide'),
      tech: (
        <p>
          Apple's P cores are far wider than the textbook pipe. AnandTech measured the M1's Firestorm core decoding 8 instructions per cycle, and Dougall Johnson counted 6 integer units, 4 load and store units and 4 FP/SIMD units. This loop can't fill them: fetch follows one taken branch per cycle, so it gets one trip, 4 instructions, per cycle, and each <code>add</code> waits for the one before. Compilers unroll loops partly for this. Apple hasn't published these figures for M5.
        </p>
      ),
      plain: (
        <p>
          Real Fast Workers are much wider than that. Measured on the M1, one can take in 8 instructions per tick and has 14 tools to do them with. This little loop can't keep them all busy: the worker follows only one jump per tick, so it gets 4 instructions per tick, and each add waits for the one before. Apple hasn't published these figures for the M5.
        </p>
      ),
    },
    {
      title: simple ? 'Out of order, crossed off in order' : 'Rename, out of order, reorder buffer',
      dur: coreDur('slow'),
      tech: (
        <p>
          Every trip writes <code>x9</code> again. Rename gives each write a fresh physical register, so trips don't wait on each other's names. Here trip #2's load misses the cache. The core keeps going: younger loads and counts execute out of order, while each <code>add</code> waits on <code>x8</code>. Results wait in the reorder buffer and retire strictly in program order, so the slow load at the head holds everything, and when the buffer fills, decode stops. AnandTech measured about 630 in flight on Firestorm; this model has 24.
        </p>
      ),
      plain: (
        <p>
          Every trip uses the same hand, x9, so the worker gives each trip a fresh label. Now one grab is slow: that number is far away. The worker doesn't sit idle. It runs ahead and does the jobs that don't need that number. But it crosses jobs off its to-do list strictly in order, so the slow one at the top holds up the list, and once the list is full, it has to stop. On the M1 the list holds about 630 jobs.
        </p>
      ),
    },
    {
      title: simple ? 'A wrong guess in a big core' : 'Misprediction in a wide core',
      dur: coreDur('flush'),
      tech: (
        <p>
          The core runs past branches on the predictor's word. Here the final <code>b.ne</code> is predicted taken, so a whole extra trip is decoded and partly executed. When the branch executes, everything younger is flushed and fetch restarts at the fall-through. Dougall Johnson measured about 144 branches in flight on Firestorm. On this Mac, a loop with <code>if (a[i] {'>='} 128)</code> over random bytes ran 9 to 11 times slower than over the same bytes sorted, because about half the guesses missed.
        </p>
      ),
      plain: (
        <p>
          Big workers guess far ahead and do the guessed work before they know. Here the worker guesses "go round again" at the end, starts a whole extra trip, then finds out the list had ended and throws that work away. On this Mac, a loop that checks random numbers ran 9 to 11 times slower than the same loop over the same numbers sorted, just because about half the guesses were wrong.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const { i, t } = story
  let scene
  if (i === 0) scene = <ProgScene t={t} />
  else if (i <= 4) {
    const k = (['serial', 'ideal', 'stall', 'exit'] as const)[i - 1]
    scene = <PipeScene rows={PIPE[k]} k={k} cycle={Math.min(PIPE[k][0].cells.length - 1, Math.floor(t / PIPE_SPC[k]))} />
  } else {
    const k = (['wide', 'slow', 'flush'] as const)[i - 5]
    scene = <CoreScene k={k} cycle={Math.min(CORE_HOLD[k], Math.floor(t / CORE_SPC[k]))} />
  }

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          simple
            ? 'A tick is one beat of the clock, and the story below moves one tick at a time. All the Fast Workers share one clock, and so do all the Eco Workers.'
            : 'Each cluster has one clock, so these are per cluster. A cycle is one tick; the pipeline below moves one stage per cycle.'
        }
      >
        <LiveStat label={simple ? 'Fast Worker clock' : 'P cluster clock'} value={mhz(pMHz)} sub={<Sparkline values={history.map((x) => x.cpu.pFreqMHz)} w={90} h={18} label="P cluster clock over the last minutes" />} />
        <LiveStat label={simple ? 'Eco Worker clock' : 'E cluster clock'} value={mhz(eMHz)} sub={simple ? 'slower, uses less energy' : 'efficiency cores'} />
        <LiveStat label={simple ? 'One tick lasts' : 'One P cycle lasts'} value={perNs ? `${perNs} ns` : 'n/a'} sub={simple ? '1 ns is a billionth of a second' : '1 / clock'} />
        <LiveStat
          label={simple ? 'Ticks a second, all Fast Workers' : 'P cycles a second, all P cores'}
          value={pMHz ? `${((pMHz * hw.pCores) / 1000).toFixed(1)} billion` : 'n/a'}
          sub={`${hw.chip}: ${hw.pCores} ${simple ? 'Fast' : 'P'} + ${hw.eCores} ${simple ? 'Eco' : 'E'}`}
        />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">{scene}</div>
        <StepBar story={story} steps={steps} />
      </section>

      <BranchGame />

      <Deeper title={simple ? 'What this means for your Mac' : "Inside Apple's cores"}>
        {simple ? (
          <>
            <p>
              Your Mac has {hw.pCores} Fast Workers and {hw.eCores} Eco Workers. Each Fast Worker is a very wide version of the assembly line above: it reads far ahead, guesses at every fork, does jobs out of order, and crosses them off in order. Eco Workers use the same tricks on a smaller scale, so they use much less energy.
            </p>
            <ul>
              <li>Code runs fastest when its forks are easy to guess and its numbers are close at hand.</li>
              <li>Clock speed alone doesn't tell you how fast a worker is. How many instructions it finishes per tick matters just as much.</li>
              <li>Apple doesn't publish how wide this Mac's M5 cores are. The figures here were measured on the M1 by people outside Apple.</li>
            </ul>
          </>
        ) : (
          <>
            <p>
              Speed is clock rate times instructions per cycle. Apple's P cores run at lower clocks than desktop x86 chips and make it up in width: the M1's Firestorm decodes 8 instructions a cycle, holds about 630 in flight, and has 6 integer, 4 load and store and 4 FP/SIMD units. Fixed 4-byte instructions help, because every instruction boundary is known before decoding starts.
            </p>
            <ul>
              <li>
                Firestorm fuses <code>subs</code> with the <code>b.ne</code> after it into one operation, and handles many <code>mov</code> instructions in rename without executing them, both measured by Dougall Johnson.
              </li>
              <li>Real predictors go far beyond a 2-bit counter. They index tables by long histories of recent branches, which is how they learn patterns like "every third" that the game's counter can't.</li>
              <li>These measurements are for M1. Apple doesn't publish microarchitecture details, and none of the sources below measured M5 cores this way, so this lab quotes no M5 widths.</li>
              <li>To see a misprediction cost yourself, time a loop that sums the elements of a random array that are at least 128, then sort the array and time it again. Same instructions, same data, fewer wrong guesses.</li>
            </ul>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'AnandTech, Apple M1 and A14 deep dive (2020), archived', url: 'https://web.archive.org/web/20201111212303/https://www.anandtech.com/show/16226/apple-silicon-m1-a14-deep-dive/2', note: 'Firestorm decodes 8 instructions per cycle and has a reorder buffer about 630 deep, measured. AnandTech has closed, so this is the Internet Archive copy.' },
          { title: 'Dougall Johnson, Firestorm overview', url: 'https://dougallj.github.io/applecpu/firestorm.html', note: 'Reverse-engineered M1 P core: 8 uops per cycle, one taken branch per cycle, the execution units, load latency, about 144 branches in flight, subs and b.ne fusion.' },
          { title: 'Dan Luu, Branch prediction', url: 'https://danluu.com/branch-prediction/', note: 'Why pipelines need prediction, 2-bit saturating counters, and history-based predictors, with a cost model.' },
          { title: 'Wikipedia, Classic RISC pipeline', url: 'https://en.wikipedia.org/wiki/Classic_RISC_pipeline', note: 'The five stages, forwarding, and the one-cycle load-use stall.' },
          { title: 'Wikipedia, Re-order buffer', url: 'https://en.wikipedia.org/wiki/Re-order_buffer', note: 'Out-of-order execution with in-order retirement.' },
          { title: 'Eclectic Light, CPU core frequencies for all Apple silicon Macs (2026)', url: 'https://eclecticlight.co/2026/04/13/cpu-core-frequencies-updated-for-all-current-apple-silicon-macs/', note: 'P and E clock ranges from M1 to M5, to compare with the live readings.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac (Apple M5, Apple clang 21): <code>clang -O1 -S</code> of the C loop gives exactly the four instructions shown. A C benchmark adding up the elements of a million-element array of random values 0 to 255 that are at least 128, built with <code>clang -O1</code> so the <code>if</code> stays a branch, took 2.6 ns per element in random order and 0.24 to 0.30 ns with the same values sorted. <code>sysctl hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu</code> prints 4 and 6.
      </p>
    </div>
  )
}
