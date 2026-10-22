import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addressOf, estimateNs, humanTime, seeded, simulate, LAT_NS, TRACE, type SimInput } from './caches.ts'

const KB = 1024
const MB = 1024 * KB
const base: SimInput = {
  pattern: 'seq',
  arrayBytes: 64 * MB,
  elemBytes: 8,
  strideElems: 16,
  reads: 40000,
  lineBytes: 128,
  l1: { bytes: 128 * KB, ways: 8 },
  l2: { bytes: 16 * MB, ways: 16 },
  prefetch: false,
  seed: 7,
}
const total = (r: ReturnType<typeof simulate>) => r.l1Hits + r.l2Hits + r.dram

test('every read lands in exactly one level, and the trace agrees with the counts', () => {
  for (const pattern of ['seq', 'random', 'stride'] as const)
    for (const prefetch of [false, true]) {
      const r = simulate({ ...base, pattern, prefetch })
      assert.equal(total(r), base.reads)
      const t = simulate({ ...base, pattern, prefetch, reads: TRACE })
      assert.equal(t.trace.length, TRACE)
      assert.equal(t.trace.filter((x) => x === 2).length, t.dram)
      assert.equal(t.trace.filter((x) => x === 0).length, t.l1Hits)
    }
})

test('a sequential walk misses once per 128-byte line and hits the other 15 reads of 8 bytes', () => {
  const r = simulate(base)
  assert.equal(r.lines, base.reads / 16)
  assert.equal(r.dram, r.lines)
  assert.equal(r.l1Hits, base.reads - r.lines)
})

test('the prefetcher hides nearly every miss of a sequential walk', () => {
  const r = simulate({ ...base, prefetch: true })
  assert.ok(r.dram <= 3, `dram ${r.dram}`)
  assert.ok(r.prefetched >= r.lines - 3)
})

test('a stride of one line misses every time without a prefetcher, and almost never with one', () => {
  const off = simulate({ ...base, pattern: 'stride', strideElems: 16 })
  assert.equal(off.dram, base.reads)
  const on = simulate({ ...base, pattern: 'stride', strideElems: 16, prefetch: true })
  assert.ok(on.dram < base.reads / 100, `dram ${on.dram}`)
})

test('random reads over an array that fits in L1 only miss the first time each line is touched', () => {
  const r = simulate({ ...base, pattern: 'random', arrayBytes: 64 * KB })
  assert.equal(r.dram, r.lines)
  assert.ok(r.lines <= (64 * KB) / 128)
  assert.equal(r.l2Hits, 0)
})

test('random reads over an array far bigger than L2 mostly go to DRAM, and the prefetcher cannot help', () => {
  const r = simulate({ ...base, pattern: 'random', arrayBytes: 512 * MB })
  assert.ok(r.dram / base.reads > 0.9)
  const p = simulate({ ...base, pattern: 'random', arrayBytes: 512 * MB, prefetch: true })
  assert.ok(p.prefetched < base.reads / 1000)
})

test('a power-of-two stride piles every line into one L1 set: 16 lines thrash 8 ways, though L1 holds 1024 lines', () => {
  // 128 KB / 128 B / 8 ways = 128 sets. A 32 KB stride is 256 lines, so every line maps to set 0.
  const r = simulate({ ...base, pattern: 'stride', arrayBytes: 512 * KB, strideElems: (32 * KB) / 8, reads: 160 })
  assert.equal(r.lines, 16)
  assert.equal(r.l1Hits, 0)
  assert.ok(r.l2Hits > 0)
})

test('the same seed gives the same run, a different seed a different one', () => {
  const a = simulate({ ...base, pattern: 'random', arrayBytes: 4 * MB })
  const b = simulate({ ...base, pattern: 'random', arrayBytes: 4 * MB })
  const c = simulate({ ...base, pattern: 'random', arrayBytes: 4 * MB, seed: 8 })
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
})

test('strided addresses stay inside the array and cover it pass by pass', () => {
  const r = seeded(1)
  const got = Array.from({ length: 16 }, (_, n) => addressOf('stride', n, 16, 4, r))
  assert.deepEqual(got, [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15])
  for (let n = 0; n < 50; n++) assert.ok(addressOf('stride', n, 10, 4, r) < 10)
})

test('the time estimate weighs each level by its latency', () => {
  assert.equal(estimateNs({ l1Hits: 1, l2Hits: 1, dram: 1 }), LAT_NS.l1 + LAT_NS.l2 + LAT_NS.dram)
})

test('human time picks a sensible unit', () => {
  assert.equal(humanTime(0.7, 4.464), '3 seconds')
  assert.equal(humanTime(88, 4.464), '7 minutes')
  assert.equal(humanTime(73000, 4.464), '4 days')
  assert.equal(humanTime(0.01, 4.464), '1 second')
})
