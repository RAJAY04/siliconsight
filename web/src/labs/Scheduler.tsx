import { useEffect, useMemo, useState } from 'react'
import { mhz, num } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, lerp, phase, useSteps, useTicker, type LabProps, type Step } from './kit.tsx'
import { QOS, QOS_ORDER, frameAt, simulate, type Qos, type SimConfig, type SimResult, type SimThread } from './sched.ts'
import './CoreXray.css'
import './Scheduler.css'

// The scheduler as one picture: the run queue on the left, this Mac's P and E cores on the right, each with a lane
// that records who ran there. Coordinates are in the SVG's 960 x 500 viewBox.

type Named = SimThread & { name: string }
const KERNEL = { x: 20, y: 452, w: 920, h: 36 }
const LANES = { x: 290, y: 64, label: 110, w: 650, h: 370 }

/** Core rows and a lane per core, filled up to sim time `now`. Used by the story and by the Try it card. */
function Lanes({ res, threads, cfg, now, x, y, w, h, simple }: { res: SimResult; threads: Named[]; cfg: SimConfig; now: number; x: number; y: number; w: number; h: number; simple: boolean }) {
  const n = cfg.p + cfg.e
  const gap = cfg.e && cfg.p ? 16 : 0
  const row = Math.min(40, (h - gap) / n)
  const rowY = (c: number) => y + c * row + (c >= cfg.p ? gap : 0)
  const laneX = x + LANES.label
  const laneW = w - LANES.label
  const span = Math.max(1, res.end)
  const sx = (ms: number) => laneX + (ms / span) * laneW
  const byId = new Map(threads.map((t) => [t.id, t]))
  const fr = frameAt(res, now)
  // Runs of the same thread on a core, cut at `now`.
  const bars: { c: number; id: number; from: number; to: number }[] = []
  for (let c = 0; c < n; c++) {
    let cur: (typeof bars)[number] | null = null
    for (let ms = 0; ms < Math.min(now, res.frames.length); ms++) {
      const id = res.frames[ms].cores[c]
      if (cur && cur.id === id) cur.to = ms + 1
      else {
        if (cur) bars.push(cur)
        cur = id == null ? null : { c, id, from: ms, to: ms + 1 }
      }
    }
    if (cur) bars.push(cur)
  }
  return (
    <g className="sc-lanes">
      {Array.from({ length: n }, (_, c) => {
        const p = c < cfg.p
        const id = fr && now > 0 && now < res.end ? fr.cores[c] : null
        const t = id == null ? null : byId.get(id)
        return (
          <g key={c} className={`sc-row ${p ? 'k-P' : 'k-E'}`}>
            <rect className="sc-lane" x={laneX} y={rowY(c) + 2} width={laneW} height={row - 4} rx={4} />
            <rect className={`sc-core ${t ? 'busy' : ''}`} x={x} y={rowY(c) + 2} width={LANES.label - 10} height={row - 4} rx={6} />
            <text className="sc-core-t" x={x + 8} y={rowY(c) + row / 2 + 4}>
              {p ? (simple ? 'Fast' : 'P') : simple ? 'Eco' : 'E'} {p ? c + 1 : c - cfg.p + 1}
            </text>
            {t && (
              <text className="sc-core-on" x={x + LANES.label - 16} y={rowY(c) + row / 2 + 4} textAnchor="end">
                {t.name.slice(0, 6)}
              </text>
            )}
          </g>
        )
      })}
      {bars.map((b, k) => {
        const t = byId.get(b.id)!
        const bw = sx(b.to) - sx(b.from)
        return (
          <g key={k} className={`sc-bar q-${t.qos}`}>
            <rect x={sx(b.from)} y={rowY(b.c) + 5} width={Math.max(1, bw - 0.5)} height={row - 10} rx={3} />
            {bw > t.name.length * 7 + 8 && row >= 22 && (
              <text x={sx(b.from) + 5} y={rowY(b.c) + row / 2 + 4}>
                {t.name}
              </text>
            )}
          </g>
        )
      })}
      {cfg.e > 0 && cfg.p > 0 && (
        <text className="sc-dim" x={laneX + laneW} y={rowY(cfg.p) - 4} textAnchor="end">
          {simple ? 'Eco Workers' : 'E cluster'} {fr && fr.cores.slice(cfg.p).some((x) => x != null) ? `${simple ? 'speed' : 'clock'} ${mhz(fr.eFast ? cfg.eMHz : cfg.eBgMHz)}` : ''}
        </text>
      )}
      <line className="sc-now" x1={sx(Math.min(now, res.end))} x2={sx(Math.min(now, res.end))} y1={y - 6} y2={rowY(n - 1) + row} />
      <text className="sc-dim" x={sx(Math.min(now, res.end))} y={y - 10} textAnchor={Math.min(now, res.end) > span * 0.9 ? 'end' : 'middle'}>
        {Math.round(Math.min(now, res.end))} ms
      </text>
    </g>
  )
}

function Queue({ ids, threads, x, y }: { ids: number[]; threads: Named[]; x: number; y: number }) {
  const byId = new Map(threads.map((t) => [t.id, t]))
  return (
    <g>
      {ids.slice(0, 8).map((id, n) => {
        const t = byId.get(id)!
        return (
          <g key={id} className={`sc-pill q-${t.qos}`}>
            <rect x={x} y={y + n * 40} width={230} height={32} rx={16} />
            <text x={x + 14} y={y + n * 40 + 21}>
              {t.name}
            </text>
            <text className="sc-pri" x={x + 216} y={y + n * 40 + 21} textAnchor="end">
              {QOS[t.qos].pri}
            </text>
          </g>
        )
      })}
      {ids.length > 8 && (
        <text className="sc-dim" x={x} y={y + 8 * 40 + 14}>
          +{ids.length - 8} more
        </text>
      )}
    </g>
  )
}

