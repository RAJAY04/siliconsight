import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { GROUPS, TOPICS, topicsIn } from './learn.ts'
import { demoHello } from './demo.ts'
import type { Sample } from './types.ts'

const dir = new URL('.', import.meta.url)
const sources = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
/** Every topic id the UI passes to an InfoButton, as `topic="id"`, `topic: 'id'` or `topic={cond ? 'a' : 'b'}`. */
function referencedIds(): Map<string, string> {
  const ids = new Map<string, string>()
  for (const f of sources) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    for (const m of src.matchAll(/\btopic(?:=|:\s*)["']([\w-]+)["']/g)) ids.set(m[1], f)
    for (const m of src.matchAll(/\btopic=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/[?:]\s*'([\w-]+)'/g)) ids.set(q[1], f)
  }
  return ids
}

test('every topic id the UI references exists, and the UI references a good spread of them', () => {
  const ids = referencedIds()
  for (const [id, file] of ids) assert.ok(TOPICS[id], `${file} references unknown topic "${id}"`)
  assert.ok(ids.size >= 30, `only ${ids.size} topics have a button somewhere`)
})

test('related links resolve, are not self links and are not repeated', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    assert.ok(t.related.length > 0, `${id} has no related topics`)
    assert.equal(new Set(t.related).size, t.related.length, `${id} repeats a related topic`)
    for (const r of t.related) {
      assert.ok(TOPICS[r], `${id} links to unknown topic "${r}"`)
      assert.notEqual(r, id, `${id} links to itself`)
    }
  }
})

test('every group has topics and every topic sits in a listed group', () => {
  for (const g of GROUPS) assert.ok(topicsIn(g).length > 0, `group ${g} is empty`)
  assert.equal(GROUPS.reduce((n, g) => n + topicsIn(g).length, 0), Object.keys(TOPICS).length)
})

test('copy follows the house style: no em or en dashes, curly quotes or emoji', () => {
  const text = JSON.stringify(TOPICS) + sources.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('')
  for (const [ch, name] of [
    ['—', 'em dash'],
    ['–', 'en dash'],
    ['“', 'curly quote'],
    ['”', 'curly quote'],
    ['’', 'curly apostrophe'],
  ]) {
    assert.ok(!text.includes(ch), `found an ${name}`)
  }
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'found an emoji')
  for (const [id, t] of Object.entries(TOPICS)) {
    assert.ok(t.summary && t.sections.length && t.source, `${id} is missing content`)
    assert.equal(t.source.split('`').length % 2, 1, `${id} source has an unclosed code span`)
  }
})

function sample(over: Partial<Sample> = {}): Sample {
  return {
    type: 'sample',
    t: 0,
    cpu: {
      cores: [...Array.from({ length: 6 }, (_, id) => ({ id, kind: 'E' as const, usage: 0.3 })), ...Array.from({ length: 4 }, (_, i) => ({ id: 6 + i, kind: 'P' as const, usage: 0.05 }))],
      pFreqMHz: 1200,
      eFreqMHz: 1000,
    },
    gpu: { usage: 0.1, freqMHz: 0 },
    power: { cpuW: 1.2, gpuW: 0.3, aneW: 0, dramW: null, systemW: 5.5 },
    memory: {
      totalBytes: 16 * 2 ** 30, wiredBytes: 2e9, activeBytes: 4e9, inactiveBytes: 3e9,
      compressedBytes: 5e8, freeBytes: 6e9, appBytes: 5e9, swapUsedBytes: 3e8,
      pressure: 'normal', bandwidthGBs: 12,
    },
    topCpu: [{ pid: 1, name: 'clang', cpu: 180 }],
    topMem: [{ pid: 1, name: 'Safari', bytes: 2e9 }],
    disk: { readBps: 1e6, writeBps: 2e5 },
    net: { rxBps: 3e4, txBps: 1e3, iface: 'en0' },
    thermal: { state: 'nominal', cpuTempC: 48, gpuTempC: 44, batteryTempC: 31 },
    fans: [],
    battery: { percent: 80, charging: false, acAttached: true, watts: 0, adapterW: 70, cycleCount: 112, healthPct: 98, timeRemainingMin: null, chargeHeld: true },
    llm: { runtime: 'ollama', models: [{ name: 'llama3', sizeBytes: 4.7e9, vramBytes: null }], tokensPerSec: null },
    ...over,
  }
}
/** What an old reader on an unknown Mac might send: every nullable field null, no battery, no sensors. */
const bare = sample({
  cpu: { cores: [], pFreqMHz: null, eFreqMHz: null },
  gpu: { usage: null, freqMHz: null },
  power: { cpuW: null, gpuW: null, aneW: null, dramW: null, systemW: null },
  memory: { ...sample().memory, appBytes: null, bandwidthGBs: null, swapUsedBytes: 0 },
  topCpu: [],
  topMem: [],
  net: { rxBps: 0, txBps: 0, iface: null },
  thermal: { state: 'fair', cpuTempC: null, gpuTempC: null, batteryTempC: null },
  battery: null,
  llm: null,
})

