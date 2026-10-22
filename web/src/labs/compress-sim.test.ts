import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APP_PAGES, CACHE0, CACHE_MIN, COMP_MAX, MAX_APPS, RAM, SWAP_MAX, WIRED, ratio, simulate, type Mix } from './compress-sim.ts'

const kinds = (mix: Mix, n: number) => {
  const s = simulate(n, mix)
  const c = (k: string) => s.slots.filter((x) => x.k === k).length
  return { s, free: c('free'), cache: c('cache'), cmp: c('cmp'), app: c('app'), wired: c('wired') }
}

test('every frame is accounted for and wired frames never move, for every input', () => {
  for (const mix of ['text', 'zeros', 'random', 'mixed'] as Mix[]) {
    for (let n = 0; n <= MAX_APPS + 2; n++) {
      const k = kinds(mix, n)
      assert.equal(k.free + k.cache + k.cmp + k.app + k.wired, RAM)
      assert.equal(k.wired, WIRED)
      assert.ok(k.cmp <= COMP_MAX, `${mix} ${n}: ${k.cmp} compressor frames`)
      assert.ok(k.s.swapUnits <= SWAP_MAX + 1e-9)
    }
  }
})

test('pages that are not resident are all in the compressor or in swap', () => {
  for (const mix of ['text', 'random', 'mixed'] as Mix[]) {
    for (let n = 1; n <= MAX_APPS; n++) {
      const k = kinds(mix, n)
      if (k.s.oom) continue
      assert.equal(k.app + k.s.inCompressor + k.s.swapPages, n * APP_PAGES, `${mix} ${n}`)
    }
  }
})

test('free goes first, then cache, and only then the compressor', () => {
  const start = kinds('text', 0)
  assert.equal(start.cache, CACHE0)
  assert.equal(start.s.compressions, 0)
  // Enough apps to eat the free frames but not the cache.
  const freeOnly = Math.floor((RAM - WIRED - CACHE0) / APP_PAGES)
  assert.equal(kinds('text', freeOnly).s.drops, 0)
  const later = kinds('text', freeOnly + 2)
  assert.ok(later.s.drops > 0)
  assert.equal(later.s.compressions, 0)
  const more = kinds('text', freeOnly + 4)
  assert.equal(more.cache, CACHE_MIN)
  assert.ok(more.s.compressions > 0)
})

test('the newest app is never compressed and the oldest goes first', () => {
  const k = kinds('text', 10)
  const resident = k.s.slots.flatMap((s) => (s.k === 'app' ? [s.app] : []))
  assert.equal(resident.filter((a) => a === 9).length, APP_PAGES)
  assert.ok(!resident.includes(0), 'app 0 should be compressed or swapped first')
  assert.ok(k.s.slots.every((s) => s.k !== 'app' || s.hot === (s.app === 9)))
})

test('zero pages barely use the compressor and never swap; random data swaps and runs out first', () => {
  const z = simulate(MAX_APPS, 'zeros')
  assert.equal(z.swapUnits, 0)
  assert.equal(z.cmpSlots, 1)
  assert.equal(z.pressure, 'normal')
  assert.ok(ratio(z)! > 10)

  const t = simulate(MAX_APPS, 'text')
  assert.ok(Math.abs(ratio(t)! - 2) < 0.25, `text ratio ${ratio(t)}`)
  assert.ok(t.swapUnits > 0)
  assert.equal(t.oom, false)

  const r = simulate(MAX_APPS, 'random')
  assert.equal(ratio(r), 1)
  assert.equal(r.oom, true)
  assert.equal(r.pressure, 'critical')
  assert.ok(r.opened < MAX_APPS)
})

test('pressure only rises as apps open, and swap only grows', () => {
  const rank = { normal: 0, warn: 1, critical: 2 }
  for (const mix of ['text', 'zeros', 'random', 'mixed'] as Mix[]) {
    let p = 0
    let sw = 0
    for (let n = 0; n <= MAX_APPS; n++) {
      const s = simulate(n, mix)
      assert.ok(rank[s.pressure] >= p, `${mix} ${n}`)
      assert.ok(s.swapUnits >= sw - 1e-9)
      p = rank[s.pressure]
      sw = s.swapUnits
    }
  }
})

test('asking for more apps than the slider allows is capped, and negative is empty', () => {
  assert.deepEqual(simulate(MAX_APPS + 5, 'text'), simulate(MAX_APPS, 'text'))
  assert.equal(simulate(-3, 'text').opened, 0)
})