/** A step driven by the simulator: the story's seconds map onto the run so it ends just before the step does. */
function SimScene({ res, threads, cfg, t, dur, note, simple }: { res: SimResult; threads: Named[]; cfg: SimConfig; t: number; dur: number; note: string; simple: boolean }) {
  const now = (t / Math.max(0.1, dur - 0.5)) * res.end
  const fr = frameAt(res, now)
  const waiting = now >= res.end ? [] : (fr?.ready ?? [])
  return (
    <>
      <text className="sc-head" x={20} y={50}>
        {simple ? 'Waiting for a worker' : 'Run queue'}
      </text>
      {waiting.length ? <Queue ids={waiting} threads={threads} x={20} y={64} /> : <text className="sc-dim" x={20} y={84}>empty</text>}
      <text className="sc-head" x={LANES.x} y={50}>
        {simple ? 'Workers, and who worked when' : 'Cores, and who ran when'}
      </text>
      <Lanes res={res} threads={threads} cfg={cfg} now={now} x={LANES.x} y={LANES.y + 10} w={LANES.w} h={LANES.h - 20} simple={simple} />
      <Kernel text={note} simple={simple} />
    </>
  )
}

function Kernel({ text, simple }: { text: string; simple: boolean }) {
  return (
    <g className="sc-kernel">
      <rect x={KERNEL.x} y={KERNEL.y} width={KERNEL.w} height={KERNEL.h} rx={8} />
      <text x={KERNEL.x + 14} y={KERNEL.y + 23}>
        <tspan className="sc-kernel-k">{simple ? 'macOS' : 'Scheduler'}</tspan> {text}
      </text>
    </g>
  )
}

/** Step 1: one process, its shared memory, and three threads each with its own registers and stack. */
function ProcessScene({ t, simple, tasks, threadsN }: { t: number; simple: boolean; tasks: number | null; threadsN: number | null }) {
  const names = simple ? ['drawing the window', 'loading a page', 'saving a file'] : ['main: UI', 'network', 'disk I/O']
  return (
    <>
      <rect className="sc-proc" x={40} y={40} width={880} height={380} rx={18} />
      <text className="sc-head" x={64} y={72}>
        {simple ? 'One app: Safari' : 'One process: Safari'}
      </text>
      <text className="sc-dim" x={64} y={94}>
        {simple ? 'Everything inside the box is shared by its jobs' : 'Shared by every thread: one address space, open files, code and heap'}
      </text>
      {['code', 'heap', simple ? 'open files' : 'file descriptors'].map((m, n) => (
        <g key={m} className="sc-mem">
          <rect x={64 + n * 150} y={110} width={136} height={44} rx={8} />
          <text x={64 + n * 150 + 68} y={137} textAnchor="middle">
            {m}
          </text>
        </g>
      ))}
      {names.map((nm, k) => {
        const x = 64 + k * 285
        const on = phase(t, 0.3 + k * 0.4, 0.9 + k * 0.4)
        const pc = (t * 1.3 + k * 0.7) % 1
        return (
          <g key={nm} className={`sc-thread q-${(['ui', 'initiated', 'utility'] as Qos[])[k]}`} opacity={on}>
            <rect x={x} y={180} width={260} height={220} rx={12} />
            <text className="sc-head" x={x + 16} y={208}>
              {simple ? `Job ${k + 1}` : `Thread ${k + 1}`}
            </text>
            <text className="sc-dim" x={x + 16} y={228}>
              {nm}
            </text>
            <rect className="sc-own" x={x + 16} y={244} width={108} height={140} rx={8} />
            <text className="sc-dim" x={x + 70} y={264} textAnchor="middle">
              {simple ? 'its notes' : 'registers'}
            </text>
            <text className="sc-mono" x={x + 70} y={290} textAnchor="middle">
              pc {(0x1a40 + Math.round(pc * 64) * 4).toString(16)}
            </text>
            <text className="sc-mono" x={x + 70} y={312} textAnchor="middle">
              sp {(0x6f70 - k * 0x800).toString(16)}
            </text>
            <rect className="sc-own" x={x + 136} y={244} width={108} height={140} rx={8} />
            <text className="sc-dim" x={x + 190} y={264} textAnchor="middle">
              {simple ? 'its scratch pad' : 'own stack'}
            </text>
            {[0, 1, 2].map((f) => (
              <rect key={f} className="sc-frame" x={x + 148} y={364 - f * 24} width={84} height={18} rx={3} opacity={f < 1 + ((t * 2 + k) % 3) ? 1 : 0.15} />
            ))}
          </g>
        )
      })}
      <Kernel simple={simple} text={tasks == null ? (simple ? 'Each job runs on its own, but they share the app\'s memory.' : 'The scheduler runs threads, not processes.') : simple ? `This Mac has ${num(tasks)} apps and helpers running ${num(threadsN)} jobs right now.` : `This Mac: ${num(tasks)} processes holding ${num(threadsN)} threads right now.`} />
    </>
  )
}

