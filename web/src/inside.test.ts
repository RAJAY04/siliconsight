import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GOP, busy, frameRefs, lidPoint, mediaOf, motionField, project, screenFacing, type View } from './inside.ts'
import type { Sample } from './types.ts'

test('media traffic: missing, negative and malformed fields read as not available, never as idle', () => {
  assert.deepEqual(mediaOf({} as Sample), { decodeGBs: null, encodeGBs: null, scalerGBs: null, ispGBs: null })
  const m = mediaOf({ media: { decodeGBs: 2.4, encodeGBs: -1, scalerGBs: 'x', ispGBs: 0 } } as unknown as Sample)
  assert.deepEqual(m, { decodeGBs: 2.4, encodeGBs: null, scalerGBs: null, ispGBs: 0 })
  assert.equal(busy(m.decodeGBs), true)
  assert.equal(busy(m.ispGBs), false)
  assert.equal(busy(m.encodeGBs), null)
  // The decoder's idle floor (a few MB/s from the histogram's lowest bin) is not activity.
  assert.equal(busy(0.002), false)
})

test('frame references: I stands alone, P looks back to an anchor, B looks both ways', () => {
  assert.equal(GOP[0], 'I')
  assert.deepEqual(frameRefs(0), [])
  assert.deepEqual(frameRefs(3), [0])
  assert.deepEqual(frameRefs(6), [3])
  assert.deepEqual(frameRefs(1), [0, 3])
  assert.deepEqual(frameRefs(2), [0, 3])
  // Trailing B frames reach into the next group's I frame.
  assert.deepEqual(frameRefs(GOP.length - 1), [9, GOP.length])
  for (let i = 0; i < GOP.length; i++) for (const r of frameRefs(i)) assert.notEqual(GOP[r] ?? 'I', 'B', `frame ${i} references a B frame`)
})

test('motion field: only blocks under the ball move, and they point back to where it came from', () => {
  const { ball, blocks } = motionField(2, 16, 9)
  const prev = motionField(2 - 0.15, 16, 9).ball
  assert.ok(blocks.length > 0 && blocks.length < 16 * 9 / 4, `${blocks.length} moving blocks`)
  for (const b of blocks) {
    assert.ok(Math.hypot(b.col + 0.5 - ball[0], b.row + 0.5 - ball[1]) < 2, 'a block far from the ball moved')
    assert.ok(Math.abs(ball[0] + b.dx - prev[0]) < 1e-9 && Math.abs(ball[1] + b.dy - prev[1]) < 1e-9)
  }
  for (let t = 0; t < 20; t += 0.7) {
    const [x, y] = motionField(t, 16, 9).ball
    assert.ok(x >= 1.29 && x <= 14.71 && y >= 1.29 && y <= 7.71, `ball left the frame at t=${t}`)
  }
})

const view: View = { yaw: -0.4, pitch: 0.5, scale: 1.4, cx: 380, cy: 300, dist: 1600 }

test('lid geometry follows the angle: closed lies on the base, open stands above the hinge', () => {
  const closed = lidPoint(0, 215, 0)
  assert.ok(Math.abs(closed[1] - 107.5) < 1e-9 && Math.abs(closed[2] - 11.3) < 1e-9)
  const upright = lidPoint(0, 215, 90)
  assert.ok(Math.abs(upright[1] + 107.5) < 1e-9 && Math.abs(upright[2] - 226.3) < 1e-9)
  // On screen, opening the lid further raises the camera until the lid passes upright.
  const camY = (a: number) => project(lidPoint(0, 211, a), view)[1]
  assert.ok(camY(60) > camY(90))
  assert.ok(screenFacing(108, view))
  assert.ok(!screenFacing(0, view))
  // The viewer sits front-left: the left front corner is nearer than the right one.
  assert.ok(project([-152, 107, 0], view)[2] > project([152, 107, 0], view)[2])
})
