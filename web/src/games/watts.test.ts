import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Sample } from '../types.ts'
import { breakdown, guessScore, judge, machineWatts, simWatts } from './watts.ts'

const power = (p: Partial<Sample['power']>, battery: Sample['battery'] = null) =>
  ({ power: { cpuW: null, gpuW: null, aneW: null, dramW: null, systemW: null, ...p }, battery }) as Sample
const onBattery = (watts: number | null) =>
  ({ percent: 60, charging: false, acAttached: false, watts, adapterW: null, cycleCount: null, healthPct: null, timeRemainingMin: null, chargeHeld: false }) as Sample['battery']

test('the whole-machine reading prefers the system total, then battery outflow, then the chip parts', () => {
  assert.deepEqual(machineWatts(power({ systemW: 9, cpuW: 1 })), { w: 9, from: 'system' })
  assert.deepEqual(machineWatts(power({ cpuW: 1 }, onBattery(-7.5))), { w: 7.5, from: 'battery' })
  // On AC, or charging, the battery's flow says nothing about what the Mac uses.
  assert.deepEqual(machineWatts(power({ cpuW: 1, gpuW: 0.5 }, { ...onBattery(12)!, acAttached: true })), { w: 1.5, from: 'chip' })
  assert.equal(machineWatts(power({})), null)
})

test('a window is judged by its average or its peak, and one odd sample from another source does not mix units', () => {
  const xs = [power({ systemW: 8 }), power({ systemW: 12 }), power({ systemW: 10 }), power({ cpuW: 40 })]
  assert.deepEqual(judge(xs, 'avg'), { w: 10, from: 'system' })
  assert.deepEqual(judge(xs, 'peak'), { w: 12, from: 'system' })
  assert.equal(judge([power({})], 'avg'), null)
  assert.equal(judge([], 'peak'), null)
})

test('closeness is a ratio: right on scores 100, double or half the same, three times off scores 0', () => {
  assert.equal(guessScore(10, 10), 100)
  assert.equal(guessScore(20, 10), guessScore(5, 10))
  assert.equal(guessScore(20, 10), 37)
  assert.equal(guessScore(30, 10), 0)
  assert.equal(guessScore(100, 10), 0)
  // 2 W off is a big miss at idle and a small one under load.
  assert.ok(guessScore(6, 4) < guessScore(22, 20))
})

test('a missing reading or a zero guess scores nothing instead of NaN or Infinity', () => {
  assert.equal(guessScore(10, 0), 0)
  assert.equal(guessScore(0, 10), 0)
  assert.equal(guessScore(10, NaN), 0)
})

test('the breakdown never shows a negative rest, and has no rest without a system total', () => {
  assert.equal(breakdown(power({ systemW: 3, cpuW: 2, gpuW: 2 })).rest, 0)
  assert.equal(breakdown(power({ cpuW: 2 })).rest, null)
  assert.equal(breakdown(power({ systemW: 10, cpuW: 2, dramW: 0.5 })).rest, 7.5)
})

test('the simulation ranks the tasks the way the lessons do', () => {
  const avg = (id: Parameters<typeof simWatts>[0]) => {
    let s = 0
    for (let t = 0; t < 10; t++) s += simWatts(id, t, () => 0.5).systemW
    return s / 10
  }
  assert.ok(avg('idle') < avg('video') && avg('video') < avg('cpu'))
  assert.ok(avg('bright') > avg('idle'))
})