/** Step 2: thousands of threads, nearly all asleep. Each dot stands for a group of real threads. */
function SleepScene({ t, simple, total, runnable }: { t: number; simple: boolean; total: number; runnable: number }) {
  const dots = 160
  const per = Math.max(1, Math.round(total / dots))
  const lit = Math.min(12, Math.max(1, Math.round(runnable)))
  const k = phase(t, 0.6, 2.2)
  return (
    <>
      <text className="sc-head" x={40} y={50}>
        {simple ? `Every job on this Mac, about ${num(per)} per dot` : `Every thread on this Mac, about ${num(per)} per dot`}
      </text>
      <rect className="sc-rq" x={690} y={70} width={250} height={370} rx={14} />
      {Array.from({ length: dots }, (_, n) => {
        const x = 50 + (n % 20) * 30
        const y = 80 + Math.floor(n / 20) * 40
        const awake = n % 13 === 5 && Math.floor(n / 13) < lit
        const j = Math.floor(n / 13)
        const tx = lerp(x, 720, k)
        const ty = lerp(y, 100 + j * 30, k)
        return <circle key={n} className={`sc-dot ${awake ? 'on' : ''}`} cx={awake ? tx : x} cy={awake ? ty : y} r={awake ? 8 : 6} />
      })}
      <text className="sc-head" x={706} y={60}>
        {simple ? 'Want a worker now' : 'Runnable'}
      </text>
      <Kernel simple={simple} text={simple ? `Asleep: waiting for a click, a timer, the network. Awake: about ${num(runnable, 1)} on average.` : `Blocked threads sit on wait queues, off the run queue. Load average: ${num(runnable, 2)} runnable.`} />
    </>
  )
}

/** Step 5: the QoS classes, highest first, with base priority, time slice and where they may run. */
function QosScene({ t, simple }: { t: number; simple: boolean }) {
  return (
    <>
      <text className="sc-head" x={40} y={50}>
        {simple ? 'Every job carries a label saying how urgent it is' : 'Quality of service classes'}
      </text>
      {['', simple ? 'rank' : 'base priority', simple ? 'turn length' : 'time slice', simple ? 'which workers' : 'cores'].map((h, n) => (
        <text key={n} className="sc-dim" x={[40, 420, 560, 700][n]} y={84}>
          {h}
        </text>
      ))}
      {QOS_ORDER.map((q, n) => {
        const on = phase(t, 0.2 + n * 0.45, 0.7 + n * 0.45)
        const y = 100 + n * 66
        return (
          <g key={q} className={`sc-qrow q-${q}`} opacity={0.15 + 0.85 * on}>
            <rect x={40} y={y} width={360} height={52} rx={12} />
            <text className="sc-head" x={58} y={y + 23}>
              {simple ? QOS[q].plain : QOS[q].tech}
            </text>
            <text className="sc-dim" x={58} y={y + 42}>
              {
                {
                  ui: simple ? 'the button you just pressed' : 'main thread, animation, input',
                  initiated: simple ? 'something you asked for and wait on' : 'opening a document you clicked',
                  default: simple ? 'no label given' : 'when nothing is specified',
                  utility: simple ? 'a download with a progress bar' : 'downloads, imports, long tasks',
                  background: simple ? 'tidying up you never see' : 'indexing, backup, sync',
                }[q]
              }
            </text>
            <text className="sc-big" x={420} y={y + 33}>
              {QOS[q].pri}
            </text>
            <text className="sc-big" x={560} y={y + 33}>
              {QOS[q].quantum} ms
            </text>
            <text x={700} y={y + 32}>
              {q === 'background' ? (simple ? 'Eco only' : 'E cores only') : simple ? 'Fast first, then Eco' : 'P first, then E'}
            </text>
          </g>
        )
      })}
      <Kernel simple={simple} text={simple ? 'Urgent jobs go first and get the Fast Workers. Background jobs only ever get Eco Workers.' : 'Higher QoS wins the run queue, gets longer slices and may use P cores. Background is confined to E cores.'} />
    </>
  )
}

/** Step 8: priority inversion and the boost that resolves it, as a timeline in seconds of the step. */
function InversionScene({ t, simple }: { t: number; simple: boolean }) {
  const blocked = t > 1.2 && t < 4.4
  const boosted = t > 2.6 && t < 4.4
  const lockAt = t < 4.4 ? 'bg' : 'ui'
  return (
    <>
      <text className="sc-head" x={420} y={50}>
        {simple ? 'Fast Worker' : 'P core'}
      </text>
      <rect className={`sc-core big ${!blocked ? 'busy' : ''}`} x={420} y={70} width={480} height={120} rx={14} />
      <text className="sc-head" x={420} y={250}>
        {simple ? 'Eco Worker' : 'E core'}
      </text>
      <rect className="sc-core big busy" x={420} y={270} width={480} height={120} rx={14} />
      <g className="sc-pill q-ui" transform={`translate(${blocked ? 40 : 460} ${blocked ? 100 : 110})`}>
        <rect width={230} height={36} rx={18} />
        <text x={14} y={23}>
          {simple ? 'Typing in Notes' : 'Notes main, 46'}
        </text>
      </g>
      {blocked && (
        <text className="sc-warn" x={40} y={160}>
          {simple ? 'stuck: needs the key' : 'blocked on the lock'}
        </text>
      )}
      <g className={`sc-pill ${boosted ? 'q-ui' : 'q-background'}`} transform={`translate(${t < 4.4 ? (boosted ? 630 : 450) : 40} ${t < 4.4 ? (boosted ? 110 : 290) : 290})`}>
        <rect width={230} height={36} rx={18} />
        <text x={14} y={23}>
          {simple ? 'Saving in the background' : boosted ? 'Notes sync, boosted to 46' : 'Notes sync, 4'}
        </text>
      </g>
      {!boosted && t < 4.4 && (
        <g className="sc-pill q-utility" transform="translate(660 340)">
          <rect width={220} height={36} rx={18} />
          <text x={14} y={23}>
            {simple ? 'A long download' : 'Utility work, 20'}
          </text>
        </g>
      )}
      <g className="sc-lock" transform={`translate(${lockAt === 'bg' ? (boosted ? 880 : 695) : 705} ${lockAt === 'bg' ? (boosted ? 116 : 296) : 116})`} opacity={t >= 4.4 && t < 4.6 ? 0 : 1}>
        <rect x={-10} y={-4} width={30} height={26} rx={5} />
        <path d="M -3 -4 V -12 A 8 8 0 0 1 13 -12 V -4" />
      </g>
      <Kernel
        simple={simple}
        text={
          t < 1.2
            ? simple
              ? 'A background job holds the key to a shared notebook.'
              : 'A background thread takes a lock on shared data.'
            : t < 2.6
              ? simple
                ? 'The urgent job needs the key and has to wait, while busier jobs crowd out the slow one holding it.'
                : 'The UI thread blocks on that lock. Utility work outranks the holder, so the holder barely runs: inversion.'
              : t < 4.4
                ? simple
                  ? 'macOS notices and lends the slow job the urgent label until it hands back the key.'
                  : 'The kernel promotes the holder to the waiter\'s priority, so it finishes its critical section fast.'
                : simple
                  ? 'Key handed back. The urgent job carries on; the helper goes back to normal.'
                  : 'Lock released, promotion dropped. The UI thread runs again.'
        }
      />
    </>
  )
}

