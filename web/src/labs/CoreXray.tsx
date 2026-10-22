import { useEffect, useRef, useState } from 'react'
import type { Sample } from '../types.ts'
import { mhz, num, pct } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, lerp, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { QOS, pickedUp, qosOfPriority } from './sched.ts'
import './CoreXray.css'

// One core's life in a picture: the run queue on the left, the core in the middle with its registers, the clock above
// it, and the clock ladder (DVFS table) on the right. Coordinates are in the SVG's 960 x 470 viewBox.

const CORE = { x: 300, y: 110, w: 330, h: 250 }
const QUEUE = { x: 20, y: 110, w: 200 }
const LADDER = { x: 700, y: 110, w: 240, h: 250 }
const KERNEL = { x: 20, y: 410, w: 920, h: 40 }
const SAVE = { x: 20, y: 290, w: 200, h: 60 }
const IRQ_PATH: [number, number][] = [
  [120, 385],
  [CORE.x - 20, 385],
  [CORE.x + 30, CORE.y + CORE.h - 10],
]
const QUEUE_OUT: [number, number] = [QUEUE.x + QUEUE.w, QUEUE.y + 30]
const REGS_AT: [number, number] = [CORE.x + CORE.w / 2, CORE.y + 150]
const SAVE_AT: [number, number] = [SAVE.x + SAVE.w, SAVE.y + 30]

type Power = 'on' | 'clock' | 'off'
type Frame = {
  power: Power
  /** 0..1 up the clock ladder; ignored unless the power is on. */
  level: number
  running: string | null
  regs: string[] | null
  queue: string[]
  saved: string | null
  tokens: { at: [number, number]; label: string; kind: 'irq' | 'a' | 'b' }[]
  kernel: string
}

const REGS_A = ['x0  0x1', 'x1  0x16f2', 'pc  0x1a40', 'sp  0x6f70']
const REGS_B = ['x0  0x0', 'x1  0x88', 'pc  0x3c18', 'sp  0x5e20']

function frame(i: number, t: number, a: string, b: string, simple: boolean): Frame {
  const f: Frame = { power: 'on', level: 0, running: null, regs: null, queue: [], saved: null, tokens: [], kernel: '' }
  const pick = (tech: string, plain: string) => (simple ? plain : tech)
  switch (i) {
    case 0:
      f.power = t < 1.2 ? 'on' : 'clock'
      f.level = lerp(0.15, 0, phase(t, 0, 1.2))
      f.kernel = t < 1.2 ? pick('Run queue empty: the idle thread executes WFI.', 'Nothing left to do. macOS tells the worker to rest.') : pick('WFI: low-power wait, clock stopped, state kept.', 'The worker rests with its clock stopped.')
      break
    case 1:
      f.power = t < 1.5 ? 'clock' : 'off'
      f.kernel = t < 1.5 ? pick('Still idle. The power controller can go deeper.', 'Still nothing to do.') : pick('Power gated: state saved, then power cut, so it leaks almost nothing.', 'Power switched off. Its notes were saved first.')
      break
    case 2:
      f.power = t < 1.6 ? 'off' : 'on'
      f.level = phase(t, 1.6, 2.6) * 0.1
      f.queue = [a, b]
      if (t < 1.8) f.tokens.push({ at: along(IRQ_PATH, phase(t, 0.2, 1.6)), label: pick('IRQ', 'wake up!'), kind: 'irq' })
      f.kernel = t < 1.6 ? pick('An interrupt arrives: a timer, a device, or an IPI from another core.', 'A timer or another worker taps this one on the shoulder.') : pick('Power and clock restored; the core enters the kernel.', 'Power back on, clock running.')
      break
    case 3:
      f.queue = t < 0.2 ? [a, b] : [b]
      if (t >= 0.2 && t < 1.4) f.tokens.push({ at: along([QUEUE_OUT, [CORE.x + 60, CORE.y + 60]], phase(t, 0.2, 1.4)), label: a, kind: 'a' })
      if (t >= 1.4) f.running = a
      if (t >= 1.6) f.regs = REGS_A
      f.level = lerp(0.1, 0.92, phase(t, 1.8, 4.2))
      f.kernel = t < 1.4 ? pick('The scheduler picks the highest priority thread from the run queue.', 'macOS hands the worker the next job.') : pick('Running user code. The performance controller raises the clock while the core stays busy.', 'Working, and speeding up as the job keeps going.')
      break
    case 4:
      f.running = a
      f.regs = REGS_A
      f.queue = [b]
      f.level = 0.92
      if (t < 1.4) f.tokens.push({ at: along(IRQ_PATH, phase(t, 0.2, 1.4)), label: pick('timer', 'time!'), kind: 'irq' })
      f.kernel = t < 1.4 ? pick('The time slice runs out: a timer interrupt enters the kernel.', 'A timer rings: this job has had its turn.') : pick(`${b} is ready at the same priority, so ${a} is preempted.`, `${b} is waiting, so it gets the next turn.`)
      break
    case 5:
      f.level = 0.92
      f.queue = t < 3 ? [] : [a]
      if (t < 1.6) {
        f.running = a
        f.regs = REGS_A
        f.tokens.push({ at: along([REGS_AT, SAVE_AT], phase(t, 0.3, 1.6)), label: pick(`${a} regs`, `${a} notes`), kind: 'a' })
      } else f.saved = a
      if (t >= 1.8 && t < 3) f.tokens.push({ at: along([QUEUE_OUT, REGS_AT], phase(t, 1.8, 3)), label: pick(`${b} regs`, `${b} notes`), kind: 'b' })
      if (t >= 3) {
        f.running = b
        f.regs = REGS_B
      }
      f.kernel =
        t < 1.6
          ? pick(`Save ${a}: registers, pc, sp and FP/SIMD state go to its thread in memory.`, `The worker writes down where ${a} was up to.`)
          : t < 3
            ? pick(`Load ${b}'s saved state, and its address space if it is another process.`, `It picks up ${b}'s notes.`)
            : pick(`${b} resumes where it stopped. ${a} waits in the queue.`, `${b} carries on exactly where it stopped.`)
      break
    case 6:
      f.running = t < 1.2 ? b : null
      f.regs = t < 1.2 ? REGS_B : null
      f.saved = a
      f.power = t < 2.2 ? 'on' : 'clock'
      f.level = lerp(0.92, 0, phase(t, 1.2, 2.2))
      f.kernel = t < 1.2 ? pick(`${b} blocks on I/O and leaves the run queue.`, `${b} has to wait for the network, so it steps aside.`) : pick('Nothing runnable here: the clock drops and the idle thread executes WFI.', 'Nothing ready. Clock down, then rest.')
      break
  }
  return f
}

