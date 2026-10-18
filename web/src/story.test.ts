import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byApp, detectStory, chipLine, clusterAvg, recentAvg } from './story.ts'
import { bytes, memGB, rate, watts, pct, minutes, mhz, NA } from './format.ts'
import { demoHello } from './demo.ts'
import type { Sample } from './types.ts'

function sample(p: number, e: number, over: Partial<Sample> = {}): Sample {
  return {
    type: 'sample',
    t: 0,
    cpu: {
      cores: [
        ...Array.from({ length: 6 }, (_, id) => ({ id, kind: 'E' as const, usage: e })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: 6 + i, kind: 'P' as const, usage: p })),
      ],
      pFreqMHz: null,
      eFreqMHz: null,
    },
    gpu: { usage: 0.02, freqMHz: null },
    power: { cpuW: null, gpuW: null, aneW: null, dramW: null, systemW: null },
    memory: {
      totalBytes: 16 * 2 ** 30, wiredBytes: 2e9, activeBytes: 4e9, inactiveBytes: 3e9,
      compressedBytes: 5e8, freeBytes: 6e9, appBytes: 5e9, swapUsedBytes: 0,
      pressure: 'normal', bandwidthGBs: null,
    },
    topCpu: [{ pid: 1, name: 'clang', cpu: 380 }],
    topMem: [],
    disk: { readBps: 0, writeBps: 0 },
    net: { rxBps: 0, txBps: 0, iface: null },
    thermal: { state: 'nominal', cpuTempC: null, gpuTempC: null, batteryTempC: null },
    fans: [],
    battery: null,
    llm: null,
    ...over,
  }
}
const run = (s: Sample, n = 6) => Array(n).fill(s)

test('idle, compile and background are told apart', () => {
  assert.equal(detectStory(run(sample(0.02, 0.1))).kind, 'idle')
  assert.equal(detectStory(run(sample(0.9, 0.4))).kind, 'compile')
  assert.equal(detectStory(run(sample(0.05, 0.5))).kind, 'indexing')
  assert.equal(detectStory([]).kind, 'idle')
})

test('one spike does not flip the story', () => {
  const h = [...run(sample(0.02, 0.1), 4), sample(1, 0.1)]
  assert.equal(detectStory(h).kind, 'idle')
})

const llm = (models: { name: string; sizeBytes: number | null }[], tokensPerSec: number | null): Sample['llm'] => ({
  runtime: 'ollama',
  models: models.map((m) => ({ ...m, vramBytes: null })),
  tokensPerSec,
})

test('llm story: ceiling is the chip peak bandwidth over the size of the model it names', () => {
  const s = sample(0.1, 0.2, { llm: llm([{ name: 'small', sizeBytes: 1e9 }, { name: 'big', sizeBytes: 5.1e9 }], 22) })
  const story = detectStory(run(s), 'Apple M5')
  assert.equal(story.kind, 'llm')
  assert.match(story.text, /^big \(5\.1 GB\) is generating/)
  assert.equal(story.formula?.peakGBs, 153)
  assert.equal(story.formula?.maxTokS?.toFixed(1), "30.0")
  assert.equal(story.formula?.observedTokS, 22)
})

test('llm story on a chip missing from the table has no ceiling number', () => {
  const s = sample(0.1, 0.2, { llm: llm([{ name: 'm', sizeBytes: 4e9 }], 20) })
  const f = detectStory(run(s), 'Apple M9').formula
  assert.equal(f?.modelGB, 4)
  assert.equal(f?.peakGBs, null)
  assert.equal(f?.maxTokS, null)
})

test('a loaded but idle model is a note, never the story, and never hides a compile', () => {
  const idle = sample(0.9, 0.4, { llm: llm([{ name: 'm', sizeBytes: 4e9 }], null) })
  const story = detectStory(run(idle), 'Apple M5')
  assert.equal(story.kind, 'compile')
  assert.equal(story.note, 'm (4.0 GB) is loaded and idle.')
})

test('a loaded model counts as generating when the GPU is busy even without a token rate', () => {
  const s = sample(0.1, 0.2, { gpu: { usage: 0.8, freqMHz: null }, llm: llm([{ name: 'm', sizeBytes: null }], null) })
  const story = detectStory(run(s))
  assert.equal(story.kind, 'llm')
  assert.equal(story.formula, undefined)
})