const WORK = { short: 20, medium: 60, long: 150 }
type Work = keyof typeof WORK
const ARRIVE = [0, 20, 50]

/** Pick threads, then watch the model place them on this Mac's cores. */
function Simulator({ cfg, simple }: { cfg: SimConfig; simple: boolean }) {
  const [qos, setQos] = useState<Qos>('ui')
  const [work, setWork] = useState<Work>('medium')
  const [arrive, setArrive] = useState(0)
  const [list, setList] = useState<Named[]>(() => preset('mix', cfg))
  const [run, setRun] = useState(0)
  const res = useMemo(() => simulate(list, cfg), [list, cfg])
  const add = () => {
    if (list.length >= 12) return
    const id = Math.max(0, ...list.map((x) => x.id)) + 1
    setList([...list, { id, qos, work: WORK[work], arrive, name: `T${id}` }])
    setRun((r) => r + 1)
  }
  const h = Math.max(160, (cfg.p + cfg.e) * 30 + 30)
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: be the boss' : 'Try it: a scheduler simulator'}</h3>
      <p className="fine">
        {simple
          ? `Add jobs with a label and a size, and watch where macOS's rules would put them on this Mac's ${cfg.p} Fast and ${cfg.e} Eco Workers.`
          : `Add threads with a QoS class and an amount of work, and watch the model place them on ${cfg.p} P and ${cfg.e} E cores, this Mac's counts. Work is in milliseconds of a P core at its top clock.`}
      </p>
      <div className="lab-try-row">
        <div className="lab-seg sc-seg" role="group" aria-label={simple ? 'Urgency' : 'QoS class'}>
          {QOS_ORDER.map((q) => (
            <button key={q} type="button" aria-pressed={qos === q} onClick={() => setQos(q)}>
              {simple ? QOS[q].plain : QOS[q].tech}
            </button>
          ))}
        </div>
        <div className="lab-seg" role="group" aria-label={simple ? 'Size' : 'Work'}>
          {(Object.keys(WORK) as Work[]).map((w) => (
            <button key={w} type="button" aria-pressed={work === w} onClick={() => setWork(w)}>
              {w} {WORK[w]} ms
            </button>
          ))}
        </div>
        <div className="lab-seg" role="group" aria-label={simple ? 'Starts' : 'Arrives at'}>
          {ARRIVE.map((a) => (
            <button key={a} type="button" aria-pressed={arrive === a} onClick={() => setArrive(a)}>
              {a ? `at ${a} ms` : simple ? 'now' : 'at 0 ms'}
            </button>
          ))}
        </div>
        <button type="button" className="lab-btn lab-play" onClick={add} disabled={list.length >= 12}>
          {simple ? 'Add job' : 'Add thread'}
        </button>
      </div>
      <div className="lab-try-row">
        <button type="button" className="lab-btn" onClick={() => (setList(preset('mix', cfg)), setRun((r) => r + 1))}>
          {simple ? 'Example: a normal moment' : 'Preset: a mix'}
        </button>
        <button type="button" className="lab-btn" onClick={() => (setList(preset('spill', cfg)), setRun((r) => r + 1))}>
          {simple ? 'Example: too many urgent jobs' : 'Preset: spill-over'}
        </button>
        <button type="button" className="lab-btn" onClick={() => (setList(preset('chores', cfg)), setRun((r) => r + 1))}>
          {simple ? 'Example: only chores' : 'Preset: background only'}
        </button>
        <button type="button" className="lab-btn" onClick={() => setRun((r) => r + 1)}>
          {simple ? 'Play again' : 'Replay'}
        </button>
        <button type="button" className="lab-btn" onClick={() => setList([])} disabled={!list.length}>
          {simple ? 'Clear' : 'Clear all'}
        </button>
      </div>
      <Playback key={run} res={res} list={list} cfg={cfg} simple={simple} h={h} setList={setList} />
      <ModelNote cfg={cfg} simple={simple} />
    </section>
  )
}