test('live lines read well with full data and with every value missing', () => {
  const unknownChip = { ...demoHello.hardware, chip: 'Apple M9', gpuCores: null }
  for (const [hw, s] of [
    [demoHello.hardware, sample()],
    [unknownChip, bare],
  ] as const) {
    for (const [id, t] of Object.entries(TOPICS)) {
      for (const now of [t.now, t.plain?.now]) {
        const line = now?.({ hw, s, history: [s, s] })
        if (line == null) continue
        assert.ok(line.length > 10, `${id}: "${line}"`)
        assert.ok(!/NaN|undefined|null|Infinity|\[object/.test(line), `${id}: "${line}"`)
      }
    }
  }
})

test('the LLM explainer works out the same ceiling as the story card', () => {
  const line = TOPICS['llm-bandwidth'].now!({ hw: demoHello.hardware, s: sample(), history: [] })
  // 153 GB/s over a 4.7 GB model.
  assert.match(line!, /153 GB\/s ÷ 4\.7 GB ≈ 33 tokens/)
})

test('missing counters are said to be missing, never shown as zero', () => {
  const now = (id: string) => TOPICS[id].now!({ hw: demoHello.hardware, s: bare, history: [bare] })!
  assert.match(now('memory-interface'), /n\/a/)
  assert.match(now('neural-engine'), /n\/a/)
  assert.match(now('dvfs'), /n\/a/)
  assert.match(now('power'), /n\/a/)
  assert.match(now('ioreport'), /None of the IOReport values/)
  assert.doesNotMatch(now('power'), /0\.0 W/)
})

test('every topic cites at least one https source, with a title and a note', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    assert.ok(t.sources.length > 0, `${id} has no sources`)
    for (const s of t.sources) {
      assert.match(s.url, /^https:\/\/[^\s]+\.[^\s]+/, `${id}: bad source url ${s.url}`)
      assert.ok(s.title.length > 3 && s.note.length > 3, `${id}: source needs a title and a note`)
    }
    assert.equal(new Set(t.sources.map((s) => s.url + s.note)).size, t.sources.length, `${id} repeats a source`)
  }
})

test('every topic has an everyday-words version that uses the shared comparisons', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    assert.ok(t.plain, `${id} has no plain version`)
    assert.ok(t.plain.summary.length > 20 && t.plain.sections.length > 0, `${id} plain version is empty`)
    assert.notEqual(t.plain.summary, t.summary, `${id} plain summary just repeats the technical one`)
  }
  const uses = (id: string, phrase: string) => assert.match(JSON.stringify(TOPICS[id].plain), new RegExp(phrase), `${id} should say ${phrase}`)
  uses('p-cores', 'Fast Workers')
  uses('e-cores', 'Eco Workers')
  uses('unified-memory', 'Desk Space')
  uses('memory-interface', 'Highway Speed')
  uses('swap', 'Overflow Storage')
})

test('everyday "Right now" lines avoid the jargon the technical ones use', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    const line = t.plain?.now?.({ hw: demoHello.hardware, s: sample(), history: [sample()] })
    if (line == null) continue
    assert.doesNotMatch(line, /\b[PE]-c(ores|luster)|MHz|\bpressure is\b|\bswap\b/, `${id}: "${line}"`)
  }
  assert.match(TOPICS['p-cores'].plain!.now!({ hw: demoHello.hardware, s: sample(), history: [] })!, /Fast Workers are 5% busy/)
})
