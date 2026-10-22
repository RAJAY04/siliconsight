import type { Sample } from '../types.ts'

// Pure parts of Guess the Watts: the tasks, which power reading to judge by, how a window of samples becomes one
// number, and how close a guess has to be.

export type TaskId = 'idle' | 'bright' | 'video' | 'app' | 'cpu'
export type Task = {
  id: TaskId
  name: string
  plain: string
  /** What to do, in technical and in everyday words. */
  how: string
  howPlain: string
  /** A Terminal command to start it, and the one that stops it. */
  cmd?: string
  stop?: string
  /** Judge by the window's average, or its peak for something that spikes and settles. */
  use: 'avg' | 'peak'
}

export const TASKS: Task[] = [
  {
    id: 'idle',
    name: 'Leave it idle',
    plain: 'Hands off',
    how: 'Take your hands off for the whole 10 s. Leave the screen as it is, and let nothing play.',
    howPlain: 'Let go of the Mac for 10 seconds. Nothing playing, nothing moving.',
    use: 'avg',
  },
  {
    id: 'bright',
    name: 'Full brightness',
    plain: 'Brightest screen',
    how: 'Turn the display to full brightness with the brightness key or Control Center, and keep it there for the 10 s.',
    howPlain: 'Turn the screen all the way up, as bright as it goes.',
    use: 'avg',
  },
  {
    id: 'video',
    name: 'Play a video',
    plain: 'Watch a video',
    how: 'Play a video in another window, ideally a high resolution one, and keep it playing for the 10 s.',
    howPlain: 'Start a video in another window and let it play.',
    use: 'avg',
  },
  {
    id: 'app',
    name: 'Open a big app',
    plain: 'Open a big app',
    how: 'Quit and reopen a large app you have, such as Xcode, Photos, Keynote or a big game. Judged by the peak.',
    howPlain: 'Open a big app, like Photos or Keynote. The highest moment counts.',
    use: 'peak',
  },
  {
    id: 'cpu',
    name: 'Load every core',
    plain: 'All workers busy',
    how: 'Start one busy loop per core in Terminal. Stop it right after the reveal.',
    howPlain: 'Paste this into Terminal to keep every worker busy. Stop it after the reveal.',
    cmd: 'for i in $(seq $(sysctl -n hw.ncpu)); do yes > /dev/null & done',
    stop: 'killall yes',
    use: 'avg',
  },
]

/** Seconds the reader watches for each task. */
export const WINDOW_S = 10
/** Slider range in watts. */
export const GUESS_MAX = 40

export type Source = 'system' | 'battery' | 'chip'
/**
 * The best whole-machine power this sample has: the SMC's system total, else the battery's outflow when running
 * on battery, else the chip's own parts added up (which leaves out the display and everything off the chip).
 */
export function machineWatts(s: Sample): { w: number; from: Source } | null {
  if (s.power.systemW != null) return { w: s.power.systemW, from: 'system' }
  const b = s.battery
  if (b && !b.acAttached && b.watts != null && b.watts < 0) return { w: -b.watts, from: 'battery' }
  const parts = [s.power.cpuW, s.power.gpuW, s.power.aneW, s.power.dramW].filter((v): v is number => v != null)
  return parts.length ? { w: parts.reduce((a, b) => a + b, 0), from: 'chip' } : null
}

/** The window's verdict: the average or the peak of the readings, from the source most samples had. */
export function judge(samples: Sample[], use: 'avg' | 'peak'): { w: number; from: Source } | null {
  const xs = samples.map(machineWatts).filter((x): x is { w: number; from: Source } => x != null)
  if (!xs.length) return null
  const counts = new Map<Source, number>()
  for (const x of xs) counts.set(x.from, (counts.get(x.from) ?? 0) + 1)
  const from = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  const ws = xs.filter((x) => x.from === from).map((x) => x.w)
  return { w: use === 'peak' ? Math.max(...ws) : ws.reduce((a, b) => a + b, 0) / ws.length, from }
}

/**
 * 100 for a perfect guess, falling with the ratio between guess and truth: twice or half the real value scores 37,
 * three times or a third scores 0. Ratios, not differences, because 2 W off matters at idle and not under load.
 */
export function guessScore(guess: number, actual: number): number {
  if (!(actual > 0) || !(guess > 0)) return 0
  const off = Math.abs(Math.log(guess / actual)) / Math.log(3)
  return Math.max(0, Math.round(100 * (1 - off)))
}

/** Where the watts went in one sample. `rest` is everything off the chip: the display, SSD, radios and losses. */
export function breakdown(s: Sample): { cpu: number; gpu: number; ane: number; dram: number; rest: number | null } {
  const p = s.power
  const cpu = p.cpuW ?? 0
  const gpu = p.gpuW ?? 0
  const ane = p.aneW ?? 0
  const dram = p.dramW ?? 0
  const rest = p.systemW == null ? null : Math.max(0, p.systemW - cpu - gpu - ane - dram)
  return { cpu, gpu, ane, dram, rest }
}

/**
 * Simulated readings for ?demo: rough levels shaped like a base M5 Air, with a little noise. Not measurements;
 * the page labels them simulated.
 */
export function simWatts(task: TaskId, t: number, rand: () => number = Math.random): { cpuW: number; gpuW: number; aneW: number; dramW: number; systemW: number } {
  const n = () => (rand() - 0.5) * 0.4
  const base = { cpuW: 0.4, gpuW: 0.05, aneW: 0, dramW: 0.3 }
  let rest = 5 + n()
  if (task === 'bright') rest += 4
  if (task === 'video') Object.assign(base, { cpuW: 1.1, gpuW: 0.6, dramW: 0.6 })
  if (task === 'app') Object.assign(base, { cpuW: t < 4 ? 9 - t * 1.6 : 1.2, gpuW: t < 4 ? 1.5 : 0.2, dramW: t < 4 ? 1 : 0.4 })
  if (task === 'cpu') Object.assign(base, { cpuW: 14 - t * 0.25, dramW: 0.6 })
  const cpuW = Math.max(0.1, base.cpuW + n())
  return { ...base, cpuW, systemW: cpuW + base.gpuW + base.aneW + base.dramW + rest }
}