/** Plays a run over about four seconds, then stops ticking. Under reduced motion it shows the end at once. */
function Playback({ res, list, cfg, simple, h, setList }: { res: SimResult; list: Named[]; cfg: SimConfig; simple: boolean; h: number; setList: (l: Named[]) => void }) {
  const [done, setDone] = useState(false)
  const t = useTicker(!done, 99)
  const now = Math.min(res.end, (t / 4) * res.end)
  useEffect(() => {
    if (!done && now >= res.end) setDone(true)
  }, [done, now, res.end])
  return (
    <>
      <div className="lab-stage sc-sim">
        <svg className="sc-scene" viewBox={`0 0 960 ${h}`} role="img" aria-label="Which thread ran on which core over time in the simulator">
          {list.length ? (
            <Lanes res={res} threads={list} cfg={cfg} now={now} x={10} y={24} w={940} h={h - 34} simple={simple} />
          ) : (
            <text className="sc-dim" x={20} y={40}>
              {simple ? 'Add a job to start.' : 'Add a thread to start.'}
            </text>
          )}
        </svg>
      </div>
      {list.length > 0 && (
        <div className="cx-table-wrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th>{simple ? 'Job' : 'Thread'}</th>
                <th>{simple ? 'Urgency' : 'QoS'}</th>
                <th className="r">{simple ? 'Size' : 'Work'}</th>
                <th className="r">Waited</th>
                <th className="r">{simple ? 'Done at' : 'Finished'}</th>
                <th className="r">{simple ? 'On Fast' : 'On P'}</th>
                <th className="r">{simple ? 'On Eco' : 'On E'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {res.threads.map((o, n) => {
                const th = list[n]
                const shown = now >= res.end
                return (
                  <tr key={th.id}>
                    <td className="num">{th.name}</td>
                    <td>
                      <span className={`cx-qos q-${th.qos}`}>{simple ? QOS[th.qos].plain : QOS[th.qos].tech}</span>
                    </td>
                    <td className="r num">{th.work} ms{th.arrive ? `, at ${th.arrive}` : ''}</td>
                    <td className="r num">{shown ? `${o.waited} ms` : '…'}</td>
                    <td className="r num">{shown ? (o.finish == null ? 'never' : `${o.finish} ms`) : '…'}</td>
                    <td className="r num">{shown ? `${o.onP} ms` : '…'}</td>
                    <td className="r num">{shown ? `${o.onE} ms` : '…'}</td>
                    <td>
                      <button type="button" className="lab-btn sc-x" aria-label={`Remove ${th.name}`} onClick={() => setList(list.filter((x) => x.id !== th.id))}>
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={`lab-verdict ${list.length ? 'ok' : ''}`} aria-live="polite">
        {!list.length
          ? simple
            ? 'No jobs yet.'
            : 'No threads yet.'
          : `${simple ? 'All done after' : 'Finished at'} ${res.end} ms, with ${res.switches} ${simple ? 'job swaps' : 'context switches'}.${res.threads.some((o) => o.finish == null) ? (simple ? ' Some jobs never got a worker.' : ' Some threads never finished within the limit.') : ''}`}
      </p>
    </>
  )
}

function ModelNote({ cfg, simple }: { cfg: SimConfig; simple: boolean }) {
  return (
      <p className="fine">
        {simple
          ? 'A simple model. It follows macOS\'s main rules: urgent first, turns of a few thousandths of a second, background jobs only on Eco Workers, which run at half speed when only background jobs are on them. It treats an Eco Worker as slower only by its clock, so real Eco Workers are slower still.'
          : `A model, not XNU. It keeps the rules sourced below: strict priority, macOS time slices per class, background on E only, spill onto E when P is full, and an E clock of ${mhz(cfg.eBgMHz)} for background-only work, half the top clock, as measured on this M5 with taskpolicy -b. It scales speed by clock alone; real E cores also do less per clock. It leaves out thread groups, the performance controller's recommendations and migration costs.`}
      </p>
  )
}

function preset(kind: 'mix' | 'spill' | 'chores', cfg: SimConfig): Named[] {
  const mk = (qos: Qos, work: number, arrive = 0) => ({ qos, work, arrive })
  const list =
    kind === 'mix'
      ? [mk('ui', 20), mk('initiated', 60), mk('utility', 60, 20), mk('background', 60), mk('background', 60), mk('ui', 20, 50)]
      : kind === 'spill'
        ? [...Array.from({ length: cfg.p + 2 }, () => mk('initiated', 60)), mk('background', 60)]
        : Array.from({ length: Math.max(1, cfg.e + 2) }, () => mk('background', 40))
  return list.map((x, n) => ({ ...x, id: n + 1, name: `T${n + 1}` }))
}

export default function Scheduler({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const sc = s.sched
  const pCount = s.cpu.cores.filter((c) => c.kind === 'P').length || hw.pCores
  const eCount = s.cpu.cores.length - pCount
  const pTop = sc?.pStatesMHz.length ? Math.max(...sc.pStatesMHz) : null
  const eTop = sc?.eStatesMHz.length ? Math.max(...sc.eStatesMHz) : null
  const cfg: SimConfig = useMemo(() => {
    const pMHz = pTop ?? 4000
    const eMHz = eTop ?? 3000
    return { p: pCount, e: eCount, pMHz, eMHz, eBgMHz: Math.round(eMHz / 2) }
  }, [pCount, eCount, pTop, eTop])

  // The story's simulated runs, on a single core for the basics and on this Mac's cores for placement.
  const one: SimConfig = useMemo(() => ({ ...cfg, p: 1, e: 0 }), [cfg])
  const runs = useMemo(() => {
    const n = (name: string, qos: Qos, work: number, arrive = 0, id = 0): Named => ({ id, qos, work, arrive, name })
    const slices = [n('Mail', 'default', 26, 0, 1), n('Music', 'default', 26, 0, 2), n('Xcode', 'default', 26, 0, 3)]
    const preempt = [n('Export', 'utility', 30, 0, 1), n('Typing', 'ui', 12, 9, 2)]
    const placing = [n('Safari UI', 'ui', 40, 0, 1), n('Open file', 'initiated', 60, 0, 2), ...[3, 4, 5].map((i) => n(`Spotlight${i - 2}`, 'background', 70, 0, i))]
    const spill = [...Array.from({ length: cfg.p + 2 }, (_, i) => n(`Build ${i + 1}`, 'initiated', 60, 0, i + 1)), n('Backup', 'background', 50, 0, cfg.p + 3)]
    return {
      slices: { threads: slices, res: simulate(slices, one) },
      preempt: { threads: preempt, res: simulate(preempt, one) },
      placing: { threads: placing, res: simulate(placing, cfg) },
      spill: { threads: spill, res: simulate(spill, cfg) },
    }
  }, [cfg, one])

  const Fast = simple ? 'Fast Workers' : 'P cores'
  const Eco = simple ? 'Eco Workers' : 'E cores'
  const bgP = runs.placing.res.threads.slice(2).reduce((a, o) => a + o.onP, 0)
  const steps: Step[] = [
    {
      title: simple ? 'Apps and their jobs' : 'Process and thread',
      dur: 2.6,
      tech: (
        <p>
          A process is a running program: one private address space, its open files, its code and heap. A thread is one path of execution inside it, with its own registers, program counter and stack. Every thread of a process sees the same memory, which is why threads can share work cheaply and also why they need locks. The scheduler hands out cores to threads, never to whole processes.
          {sc?.systemThreads == null ? '' : ` This Mac has ${num(sc.systemTasks)} processes and ${num(sc.systemThreads)} threads right now.`}
        </p>
      ),
      plain: (
        <p>
          An app is a box holding its memory, its files and its instructions. Inside it, several jobs run at once: one draws the window, one loads the web page, one saves your file. Each job keeps its own notes on where it's up to, but they all share the app's memory. macOS gives workers to jobs, not to whole apps.
          {sc?.systemThreads == null ? '' : ` Right now this Mac has ${num(sc.systemTasks)} apps and helpers running ${num(sc.systemThreads)} jobs.`}
        </p>
      ),
    },
    {
      title: simple ? 'Most jobs are waiting' : 'Asleep or runnable',
      dur: 3,
      tech: (
        <p>
          Almost every thread is blocked at any moment: waiting for a key press, a timer, a packet or a disk read. Blocked threads sit on wait queues and cost no CPU. Only runnable threads join a run queue, and on Apple Silicon each cluster has its own. The load average counts runnable threads, smoothed over a minute.
          {sc?.loadAvg == null ? '' : ` Here it is ${num(sc.loadAvg, 2)}, against ${num(sc.systemThreads)} threads.`}
        </p>
      ),
      plain: (
        <p>
          Nearly every job is asleep, waiting for something: a click, a timer, a message from the internet. Sleeping jobs cost nothing. Only the few that are ready to work line up for a worker.
          {sc?.loadAvg == null ? '' : ` On this Mac, about ${num(sc.loadAvg, 1)} jobs wanted a worker at a time over the last minute, out of ${num(sc.systemThreads)}.`}
        </p>
      ),
    },
    {
      title: simple ? 'Taking turns' : 'Time slices',
      dur: 5,
      tech: (
        <p>
          Three default-QoS threads, one core. Each runs for its quantum, 10 ms on macOS for default work, then goes to the back of the run queue and the next one runs. Each change of thread is a context switch: save one thread's registers, load the next. Interleaving this fast makes three jobs look simultaneous on one core.
          {sc?.contextSwitches == null ? '' : ` Your apps alone make about ${num(sc.contextSwitches)} context switches a second.`}
        </p>
      ),
      plain: (
        <p>
          Three jobs of the same importance, one worker. Each gets a turn of a hundredth of a second, then goes to the back of the line. Swapping happens so fast that all three seem to run at once.
          {sc?.contextSwitches == null ? '' : ` Your apps swap jobs about ${num(sc.contextSwitches)} times a second.`}
        </p>
      ),
    },
    {
      title: simple ? 'Cutting in line' : 'Preemption',
      dur: 4.4,
      tech: (
        <p>
          A utility export is running when a keystroke wakes a user-interactive thread. Its base priority, 46, beats the export's 20, so the scheduler preempts the export at once instead of waiting for its slice to end. The keystroke is handled within the same millisecond, and the export picks up afterwards. Strict priority is what keeps typing smooth during heavy background work.
        </p>
      ),
      plain: (
        <p>
          A long export is working when you press a key. The key press is far more urgent, so macOS stops the export right away, deals with your key, and then lets the export carry on. That's why typing stays smooth even while the Mac is busy.
        </p>
      ),
    },
    {
      title: simple ? 'Urgency labels' : 'QoS classes',
      dur: 3,
      tech: (
        <p>
          Apps label each thread or dispatch queue with a quality of service class. The class sets the base priority, the time slice, I/O priority and timer coalescing, and on Apple Silicon which cores the thread may use. Background threads also get their I/O throttled. The numbers are XNU's: 46, 37, 31, 20 and 4.
        </p>
      ),
      plain: (
        <p>
          Apps put an urgency label on every job: right now, you're waiting on it, normal, long job, or whenever. The label decides who goes first, how long each turn is, and which workers the job may use.
        </p>
      ),
    },
    {
      title: simple ? 'Chores go to the Eco Workers' : 'Placement on this Mac',
      dur: 5,
      tech: (
        <p>
          This Mac's real {cfg.p} P and {cfg.e} E cores. The interactive and user-initiated threads take P cores. The three background Spotlight threads go to E cores even though P cores sit idle, because macOS never runs QoS 9 work on P cores on these chips, and it holds the E cluster at a low clock while only background work runs there. In this model the background threads spent {bgP} ms on P.
        </p>
      ),
      plain: (
        <p>
          This Mac's real {cfg.p} Fast and {cfg.e} Eco Workers. The urgent jobs get Fast Workers. The three Spotlight chores go to Eco Workers even with Fast Workers free, and the Eco Workers run slowly to save energy, because nobody is waiting on chores.
        </p>
      ),
    },
    {
      title: simple ? 'Too many urgent jobs' : 'Spill-over',
      dur: 5,
      tech: (
        <p>
          {cfg.p + 2} user-initiated threads, more than the {cfg.p} P cores. The extra ones spill onto E cores rather than wait, and because high-QoS work now runs there, the E cluster goes to its top clock{eTop ? `, ${mhz(eTop)} here` : ''}. The background backup gets an E core too, but only one that is left over. When P cores free up, waiting high-QoS work goes back to them.
        </p>
      ),
      plain: (
        <p>
          {cfg.p + 2} urgent jobs and only {cfg.p} Fast Workers. Rather than make them wait, macOS lends them Eco Workers too, and lets the Eco Workers run at full speed. The backup chore only gets whatever worker is left over.
        </p>
      ),
    },
    {
      title: simple ? 'Stuck behind a slow job' : 'Priority inversion',
      dur: 6,
      tech: (
        <p>
          A background thread holds a lock that the UI thread needs. The UI thread blocks, and medium-priority work keeps the lock holder off the cores, so the most important thread waits on the least important one. For synchronous work macOS resolves this by raising the lower-priority work to the waiter's QoS for as long as the inversion lasts, for example when a thread calls dispatch_sync on a serial queue. Apple still asks developers to avoid inversions in the first place.
        </p>
      ),
      plain: (
        <p>
          A background job holds the key to something the urgent job needs. The urgent job has to wait, and other jobs keep the slow one from finishing. macOS spots this and lends the slow job the urgent label until it hands the key back. Then everything returns to normal.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const { i, t } = story
  const dur = steps[i].dur
  const note = (tech: string, plain: string) => (simple ? plain : tech)
  let scene
  if (i === 0) scene = <ProcessScene t={t} simple={simple} tasks={sc?.systemTasks ?? null} threadsN={sc?.systemThreads ?? null} />
  else if (i === 1) scene = <SleepScene t={t} simple={simple} total={sc?.systemThreads ?? 4000} runnable={sc?.loadAvg ?? 3} />
  else if (i === 2) scene = <SimScene {...runs.slices} cfg={one} t={t} dur={dur} simple={simple} note={note('Equal priority: each runs 10 ms, then goes to the back of the queue.', 'Same importance, so they take turns.')} />
  else if (i === 3) scene = <SimScene {...runs.preempt} cfg={one} t={t} dur={dur} simple={simple} note={note('At 9 ms the user-interactive thread arrives and preempts the utility thread.', 'The key press arrives and goes straight in.')} />
  else if (i === 4) scene = <QosScene t={t} simple={simple} />
  else if (i === 5) scene = <SimScene {...runs.placing} cfg={cfg} t={t} dur={dur} simple={simple} note={note(`Background stays on the ${Eco} at ${mhz(cfg.eBgMHz)}, with ${Fast} idle.`, `Chores stay on the ${Eco}, slowly, while ${Fast} rest.`)} />
  else if (i === 6) scene = <SimScene {...runs.spill} cfg={cfg} t={t} dur={dur} simple={simple} note={note(`More user-initiated threads than ${Fast}: they spill onto the ${Eco}, which clock up to ${mhz(cfg.eMHz)}.`, `Too many urgent jobs: they borrow ${Eco}, which speed up.`)} />
  else scene = <InversionScene t={t} simple={simple} />

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          sc == null
            ? 'This reader is older than the cores and threads update, so only per-core load is live. Pull the repo and run ./run.sh again.'
            : simple
              ? 'Real numbers from this Mac. Core X-ray, the next lab, shows every worker in detail.'
              : 'Threads from processor_set_statistics, load average from getloadavg, context switches summed over the processes this user may inspect. Core X-ray shows each core.'
        }
      >
        <LiveStat label={simple ? 'Workers' : 'Cores'} value={`${pCount} + ${eCount}`} sub={simple ? 'Fast + Eco' : 'P + E'} />
        <LiveStat label={simple ? 'Jobs' : 'Threads'} value={num(sc?.systemThreads)} sub={sc?.systemTasks == null ? undefined : `in ${num(sc.systemTasks)} ${simple ? 'apps' : 'processes'}`} />
        <LiveStat label={simple ? 'Wanting a worker' : 'Load average'} value={num(sc?.loadAvg, 2)} sub={simple ? 'last minute' : '1 min'} />
        <LiveStat
          label={simple ? 'Job swaps' : 'Context switches'}
          value={sc?.contextSwitches == null ? 'n/a' : `${num(sc.contextSwitches)}/s`}
          sub={<Sparkline values={history.map((x) => x.sched?.contextSwitches ?? null)} w={90} h={18} label="Context switches over the last minutes" />}
        />
        <LiveStat label={simple ? 'Fast Workers busy' : 'P load'} value={`${Math.round((s.cpu.cores.filter((c) => c.kind === 'P').reduce((a, c) => a + c.usage, 0) / Math.max(1, pCount)) * 100)}%`} sub={<Sparkline values={history.map((x) => x.cpu.cores.filter((c) => c.kind === 'P').reduce((a, c) => a + c.usage, 0) / Math.max(1, pCount))} max={1} w={90} h={18} label="P core load" />} />
        <LiveStat label={simple ? 'Eco Workers busy' : 'E load'} value={eCount ? `${Math.round((s.cpu.cores.filter((c) => c.kind === 'E').reduce((a, c) => a + c.usage, 0) / eCount) * 100)}%` : 'n/a'} sub={<Sparkline values={history.map((x) => (eCount ? x.cpu.cores.filter((c) => c.kind === 'E').reduce((a, c) => a + c.usage, 0) / eCount : null))} max={1} w={90} h={18} color="var(--ok)" label="E core load" />} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <svg className="sc-scene" viewBox="0 0 960 500" role="img" aria-label={`The scheduler: ${steps[i].title}`}>
            {scene}
          </svg>
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <Simulator cfg={cfg} simple={simple} />

      <Deeper title={simple ? 'Seeing it on your own Mac' : 'Watching the real scheduler'}>
        {simple ? (
          <>
            <p>Open Core X-ray and run this in Terminal. Four jobs at normal urgency fill the Fast Workers:</p>
            <pre className="cx-cmd">
              <code>for i in 1 2 3 4; do yes {'>'} /dev/null & done</code>
            </pre>
            <p>Stop them with <code>killall yes</code>. Then label the same four as chores. They move to the Eco Workers, which run slowly:</p>
            <pre className="cx-cmd">
              <code>for i in 1 2 3 4; do taskpolicy -b yes {'>'} /dev/null & done</code>
            </pre>
            <p>On this M5 the first used about 18 W and the second about 1.6 W, for the same work. Stop them with <code>killall yes</code>.</p>
          </>
        ) : (
          <>
            <p>
              Real placement is richer than the model. XNU's Edge scheduler keeps a run queue per cluster, groups threads into thread groups, and takes a preferred cluster per QoS from Apple's performance controller. It tries to keep small workloads compact on one cluster, opens more clusters when work gets wide, and moves threads between cores often, which spreads heat.
            </p>
            <p>Watch it with Core X-ray open. Four default loops fill the P cores; four in the background state go to the E cores at a low clock:</p>
            <pre className="cx-cmd">
              <code>for i in 1 2 3 4; do yes {'>'} /dev/null & done; sleep 15; killall yes</code>
            </pre>
            <pre className="cx-cmd">
              <code>for i in 1 2 3 4; do taskpolicy -b yes {'>'} /dev/null & done; sleep 15; killall yes</code>
            </pre>
            <p>
              Measured on this M5 Air for lesson 3: the first ran the P cluster near 4060 MHz at about 18 W of CPU power; the second ran the six E cores near 85% at about 1530 MHz and 1.6 W. <code>ps -axo pid,pri,comm</code> shows the two at priority 31 and 4.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Arpaci-Dusseau, OSTEP: Concurrency and Threads', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf', note: 'What a thread is, and what it shares with the other threads of its process.' },
          { title: 'Arpaci-Dusseau, OSTEP: Scheduling: The Multi-Level Feedback Queue', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-mlfq.pdf', note: 'Priorities, time slices and run queues; Mach timesharing is a relative.' },
          { title: 'Apple XNU source, Clutch and Edge scheduler design', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/doc/scheduler/sched_clutch_edge.md', note: 'Per-cluster run queues, thread groups, the performance controller and spill onto other clusters.' },
          { title: 'Apple XNU source, sched_clutch.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/sched_clutch.c', note: 'macOS time slices: 10 ms for interactive, initiated and default, 4 ms utility, 2 ms background.' },
          { title: 'Apple XNU source, thread_policy.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/thread_policy.c', note: 'The base priority of each QoS class.' },
          { title: 'Apple, Energy Efficiency Guide for Mac Apps: prioritize work at the task level', url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheTaskLevel.html', note: 'The QoS classes, and everything they change besides CPU priority.' },
          { title: 'Apple, Energy Efficiency Guide for iOS Apps: prioritize work with QoS', url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/PrioritizeWorkWithQoS.html', note: 'Priority inversions, and how the system raises the lower-priority work to resolve them.' },
          { title: 'Eclectic Light, Scheduling of threads on M1 series chips', url: 'https://eclecticlight.co/2022/01/25/scheduling-of-threads-on-m1-series-chips-second-draft/', note: 'Measurements showing QoS 9 threads stay on E cores and higher QoS fills P cores first.' },
          { title: 'Eclectic Light, Inside M4 chips: CPU core management', url: 'https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/', note: 'E clock low for background work, high when high-QoS work spills over.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>sysctl hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu</code> prints 4 and 6 on this M5, and the power and clock figures above are from lesson 3, measured here with the commands shown. The simulator is a model; its rules are sourced, its speeds are not measurements.
      </p>
    </div>
  )
}
