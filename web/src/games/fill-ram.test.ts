import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPRESS_GROW, SWAP_GROW, demoPoint, round, type MemPoint } from './fill-ram.ts'

const GiB = 2 ** 30
const total = 16 * GiB
const pt = (sec: number, o: Partial<MemPoint> = {}): MemPoint => ({
  t: 1_000_000 + sec * 1000,
  total,
  wired: 2 * GiB,
  app: 6 * GiB,
  compressed: 2 * GiB,
  stored: 4 * GiB,
  cached: 4 * GiB,
  free: 2 * GiB,
  swap: 3.5 * GiB,
  pressure: 'normal',
  compressions: 0,
  swapouts: 0,
  ...o,
})

test('no readings, no round', () => {
  const r = round([])
  assert.equal(r.score, 0)
  assert.equal(r.peak, null)
  assert.deepEqual(r.events, [])
})

test('swap and compressed memory left over from before the round score nothing', () => {
  const r = round([pt(0, { swap: 6 * GiB, compressed: 5 * GiB }), pt(1, { swap: 6 * GiB, compressed: 5 * GiB }), pt(2, { swap: 6 * GiB - 1, compressed: 5 * GiB + COMPRESS_GROW - 1 })])
  assert.equal(r.score, 0)
  assert.deepEqual(r.events.map((e) => e.kind), ['start'])
})

test('shrinking swap never counts as growth', () => {
  const r = round([pt(0), pt(1, { swap: 1 * GiB }), pt(2, { swap: 3.5 * GiB + SWAP_GROW - 1 })])
  assert.ok(!r.reached.has('swap'))
})

test('a full round fires each goal once, in time order, at the reading that crossed it', () => {
  const r = round([
    pt(0),
    pt(5, { free: 0.5 * GiB }),
    pt(9, { free: 0.3 * GiB, compressed: 2 * GiB + COMPRESS_GROW }),
    pt(12, { free: 0.2 * GiB, compressed: 3 * GiB, swap: 3.5 * GiB + SWAP_GROW }),
    pt(14, { free: 0.1 * GiB, compressed: 3.5 * GiB, swap: 4 * GiB, pressure: 'warn' }),
    pt(15, { free: 0.1 * GiB, compressed: 3.6 * GiB, swap: 4.2 * GiB, pressure: 'warn' }),
    pt(20, { free: 4 * GiB, compressed: 2.5 * GiB, swap: 4.1 * GiB }),
  ])
  assert.deepEqual(
    r.events.map((e) => [e.kind, e.at]),
    [['start', 0], ['tight', 5], ['compress', 9], ['swap', 12], ['warn', 14], ['calm', 20]],
  )
  assert.equal(r.score, 100)
  assert.deepEqual(r.peak, { pressure: 'warn', compressed: 3.6 * GiB, swap: 4.2 * GiB, minFree: 0.1 * GiB })
})

test('critical is logged once and counts as reaching warn; each recovery is logged', () => {
  const r = round([pt(0), pt(1, { pressure: 'critical' }), pt(2, { pressure: 'warn' }), pt(3, { pressure: 'critical' }), pt(4), pt(5), pt(6, { pressure: 'warn' }), pt(7)])
  assert.deepEqual(r.events.map((e) => e.kind), ['start', 'warn', 'critical', 'calm', 'calm'])
  assert.equal(r.peak?.pressure, 'critical')
  assert.equal(r.score, 40)
})

test('a round that starts under pressure scores warn but logs no recovery until it eases', () => {
  const r = round([pt(0, { pressure: 'warn' }), pt(1, { pressure: 'warn' })])
  assert.deepEqual(r.events.map((e) => e.kind), ['start', 'warn'])
})

test('the demo Mac fills up, compresses, then swaps as more apps open', () => {
  const pts = [0, 4, 8, 10, 12, 16].map((a, i) => demoPoint(a, i * 1000, total))
  for (const p of pts) assert.ok(Math.abs(p.wired + p.app! + (p.compressed - 0.3 * GiB) + p.cached + p.free - total) < 1, 'frames add up')
  const r = round(pts)
  assert.deepEqual([...r.reached].sort(), ['compress', 'swap', 'tight', 'warn'])
})