test('GPU load plus a memory jump is not called an LLM without a runtime', () => {
  const before = sample(0.05, 0.2)
  const after = sample(0.05, 0.2, { gpu: { usage: 0.9, freqMHz: null }, memory: { ...before.memory, appBytes: 9.8e9 } })
  assert.notEqual(detectStory([...run(before, 10), ...run(after, 5)]).kind, 'llm')
})

test('heavy CPU needs the latest sample busy too, and full-out wording needs top clocks', () => {
  const busy = (p: number, f: number) => sample(p, 0.3, { cpu: { ...sample(p, 0.3).cpu, pFreqMHz: f } })
  // Median is busy but the burst just ended.
  assert.notEqual(detectStory([...run(busy(0.9, 4000), 4), busy(0.1, 1200)]).kind, 'compile')
  assert.match(detectStory(run(busy(0.95, 4400))).text, /near full/)
  // Busy but well below the clock this session has seen.
  const h = [busy(0.95, 4400), ...run(busy(0.95, 3000), 5)]
  assert.equal(detectStory(h).kind, 'compile')
  assert.doesNotMatch(detectStory(h).text, /near full|highest/)
  assert.doesNotMatch(detectStory(run(busy(0.7, 4400))).text, /near full/)
})

test('cluster average is null, not zero, when a cluster has no cores', () => {
  const s = sample(0.5, 0.5)
  assert.equal(clusterAvg({ ...s, cpu: { ...s.cpu, cores: s.cpu.cores.filter((c) => c.kind === 'P') } }, 'E'), null)
})

test('chip line names the busy cluster with real counts', () => {
  assert.match(chipLine(sample(0.9, 0.3), demoHello.hardware), /4 performance cores are awake/)
  assert.match(chipLine(sample(0.02, 0.4), demoHello.hardware), /^Background work stays on the 6 efficiency cores/)
})

test('formatters never turn null into 0', () => {
  for (const f of [bytes, memGB, rate, watts, pct, minutes, mhz]) {
    assert.equal(f(null), NA)
    assert.equal(f(undefined), NA)
    assert.equal(f(NaN), NA)
  }
  assert.equal(bytes(0), '0 B')
  assert.equal(watts(0), '0.0 W')
})

test('formatter units', () => {
  assert.equal(bytes(4.7e9), '4.7 GB')
  assert.equal(bytes(999), '999 B')
  assert.equal(bytes(1500), '1.5 KB')
  assert.equal(bytes(250e6), '250 MB')
  assert.equal(rate(2.6e9), '2.6 GB/s')
  assert.equal(memGB(16 * 2 ** 30, 0), '16 GB')
  assert.equal(memGB(129 * 2 ** 20), '129 MB')
  assert.equal(pct(0.456), '46%')
  assert.equal(minutes(135), '2 h 15 min')
  assert.equal(minutes(42), '42 min')
  assert.equal(mhz(4512), '4.51 GHz')
  assert.equal(mhz(780), '780 MHz')
  assert.equal(watts(-12.34), '-12 W')
})

test('recentAvg skips nulls and returns null when nothing was read', () => {
  const at = (w: number | null) => sample(0, 0, { power: { cpuW: null, gpuW: null, aneW: null, dramW: null, systemW: w } })
  const h = [at(100), at(4), at(null), at(8)]
  assert.equal(recentAvg(h, (s) => s.power.systemW), 6)
  assert.equal(recentAvg([at(null)], (s) => s.power.systemW), null)
})

test('the busiest process is named as a process', () => {
  assert.match(detectStory(run(sample(0.3, 0.3))).text, /led by the clang process\./)
})

test('processes sharing a name are merged into one row, largest first', () => {
  const rows = byApp(
    [
      { name: 'Google Chrome', cpu: 26 },
      { name: 'fontd', cpu: 32 },
      { name: 'Google Chrome', cpu: 25 },
    ],
    (p) => p.cpu,
  )
  assert.deepEqual(rows, [
    { name: 'Google Chrome', n: 2, v: 51 },
    { name: 'fontd', n: 1, v: 32 },
  ])
})
