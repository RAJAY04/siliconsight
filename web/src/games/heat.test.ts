import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOAD_S, NEVER, fanAt, predictScore, simHeat, throttleAt, type Point } from './heat.ts'

const run = (ps: (number | null)[], rpm: (number | null)[] = []) => ps.map((pMHz, t): Point => ({ t, pMHz, tempC: 60, rpm: rpm[t] ?? null, state: 'nominal' }))

test('the drop is measured from the peak under load, not from the idle clock it started at', () => {
  // Idle at 2450 MHz, ramps to 4464 under load, then sags: the ramp is not a drop, the sag is.
  assert.equal(throttleAt(run([2450, 4464, 4460, 4300, 4000, 3950, 3900])), 4)
})

test('one low sample is noise; it takes two in a row', () => {
  assert.equal(throttleAt(run([4464, 4464, 3900, 4450, 4460, 4440])), null)
  assert.equal(throttleAt(run([4464, 3900, 3900])), 1)
})

test('missing clock readings are skipped instead of read as a drop to zero', () => {
  assert.equal(throttleAt(run([4464, null, 4460, null])), null)
  assert.equal(throttleAt(run([null, null])), null)
})

test('fans count as spun up only when they rise well above where they started, even from a stop', () => {
  assert.equal(fanAt(run([0, 0, 0, 0], [0, 150, 390, 900])), 3)
  assert.equal(fanAt(run([0, 0, 0], [1200, 1300, 1500])), null)
  assert.equal(fanAt(run([0, 0], [])), null)
})

test('predictions score by seconds off, and "not within the minute" can be exactly right', () => {
  assert.equal(predictScore(20, 20), 100)
  assert.equal(predictScore(25, 20), 80)
  assert.equal(predictScore(10, 40), 0)
  assert.equal(predictScore(null, null), 100)
  assert.equal(predictScore(null, LOAD_S - 2), predictScore(NEVER, LOAD_S - 2))
  assert.equal(predictScore(5, null), 0)
})

test('the simulated Air throttles about half a minute in, as in lesson 5, and the simulated Pro does not', () => {
  const air = Array.from({ length: LOAD_S }, (_, t) => ({ t, ...simHeat(t, false, LOAD_S, () => 0.5) }))
  const at = throttleAt(air)!
  assert.ok(at >= 20 && at <= 35, `${at}`)
  assert.ok(air.every((p) => p.tempC! < 95))
  const pro = Array.from({ length: LOAD_S }, (_, t) => ({ t, ...simHeat(t, true, LOAD_S, () => 0.5) }))
  assert.equal(throttleAt(pro), null)
  const fan = fanAt(pro)!
  assert.ok(fan > 5 && fan < 30, `${fan}`)
})

test('after the load stops the simulated Air cools and never jumps above where it was', () => {
  const before = simHeat(40, false, 40, () => 0.5).tempC!
  let prev = before
  for (let t = 41; t < 60; t++) {
    const c = simHeat(t, false, 40, () => 0.5).tempC!
    assert.ok(c < prev, `${t}`)
    prev = c
  }
  assert.ok(prev < 70)
})
