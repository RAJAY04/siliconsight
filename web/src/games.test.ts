import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LID_GAP, LID_MAX, LID_MIN, LID_TOL, PAD_ASPECT, SHAPES, fromPad, nextHold, outline, pickTarget, roundPoints, scoreTrace, type Pt } from './games.ts'

// A seeded generator so the noisy cases are the same every run.
const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)

test('the hold builds only inside the window and starts over when the lid leaves it or the reading drops', () => {
  let h = 0
  for (let i = 0; i < 10; i++) h = nextHold(h, 75 + LID_TOL, 75, 0.1)
  assert.ok(Math.abs(h - 1) < 1e-9)
  assert.equal(nextHold(h, 75 + LID_TOL + 0.5, 75, 0.1), 0)
  assert.equal(nextHold(h, null, 75, 0.1), 0)
})

test('targets are whole degrees in range and always a real move away', () => {
  const r = seeded(7)
  for (const cur of [null, LID_MIN, 60, 82, 100, LID_MAX, 140, 0]) {
    for (let i = 0; i < 200; i++) {
      const t = pickTarget(cur, r)
      assert.ok(Number.isInteger(t) && t >= LID_MIN && t <= LID_MAX, `${t}`)
      if (cur != null) assert.ok(Math.abs(t - cur) >= LID_GAP, `${t} vs ${cur}`)
    }
  }
  // A generator stuck next to the lid still ends with a far target.
  assert.ok(Math.abs(pickTarget(80, () => 0.47) - 80) >= LID_GAP)
})

test('faster hits score more, and a hit at the buzzer still scores', () => {
  assert.equal(roundPoints(20, 20), 100)
  assert.ok(roundPoints(15, 20) > roundPoints(5, 20))
  assert.equal(roundPoints(0, 20), 10)
})

test('every shape fits on the pad with room around it', () => {
  for (const { key } of SHAPES) {
    for (const p of outline(key)) assert.ok(p.x > 0.05 && p.x < PAD_ASPECT - 0.05 && p.y > 0.05 && p.y < 0.95, `${key} ${JSON.stringify(p)}`)
  }
})

test('the pad maps front to the bottom of the drawing, hinge to the top', () => {
  assert.deepEqual(fromPad(0, 0), { x: 0, y: 1 })
  assert.deepEqual(fromPad(1, 1), { x: PAD_ASPECT, y: 0 })
})

test('tracing the outline itself scores near 100, and a steady hand with a little wobble still scores well', () => {
  for (const { key } of SHAPES) {
    const out = outline(key)
    assert.ok(scoreTrace(out, out).score >= 95, key)
    const r = seeded(3)
    const wobbly = out.map((p) => ({ x: p.x + (r() - 0.5) * 0.04, y: p.y + (r() - 0.5) * 0.04 }))
    const s = scoreTrace(wobbly, out)
    assert.ok(s.score >= 75, `${key} ${s.score}`)
  }
})

test('a perfect dab on a small piece of the outline scores low, though it is accurate', () => {
  const out = outline('circle')
  const s = scoreTrace(out.slice(0, 12), out)
  assert.ok(s.accuracy > 0.9)
  assert.ok(s.coverage < 0.15)
  assert.ok(s.score < 15, `${s.score}`)
})

test('scribbling over the whole pad covers the outline but scores low on accuracy', () => {
  const out = outline('star')
  const zigzag: Pt[] = []
  for (let row = 0; row <= 20; row++) {
    const y = row / 20
    zigzag.push({ x: row % 2 ? PAD_ASPECT : 0, y }, { x: row % 2 ? 0 : PAD_ASPECT, y })
  }
  const s = scoreTrace(zigzag, out)
  assert.ok(s.coverage > 0.6, `${s.coverage}`)
  assert.ok(s.score < 40, `${s.score}`)
})

test('a stroke shifted off the outline loses accuracy and coverage together', () => {
  const out = outline('circle')
  const near = scoreTrace(out.map((p) => ({ x: p.x + 0.03, y: p.y })), out).score
  const far = scoreTrace(out.map((p) => ({ x: p.x + 0.1, y: p.y })), out).score
  assert.ok(near > far && far < 40, `${near} ${far}`)
})

test('a tap or an empty stroke scores zero instead of dividing by zero', () => {
  const out = outline('square')
  assert.equal(scoreTrace([], out).score, 0)
  assert.equal(scoreTrace([{ x: 1, y: 0.5 }], out).score, 0)
  assert.equal(scoreTrace([{ x: 1, y: 0.5 }, { x: 1, y: 0.5 }], out).score, 0)
})
