import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_IT, PRESETS, SIMD, diverge, groups, inTriangle, parallel, render, serial } from './gpu.ts'

test('groups are 32 pixels each and cover every pixel exactly once', () => {
  const gs = groups(64, 48)
  assert.equal(gs.length, (64 * 48) / SIMD)
  assert.ok(gs.every((g) => g.length === SIMD))
  const all = gs.flat().sort((a, b) => a - b)
  assert.deepEqual(all, Array.from({ length: 64 * 48 }, (_, i) => i))
  assert.throws(() => groups(60, 48))
})

test('the serial painter takes the sum of all the work, in order', () => {
  const s = serial([1, 3, 2])
  assert.deepEqual(s.finish, [1, 4, 6])
  assert.equal(s.total, 6)
})

test('uniform work: the grid takes one tick per wave of groups, and wastes nothing', () => {
  const work = Array(64 * 48).fill(1)
  const p = parallel(work, 64, 48, 10)
  assert.equal(p.total, Math.ceil(96 / 10))
  assert.equal(p.useful, p.issued)
  assert.ok(p.finish.every((f) => f >= 1 && f <= p.total))
  // One core is still faster than one painter by the width of a group.
  assert.equal(parallel(work, 64, 48, 1).total, serial(work).total / SIMD)
})

test('a group waits for its slowest lane, so mandelbrot wastes lanes', () => {
  const work = render('mandel', 64, 48).map((s) => s.work)
  assert.ok(Math.max(...work) === MAX_IT && Math.min(...work) >= 1)
  const p = parallel(work, 64, 48, 10)
  assert.ok(p.useful < p.issued, 'divergence costs lane time')
  assert.equal(p.useful, serial(work).total)
  // One slow lane holds up its whole group.
  const one = Array(32).fill(1)
  one[5] = 40
  assert.equal(parallel(one, 8, 4, 1).total, 40)
})

test('more cores never make it slower, and the grid always beats one painter', () => {
  for (const { id } of PRESETS) {
    const work = render(id, 64, 48).map((s) => s.work)
    let prev = Infinity
    for (const cores of [1, 2, 8, 10, 40]) {
      const t = parallel(work, 64, 48, cores).total
      assert.ok(t <= prev, `${id} ${cores}`)
      prev = t
    }
    assert.ok(parallel(work, 64, 48, 1).total < serial(work).total, id)
  }
})

test('every preset gives values from 0 to 1', () => {
  for (const { id } of PRESETS) for (const s of render(id, 16, 8)) assert.ok(s.v >= 0 && s.v <= 1 && s.work >= 1, id)
})

test('triangle coverage works for either winding and excludes outside points', () => {
  const a: [number, number] = [0, 0]
  const b: [number, number] = [10, 0]
  const c: [number, number] = [0, 10]
  assert.ok(inTriangle([2, 2], a, b, c))
  assert.ok(inTriangle([2, 2], a, c, b))
  assert.ok(!inTriangle([8, 8], a, b, c))
  assert.ok(!inTriangle([-1, 5], a, b, c))
})

test('an if/else costs two passes only when a group really splits', () => {
  assert.deepEqual(diverge(Array(32).fill(true)), { yes: 32, no: 0, passes: 1 })
  assert.equal(diverge(Array.from({ length: 32 }, (_, i) => i < 3)).passes, 2)
})
