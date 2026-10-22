import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GAMES, LID_GAP, LID_MAX, LID_MIN, PAD_ASPECT, SHAPES, fromPad, gameAt, lidPoints, lidVerdict, outline, pickTarget, scoreTrace, type Pt } from './games.ts'

// A seeded generator so the noisy cases are the same every run.
const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)

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

test('a guess within a degree scores full marks, and points fall evenly to zero as the guess drifts', () => {
  assert.equal(lidPoints(0), 100)
  assert.equal(lidPoints(-1), 100)
  assert.equal(lidPoints(1.4), 98)
  assert.equal(lidPoints(5), lidPoints(-5))
  assert.ok(lidPoints(4) > lidPoints(8))
  assert.equal(lidPoints(21), 0)
  assert.equal(lidPoints(60), 0)
})

test('the verdict reads the size of the miss, not its direction', () => {
  assert.equal(lidVerdict(1.9), lidVerdict(-1.9))
  const words = [0, 4, 9, 30].map(lidVerdict)
  assert.equal(new Set(words).size, 4, words.join(', '))
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

test('gameAt opens a game only from its own #play/<id> hash', () => {
  assert.equal(gameAt('#play/lid')?.id, 'lid')
  assert.equal(gameAt('play/fill-ram')?.name, 'Fill the RAM')
  assert.equal(gameAt('#play'), null)
  assert.equal(gameAt('#play/'), null)
  assert.equal(gameAt('#play/nope'), null)
  assert.equal(gameAt('#labs/lid'), null)
  assert.equal(gameAt('#play/lid/extra'), null)
})

test('every game has a distinct id and both kinds of description', () => {
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length)
  for (const g of GAMES) assert.ok(g.tech && g.blurb && g.plainBlurb, g.id)
})
