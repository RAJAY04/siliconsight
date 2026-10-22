import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAD_ASPECT, fromPad } from '../games.ts'
import { HOLES, ROUND_S, centroid, holeAt, holeCenter, hitPoints, pace, pickHole, proximity, strongest, touchDowns } from './mole.ts'

const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)

test('a tap lands in the hole under it, with the hinge edge on the top row', () => {
  // The reader's y runs front to back, so a tap near the hinge (y close to 1) is in the top row.
  assert.equal(holeAt(fromPad(0.05, 0.95)), 0)
  assert.equal(holeAt(fromPad(0.95, 0.95)), 2)
  assert.equal(holeAt(fromPad(0.5, 0.5)), 4)
  assert.equal(holeAt(fromPad(0.05, 0.05)), 6)
  assert.equal(holeAt(fromPad(0.95, 0.05)), 8)
  for (let i = 0; i < HOLES; i++) assert.equal(holeAt(holeCenter(i)), i)
})

test('taps on the very edge or past it still pick an edge hole instead of a hole that does not exist', () => {
  assert.equal(holeAt({ x: PAD_ASPECT, y: 1 }), 8)
  assert.equal(holeAt({ x: -0.2, y: -0.2 }), 0)
  assert.equal(holeAt({ x: PAD_ASPECT * 1.5, y: 0.5 }), 5)
})

test('the round gets faster and busier, never slower, and stays playable at the buzzer', () => {
  let prev = pace(0)
  for (let t = 1; t <= ROUND_S + 5; t++) {
    const p = pace(t)
    assert.ok(p.upMs <= prev.upMs && p.gapMs <= prev.gapMs && p.maxUp >= prev.maxUp, `t=${t}`)
    prev = p
  }
  // About 190 ms is a typical simple visual reaction; a mole must stay up well past that, plus the 33 ms frame.
  assert.ok(pace(ROUND_S).upMs >= 600)
  assert.equal(pace(0).maxUp, 1)
})

test('a new mole never appears in a busy hole, avoids repeating the last hole, and gives up when the board is full', () => {
  const r = seeded(11)
  for (let i = 0; i < 500; i++) {
    const busy = [0, 4, 8]
    const h = pickHole(busy, 3, r)
    assert.ok(h != null && !busy.includes(h) && h !== 3, `${h}`)
  }
  assert.equal(pickHole([0, 1, 2, 3, 4, 5, 6, 7], 8, r), 8)
  assert.equal(pickHole([0, 1, 2, 3, 4, 5, 6, 7, 8], -1, r), null)
  // A generator that returns exactly 1 still picks a real hole.
  assert.ok(pickHole([], -1, () => 1)! < HOLES)
})

test('a hit is worth 10 to 20, more for a faster whack', () => {
  assert.equal(hitPoints(0, 1000), 20)
  assert.equal(hitPoints(1000, 1000), 10)
  assert.equal(hitPoints(1400, 1000), 10)
  assert.ok(hitPoints(200, 1000) > hitPoints(600, 1000))
})

test('a finger held down whacks once; lifting and tapping again whacks again', () => {
  const f = (id: number) => ({ id, x: 0.5, y: 0.5 })
  assert.deepEqual(touchDowns(new Set(), [f(3)]).map((x) => x.id), [3])
  assert.deepEqual(touchDowns(new Set([3]), [f(3)]), [])
  assert.deepEqual(touchDowns(new Set([3]), [f(3), f(4)]).map((x) => x.id), [4])
  // Lifted (an empty frame), then the same id comes back: a new tap.
  assert.deepEqual(touchDowns(new Set(), [f(3)]).map((x) => x.id), [3])
})

test('the weighted centroid finds a finger between electrodes, where the strongest electrode alone cannot', () => {
  for (const p of [{ x: 0.61, y: 0.43 }, { x: 0.97, y: 0.58 }, { x: 0.4, y: 0.33 }]) {
    const prox = proximity(p)
    const c = centroid(prox)!
    const s = strongest(prox)
    const err = Math.hypot(c.x - p.x, c.y - p.y)
    assert.ok(err < 0.01, `centroid off by ${err}`)
    assert.ok(Math.hypot(s.x - p.x, s.y - p.y) > err, 'the grid-snapped answer should be worse')
  }
})

test('with nothing touching there is no centroid instead of a made-up point', () => {
  assert.equal(centroid(proximity({ x: 50, y: 50 })), null)
})