function Scene({ f, ladder, label }: { f: Frame; ladder: number[]; label: string }) {
  const simple = useSimple()
  const top = ladder.length - 1
  const idx = f.power === 'on' ? Math.round(f.level * top) : -1
  const cur = idx >= 0 ? ladder[idx] : null
  const peak = Math.max(...ladder)
  // More cycles drawn for a faster clock, a flat line while gated.
  const cycles = cur ? Math.round(4 + (cur / peak) * 14) : 0
  const cw = CORE.w / Math.max(1, cycles)
  const wave = cycles
    ? Array.from({ length: cycles }, (_, k) => {
        const x = CORE.x + k * cw
        return `L ${x} 82 L ${x} 62 L ${x + cw / 2} 62 L ${x + cw / 2} 82 L ${x + cw} 82`
      }).join(' ')
    : `L ${CORE.x + CORE.w} 82`
  const bw = LADDER.w / ladder.length
  return (
    <svg className="cx-scene" viewBox="0 0 960 470" role="img" aria-label="One core of this Mac: its run queue, registers, clock and power state">
      <text className="cx-head" x={QUEUE.x} y={96}>
        {simple ? 'Jobs waiting' : 'Run queue'}
      </text>
      {f.queue.map((q, n) => (
        <g key={q} className="cx-pill">
          <rect x={QUEUE.x} y={QUEUE.y + 12 + n * 44} width={QUEUE.w} height={36} rx={18} />
          <text x={QUEUE.x + 16} y={QUEUE.y + 35 + n * 44}>
            {q}
          </text>
        </g>
      ))}
      {!f.queue.length && (
        <text className="cx-dim" x={QUEUE.x} y={QUEUE.y + 35}>
          empty
        </text>
      )}
      <g className="cx-save">
        <rect x={SAVE.x} y={SAVE.y} width={SAVE.w} height={SAVE.h} rx={10} />
        <text className="cx-dim" x={SAVE.x + 12} y={SAVE.y + 22}>
          {simple ? 'Saved notes, in memory' : 'Saved thread state, RAM'}
        </text>
        <text x={SAVE.x + 12} y={SAVE.y + 44}>
          {f.saved ?? '·'}
        </text>
      </g>

      <text className="cx-head" x={CORE.x} y={44}>
        {simple ? 'Its clock' : 'Core clock'}
        <tspan className="cx-dim"> {cur ? `${num(cur)} MHz` : simple ? 'stopped' : 'stopped, gated'}</tspan>
      </text>
      <path className={`cx-wave ${cycles ? 'on' : ''}`} d={`M ${CORE.x} 82 ${wave}`} />

      <g className={`cx-core p-${f.power}`}>
        <rect x={CORE.x} y={CORE.y} width={CORE.w} height={CORE.h} rx={16} />
        <text className="cx-head" x={CORE.x + 18} y={CORE.y + 30}>
          {label}
        </text>
        <text className="cx-state" x={CORE.x + CORE.w - 18} y={CORE.y + 30} textAnchor="end">
          {f.power === 'off' ? (simple ? 'power off' : 'power gated') : f.power === 'clock' ? (simple ? 'resting' : 'WFI, clock gated') : f.running ? (simple ? 'working' : 'running') : simple ? 'awake' : 'in kernel'}
        </text>
        <text x={CORE.x + 18} y={CORE.y + 68}>
          <tspan className="cx-dim">{simple ? 'Job: ' : 'Thread: '}</tspan>
          {f.running ?? (f.power === 'on' ? (simple ? 'macOS itself' : 'kernel') : simple ? 'none' : 'idle thread')}
        </text>
        <text className="cx-dim" x={CORE.x + 18} y={CORE.y + 104}>
          {simple ? 'Where it is up to' : 'Registers'}
        </text>
        {[0, 1, 2, 3].map((r) => (
          <g key={r} className={`cx-reg ${f.regs ? 'on' : ''}`}>
            <rect x={CORE.x + 18 + (r % 2) * 150} y={CORE.y + 114 + Math.floor(r / 2) * 42} width={140} height={34} rx={6} />
            <text x={CORE.x + 30 + (r % 2) * 150} y={CORE.y + 136 + Math.floor(r / 2) * 42}>
              {f.regs ? f.regs[r] : f.power === 'off' ? (simple ? 'saved' : 'saved, no power') : '·'}
            </text>
          </g>
        ))}
      </g>

      <text className="cx-head" x={LADDER.x} y={96}>
        {simple ? 'Speed steps' : 'DVFS states'}
      </text>
      {ladder.map((m, n) => {
        const h = 24 + (m / peak) * (LADDER.h - 40)
        return <rect key={n} className={`cx-step ${n === idx ? 'on' : n < idx ? 'below' : ''}`} x={LADDER.x + n * bw} y={LADDER.y + LADDER.h - h} width={Math.max(2, bw - 3)} height={h} rx={2} />
      })}
      <text className="cx-dim" x={LADDER.x} y={LADDER.y + LADDER.h + 22}>
        {num(ladder[0])} MHz
      </text>
      <text className="cx-dim" x={LADDER.x + LADDER.w} y={LADDER.y + LADDER.h + 22} textAnchor="end">
        {num(peak)} MHz
      </text>

      <text className="cx-dim" x={IRQ_PATH[0][0]} y={IRQ_PATH[0][1] - 10} textAnchor="middle">
        {simple ? 'timers, other workers' : 'timers, devices, IPIs'}
      </text>
      <g className="cx-kernel">
        <rect x={KERNEL.x} y={KERNEL.y} width={KERNEL.w} height={KERNEL.h} rx={8} />
        <text x={KERNEL.x + 14} y={KERNEL.y + 25}>
          <tspan className="cx-kernel-k">{simple ? 'macOS' : 'Kernel'}</tspan> {f.kernel}
        </text>
      </g>

      {f.tokens.map((tk, n) => (
        <g key={n} className={`cx-token ${tk.kind}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
          <rect x={-tk.label.length * 4.2 - 10} y={-12} width={tk.label.length * 8.4 + 20} height={24} rx={12} />
          <text y={4} textAnchor="middle">
            {tk.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** One tile per core: load now, clock, where its last second went, and the last minutes of load. */
function CoreTile({ id, kind, s, history, ladder }: { id: number; kind: 'P' | 'E'; s: Sample; history: Sample[]; ladder: number[] }) {
  const simple = useSimple()
  const usage = s.cpu.cores[id]?.usage ?? null
  const sc = s.sched?.cores[id]
  const res = sc?.res ?? null
  const peak = Math.max(1, ...ladder)
  const asleep = sc?.active != null && sc.active < 0.005
  return (
    <div className={`cx-tile k-${kind} ${usage != null && usage > 0.6 ? 'hot' : ''}`}>
      <div className="cx-tile-head">
        <span className="cx-tile-id">
          {kind === 'P' ? (simple ? 'Fast' : 'P') : simple ? 'Eco' : 'E'} {id}
        </span>
        <span className="cx-tile-load num">{pct(usage)}</span>
      </div>
      <div className="cx-tile-clock">
        {sc?.freqMHz == null ? <span className="na">clock n/a</span> : asleep ? (simple ? 'resting' : 'idle all second') : <span className="num">{mhz(sc.freqMHz)}</span>}
      </div>
      <div className="cx-res" role="img" aria-label={res ? `Awake ${pct(sc?.active)} of the last second, split by clock speed` : 'Residency not available'}>
        {res?.map((r, n) => (r > 0.002 ? <span key={n} style={{ width: `${r * 100}%`, opacity: 0.3 + 0.7 * (ladder[n] / peak) }} /> : null))}
      </div>
      <Sparkline values={history.map((x) => x.cpu.cores[id]?.usage ?? null)} max={1} w={120} h={22} color={kind === 'P' ? 'var(--accent)' : 'var(--ok)'} label={`Core ${id} load over the last minutes`} />
      {sc && (
        <div className="cx-tile-irq">
          {simple ? 'taps' : 'IRQ'} <span className="num">{num(sc.irqs)}</span>/s · {simple ? 'from others' : 'IPI'} <span className="num">{num(sc.ipis)}</span>/s
        </div>
      )}
    </div>
  )
}

function Grid({ s, history, hw }: Pick<LabProps, 's' | 'history' | 'hw'>) {
  const simple = useSimple()
  const sc = s.sched
  const groups = (['P', 'E'] as const).map((k) => ({ k, ids: s.cpu.cores.filter((c) => c.kind === k).map((c) => c.id) })).filter((g) => g.ids.length)
  return (
    <section className="card">
      <h3>{simple ? `Every worker in the ${hw.chip}, right now` : `Every core in the ${hw.chip}, live`}</h3>
      {groups.map(({ k, ids }) => {
        const table = (k === 'P' ? sc?.pStatesMHz : sc?.eStatesMHz) ?? []
        return (
          <div key={k} className="cx-cluster">
            <h4>
              {k === 'P' ? (simple ? `${ids.length} Fast Workers` : `${ids.length} P cores`) : simple ? `${ids.length} Eco Workers` : `${ids.length} E cores`}
              {table.length > 0 && (
                <span className="cx-cluster-sub">
                  {simple ? 'top speed' : `${table.length} DVFS states, up to`} {mhz(Math.max(...table))}
                </span>
              )}
            </h4>
            <div className="cx-tiles">
              {ids.map((id) => (
                <CoreTile key={id} id={id} kind={k} s={s} history={history} ladder={table} />
              ))}
            </div>
          </div>
        )
      })}
      <p className="fine">
        {sc == null
          ? 'This reader is older than the cores and threads update, so clocks, residency and interrupts show n/a. Pull the repo and run ./run.sh again.'
          : simple
            ? 'The big number is how busy each worker was. The bar shows the part of the last second it was awake, brighter where it ran faster; the empty part is rest. The line is the last minutes.'
            : 'Load from host_processor_info. The bar is IOReport residency for the last second: one segment per DVFS state, brighter for higher clocks; the empty part is hardware idle. IRQ and IPI are per second, from PROCESSOR_CPU_STAT64.'}
      </p>
    </section>
  )
}

const STATE_WORD: Record<string, [string, string]> = {
  run: ['running or ready', 'working or next up'],
  wait: ['waiting', 'waiting'],
  uninterruptible: ['waiting, uninterruptible', 'waiting on the disk'],
  stopped: ['stopped', 'paused'],
  halted: ['halted', 'finished'],
}

function Threads({ s }: { s: Sample }) {
  const simple = useSimple()
  const t = s.sched?.threads
  return (
    <section className="card">
      <h3>{simple ? 'The busiest jobs' : 'Busiest threads, last 5 seconds'}</h3>
      {t == null ? (
        <p className="fine">Not available from this reader.</p>
      ) : (
        <div className="cx-table-wrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th>{simple ? 'App' : 'Process'}</th>
                <th>{simple ? 'Job' : 'Thread'}</th>
                <th className="r">{simple ? 'Busy' : 'CPU'}</th>
                <th className="r">{simple ? 'Rank' : 'Priority'}</th>
                <th>{simple ? 'Urgency' : 'QoS band'}</th>
                <th>{simple ? 'Doing' : 'State'}</th>
              </tr>
            </thead>
            <tbody>
              {t.map((x, n) => {
                const q = qosOfPriority(x.basePri)
                return (
                  <tr key={n}>
                    <td className="cx-proc">{x.proc}</td>
                    <td className="cx-tname">{x.name || <span className="cx-dimtext">{simple ? 'no name' : 'unnamed'}</span>}</td>
                    <td className="r num">{x.cpu.toFixed(1)}%</td>
                    <td className="r num" title={`current ${x.pri}, base ${x.basePri}`}>
                      {x.pri}
                      {x.pri !== x.basePri && <span className="cx-dimtext"> of {x.basePri}</span>}
                    </td>
                    <td>
                      <span className={`cx-qos q-${q}`}>{q === 'above' ? (simple ? 'top' : x.policy === 'timeshare' ? 'above QoS' : `fixed, ${x.policy}`) : simple ? QOS[q].plain : QOS[q].tech}</span>
                    </td>
                    <td>{STATE_WORD[x.state][simple ? 1 : 0]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine">
        {simple
          ? 'Only apps you started are listed: macOS keeps its own system jobs private unless you use an admin password. macOS also does not say which worker each job is on, so this list and the tiles above stay separate.'
          : 'From proc_pidinfo PROC_PIDTHREADINFO, for processes this user may inspect; root processes are refused without sudo. The QoS band is inferred from the base priority. "Running or ready" is one kernel state, TH_STATE_RUNNING. macOS does not expose which core a thread is on without root, so threads are not tied to tiles.'}
      </p>
    </section>
  )
}

const SPIN_SECONDS = 30

/** Spins one Web Worker for up to 30 s, and says which cluster's load rose. */
function TryIt({ s, demo }: { s: Sample; demo: boolean }) {
  const simple = useSimple()
  const [on, setOn] = useState(false)
  const [left, setLeft] = useState(0)
  const worker = useRef<Worker | null>(null)
  const before = useRef<Sample['cpu']['cores'] | null>(null)
  const stop = () => {
    worker.current?.terminate()
    worker.current = null
    setOn(false)
  }
  const start = () => {
    const url = URL.createObjectURL(new Blob(['let x = 0; for (;;) x = (x + 1) | 0'], { type: 'text/javascript' }))
    worker.current = new Worker(url)
    URL.revokeObjectURL(url)
    before.current = s.cpu.cores
    setLeft(SPIN_SECONDS)
    setOn(true)
  }
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(id)
  }, [on])
  useEffect(() => {
    if (on && left <= 0) stop()
  }, [on, left])
  useEffect(() => () => worker.current?.terminate(), [])
  const who = on && before.current && SPIN_SECONDS - left >= 2 ? pickedUp(before.current, s.cpu.cores) : null
  const verdict = demo
    ? 'This is demo data, so the tiles will not react. Open the page from the reader to see your own cores.'
    : !on
      ? simple
        ? 'Press start and watch the tiles above.'
        : 'Press start, then watch the tiles above and this line.'
      : who == null
        ? simple
          ? 'Spinning. Waiting to see which worker picks it up.'
          : 'Spinning. Waiting for a cluster to show about one extra core of load.'
        : who === 'P'
          ? simple
            ? 'A Fast Worker picked it up. Look at its speed: near the top of its steps.'
            : 'A P core picked it up. Look at its clock: a busy P core climbs its DVFS table.'
          : who === 'E'
            ? simple
              ? 'An Eco Worker picked it up. The browser may have marked this job as not urgent.'
              : 'The E cluster picked it up: the browser probably runs this worker at a low QoS.'
            : simple
              ? 'Both kinds of worker got busier. Something else may be running too.'
              : 'Both clusters rose. Other work changed at the same time; try again when the Mac is quiet.'
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: make one worker busy' : 'Try it: make one core busy'}</h3>
      <p className="fine">
        {simple
          ? 'This starts one endless counting loop inside this page, as its own job. It stops by itself after 30 seconds, or when you press stop or leave the page.'
          : 'Starts one Web Worker running an empty loop: one thread, always runnable. It stops after 30 s, on Stop, or when you leave the lab. It uses one core and no extra memory.'}
      </p>
      <div className="lab-try-row">
        <button type="button" className="lab-btn lab-play" onClick={on ? stop : start} aria-pressed={on}>
          {on ? `Stop, ${left} s left` : simple ? 'Start one busy job' : 'Start one spinning thread'}
        </button>
      </div>
      <p className={`lab-verdict ${who ? 'ok' : ''}`} aria-live="polite">
        {verdict}
      </p>
      <p className="fine">{simple ? 'Or from Terminal. Press Ctrl-C to stop it:' : 'Or from Terminal. Ctrl-C stops it:'}</p>
      <pre className="cx-cmd">
        <code>yes {'>'} /dev/null</code>
      </pre>
      <p className="fine">
        {simple
          ? 'That keeps one Fast Worker busy. Then try the same thing labelled as unimportant, and watch it move to an Eco Worker running slowly:'
          : 'A plain loop runs at default priority and lands on a P core. Then try the same loop in the Darwin background state, which keeps it on the E cores at a low clock:'}
      </p>
      <pre className="cx-cmd">
        <code>taskpolicy -b yes {'>'} /dev/null</code>
      </pre>
    </section>
  )
}

export default function CoreXray({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const sc = s.sched
  const pCores = s.cpu.cores.filter((c) => c.kind === 'P')
  const star = [...pCores].sort((x, y) => y.usage - x.usage)[0] ?? s.cpu.cores[0]
  const table = star?.kind === 'E' ? sc?.eStatesMHz : sc?.pStatesMHz
  const live = !!table?.length
  const ladder = live ? table! : [1000, 1500, 2000, 2500, 3000, 3500, 4000]
  const names = [...new Set((sc?.threads ?? []).map((x) => x.proc.split(' ')[0]))]
  const a = names[0] ?? 'Safari'
  const b = names.find((x) => x !== a) ?? 'Mail'
  const me = star ? sc?.cores[star.id] : undefined
  const idle = me?.active == null ? null : 1 - me.active
  const kindWord = star?.kind === 'E' ? 'E' : 'P'
  const say = (v: number | null | undefined, unit: string) => (v == null ? '' : ` Right now: ${num(v)} ${unit}.`)
  const steps: Step[] = [
    {
      title: simple ? 'Nothing to do: rest' : 'Idle: wait for interrupt',
      dur: 2.4,
      tech: (
        <p>
          When a core's run queue is empty, the kernel runs its idle thread, which executes <code>WFI</code>, wait for interrupt. The core stops fetching instructions and drops into a low-power state until an interrupt arrives. The lightest form of that is clock gating: the clock signal stops reaching the logic, so nothing switches, but power stays on and registers and caches keep their contents, so waking is quick.
          {idle == null ? '' : ` ${kindWord} core ${star.id}, the busiest one, spent ${pct(idle)} of the last second idle.`}
        </p>
      ),
      plain: (
        <p>
          When a worker has no jobs, macOS tells it to rest until someone taps it on the shoulder. Its clock stops, so it uses almost no energy, but it keeps everything it was holding, so it can start again quickly.
          {idle == null ? '' : ` Worker ${star.id}, the busiest Fast Worker, rested ${pct(idle)} of the last second.`}
        </p>
      ),
    },
    {
      title: simple ? 'Resting deeper' : 'Deeper idle: power gating',
      dur: 2.6,
      tech: (
        <p>
          If the core stays idle, it can go further and have its power cut. A stopped clock still leaks some current; a power-gated block leaks almost none. The price is time: state has to be saved before and restored after, so a deeper idle state takes longer to leave, and is only worth entering for a longer sleep. The counters on this Mac only say idle or not, not how deep, so this step shows the general mechanism, not a reading.
        </p>
      ),
      plain: (
        <p>
          If nothing comes for a while, the worker can switch off completely to save even more. It writes down what it was doing first, and waking up takes a little longer, so it only does this when the rest looks like it will be long. This Mac's counters say when a worker rests, but not how deeply, so this part is how it works in general.
        </p>
      ),
    },
    {
      title: simple ? 'A tap on the shoulder' : 'An interrupt wakes it',
      dur: 2.8,
      tech: (
        <p>
          Only an interrupt ends the wait: a timer firing, a device finishing, or an inter-processor interrupt, an IPI, which is one core poking another. XNU sends one when it wants another core to check its run queue and reschedule. Power and clock come back and the core enters the kernel.
          {say(me?.irqs, 'interrupts a second on this core')}
          {say(me?.ipis, 'IPIs a second')}
        </p>
      ),
      plain: (
        <p>
          A resting worker only wakes when something taps it: a timer going off, a part of the Mac finishing a task, or another worker saying there's a job waiting. Then power and clock come back.
          {say(me?.irqs, 'taps a second on this worker')}
        </p>
      ),
    },
    {
      title: simple ? 'Working, and speeding up' : 'Running: the clock climbs',
      dur: 4.6,
      tech: (
        <p>
          The scheduler takes the highest priority thread from the run queue and loads its registers. While the core stays busy, Apple's performance controller steps the cluster up the DVFS table on the right: higher clock, higher voltage, more power.
          {live ? ` These are the real states of this Mac's ${kindWord} cluster, ${num(ladder[0])} to ${num(Math.max(...ladder))} MHz.` : ' This reader sends no DVFS table, so the steps here are made up.'}
          {me?.freqMHz == null || idle === 1 ? '' : ` Core ${star.id} averaged ${mhz(me.freqMHz)} while awake in the last second.`}
        </p>
      ),
      plain: (
        <p>
          The worker takes the most urgent job and gets going. The longer it stays busy, the faster macOS lets it run, one step at a time. Faster costs more energy, so it only speeds up when there is work.
          {live ? ` These are this Mac's real speed steps, from ${num(ladder[0])} to ${num(Math.max(...ladder))} MHz.` : ''}
        </p>
      ),
    },
    {
      title: simple ? 'Time is up' : 'The time slice ends',
      dur: 2.8,
      tech: (
        <p>
          Threads at the same priority share a core in turns. A timer interrupt marks the end of a thread's quantum: on macOS 10 ms for interactive and default work, 4 ms for utility and 2 ms for background. If a thread of equal or higher priority is waiting, the running one is preempted. If not, it simply carries on.
        </p>
      ),
      plain: (
        <p>
          Jobs of the same importance take turns. A timer rings when one job's turn is over, after a few thousandths of a second, and if another job is waiting, it gets the worker next. If nobody is waiting, the same job keeps going.
        </p>
      ),
    },
    {
      title: simple ? 'Swapping jobs' : 'Context switch',
      dur: 4,
      tech: (
        <p>
          A context switch saves everything that makes {a} {a} on this core, its general registers, program counter, stack pointer and floating point state, into its thread structure in memory, then loads {b}'s. If {b} belongs to another process, the core also switches address space. {b} resumes exactly where it was stopped, with no idea it ever left.
          {say(sc?.contextSwitches, 'context switches a second across your apps')}
        </p>
      ),
      plain: (
        <p>
          To swap jobs, the worker writes down exactly where {a} was up to, then picks up {b}'s notes and carries on from where {b} stopped. {b} never notices it was paused.
          {say(sc?.contextSwitches, 'swaps a second across your apps')}
        </p>
      ),
    },
    {
      title: simple ? 'Back to rest' : 'Blocked, then idle again',
      dur: 3,
      tech: (
        <p>
          Most threads run for a moment and then block, waiting for a disk read, a network packet or the next frame. A blocked thread leaves the run queue entirely. With nothing runnable, the clock steps down and the idle thread issues WFI again. On a quiet Mac most cores spend most of each second here, which is why the bars in the grid are mostly empty.
        </p>
      ),
      plain: (
        <p>
          Most jobs work for a moment and then wait for something, like a file or the internet. While they wait they step aside. With nothing left, the worker slows down and rests again. On a quiet Mac, workers rest most of the time, which is why the bars in the grid are mostly empty.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const f = frame(story.i, story.t, a, b, simple)
  const eCount = s.cpu.cores.length - pCores.length

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          sc == null
            ? 'This reader is older than the cores and threads update, so only per-core load is live. Pull the repo and run ./run.sh again.'
            : simple
              ? 'Thousands of jobs exist, but only a handful want a worker at any moment. The rest are waiting for something.'
              : 'Thread and task counts from processor_set_statistics; context switches summed from proc_taskinfo over the processes this user may inspect.'
        }
      >
        <LiveStat label={simple ? 'Workers' : 'Cores'} value={`${pCores.length} + ${eCount}`} sub={simple ? 'Fast + Eco' : 'P + E'} />
        <LiveStat label={simple ? 'Jobs on this Mac' : 'Threads'} value={num(sc?.systemThreads)} sub={sc?.systemTasks == null ? undefined : `${num(sc.systemTasks)} ${simple ? 'apps and helpers' : 'processes'}`} />
        <LiveStat label={simple ? 'Wanting a worker' : 'Load average'} value={num(sc?.loadAvg, 2)} sub={simple ? 'on average, last minute' : 'runnable, 1 min'} />
        <LiveStat
          label={simple ? 'Job swaps' : 'Context switches'}
          value={sc?.contextSwitches == null ? 'n/a' : `${num(sc.contextSwitches)}/s`}
          sub={<Sparkline values={history.map((x) => x.sched?.contextSwitches ?? null)} w={90} h={18} label="Context switches over the last minutes" />}
        />
      </LiveStrip>

      <Grid s={s} history={history} hw={hw} />

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene f={f} ladder={ladder} label={simple ? `${star?.kind === 'E' ? 'Eco' : 'Fast'} Worker ${star?.id ?? 0}` : `${kindWord} core ${star?.id ?? 0}`} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <Threads s={s} />

      <TryIt s={s} demo={demo} />

      <Deeper title={simple ? "What the Mac will and won't tell you" : 'What can be read without root, and what cannot'}>
        {simple ? (
          <>
            <p>Without an admin password, an app like this one can see how busy each worker is, how fast it ran, how often it was tapped awake, and the busiest jobs of the apps you started.</p>
            <p>It can't see which worker each job is on at this exact moment. macOS only shares that with admin tools, so this page never guesses it.</p>
          </>
        ) : (
          <>
            <p>Everything on this page comes from interfaces that work as a normal user:</p>
            <ul>
              <li>Per-core load from <code>host_processor_info(PROCESSOR_CPU_LOAD_INFO)</code>.</li>
              <li>Per-core DVFS residency and idle time from IOReport's "CPU Core Performance States", the counters <code>powermetrics</code> reads as root.</li>
              <li>Per-core interrupt and IPI counts from <code>PROCESSOR_CPU_STAT64</code>.</li>
              <li>Thread priority, state and CPU time from <code>proc_pidinfo</code>, for your own processes.</li>
            </ul>
            <p>
              What needs root: which thread ran on which core, threads of root processes such as <code>WindowServer</code> and <code>kernel_task</code>, and a thread's exact QoS, which needs its thread port. The QoS band shown here is inferred from the base priority the QoS class sets, so a thread that lowered its own priority inside a class can read as the class below.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Arm, WFI: Wait For Interrupt', url: 'https://developer.arm.com/documentation/ddi0602/latest/Base-Instructions/WFI--Wait-for-interrupt-', note: 'The instruction an idle core executes, and what wakes it.' },
          { title: 'Linux kernel documentation, CPU idle time management', url: 'https://docs.kernel.org/admin-guide/pm/cpuidle.html', note: 'Idle states trade power saved against exit latency and the minimum stay worth entering them for.' },
          { title: 'Wikipedia, Clock gating', url: 'https://en.wikipedia.org/wiki/Clock_gating', note: 'Stopping the clock to a block to save switching power.' },
          { title: 'Wikipedia, Power gating', url: 'https://en.wikipedia.org/wiki/Power_gating', note: 'Cutting power to save leakage, at the cost of slower entry and exit.' },
          { title: 'Apple XNU source, cpu_common.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/arm/cpu_common.c', note: 'The per-core IPI counter, and the SIGPast IPI that makes another core check for preemption.' },
          { title: 'Apple XNU source, Clutch and Edge scheduler design', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/doc/scheduler/sched_clutch_edge.md', note: 'Run queues, the performance controller, and how timeshare priority decays with CPU use.' },
          { title: 'Apple XNU source, sched_clutch.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/sched_clutch.c', note: 'The macOS time slices: 10 ms for interactive and default work, 4 ms utility, 2 ms background.' },
          { title: 'Apple XNU source, thread_policy.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/thread_policy.c', note: 'The base priority each QoS class sets: 46, 37, 31, 20 and 4.' },
          { title: 'Arpaci-Dusseau, OSTEP: Limited Direct Execution', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf', note: 'Timer interrupts, and what a context switch saves and restores.' },
          { title: 'Eclectic Light, Scheduling of threads on M1 series chips', url: 'https://eclecticlight.co/2022/01/25/scheduling-of-threads-on-m1-series-chips-second-draft/', note: 'Background threads stay on E cores; taskpolicy -b puts a process there.' },
          { title: 'macmon by vladkens', url: 'https://github.com/vladkens/macmon', note: 'An open-source reader of the same IOReport residency counters without sudo.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac, an M5: <code>sysctl hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu</code> prints 4 and 6, and <code>hw.perflevel0.name</code> calls the fast tier Super. IOReport lists one channel per core, ECPU0 to ECPU5 and PCPU0 to PCPU3, with 8 and 19 clock states. A scan of all 2,900 threads this user may inspect took about 2 ms; the reader only rescans processes that used CPU since the last scan, and stays under 2% CPU.
      </p>
    </div>
  )
}
