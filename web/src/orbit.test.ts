import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EXPLODE, FOCUS_ZOOM_MAX, LAYER_Z, ZOOM_MAX, ZOOM_MIN, clampTilt, clampZoom, coast, fillZoom, flipped, focusCam, home, isUnder, layerZ, lidPoint, midZ, nearestSpin } from './orbit.ts'
import { D, W } from './layout.ts'
import { PARTS, pickPart } from './parts.ts'

test('tilt stops at straight down and straight up, zoom at its limits', () => {
  assert.equal(clampTilt(-30), 0)
  assert.equal(clampTilt(200), 180)
  assert.equal(clampTilt(77), 77)
  assert.equal(clampZoom(0.1), ZOOM_MIN)
  assert.equal(clampZoom(9), ZOOM_MAX)
  assert.equal(clampZoom(9, FOCUS_ZOOM_MAX), FOCUS_ZOOM_MAX)
})

test('the slider runs from the shut laptop through the usual stack to further apart', () => {
  LAYER_Z.forEach(([closed, open], i) => {
    assert.equal(layerZ(i, 0), closed)
    assert.ok(Math.abs(layerZ(i, DEFAULT_EXPLODE) - open) < 1e-9, `layer ${i} at the default is today's open height`)
    if (i) assert.ok(layerZ(i, 1) > open, 'fully apart goes past the usual stack')
  })
  // Out-of-range input is held at the ends, and the layers never pass each other.
  assert.equal(layerZ(3, 2), layerZ(3, 1))
  assert.equal(layerZ(3, -1), layerZ(3, 0))
  for (const e of [0, 0.3, DEFAULT_EXPLODE, 1]) for (let i = 1; i < LAYER_Z.length; i++) assert.ok(layerZ(i, e) > layerZ(i - 1, e))
  assert.equal(midZ(DEFAULT_EXPLODE), 255 / 2)
})

test('a spin tween takes the short way round', () => {
  assert.equal(nearestSpin(700, -16), 704)
  assert.equal(nearestSpin(-16, -16), -16)
  assert.ok(Math.abs(nearestSpin(170, -170) - 170) <= 180)
})

test('flip turns the stack over and back, even from edge-on', () => {
  const h = home(DEFAULT_EXPLODE)
  const under = flipped(h)
  assert.equal(under.tilt, 122)
  assert.ok(isUnder(under) && !isUnder(h))
  assert.equal(flipped(under).tilt, 58)
  assert.equal(flipped({ ...h, tilt: 90 }).tilt, 122)
  assert.equal(flipped({ ...h, tilt: 100 }).tilt, 58)
})

test('coasting slows down and never reverses', () => {
  const v = coast(1, 16)
  assert.ok(v > 0.9 && v < 1)
  assert.ok(coast(1, 2000) < 0.01 && coast(1, 2000) > 0)
  assert.ok(coast(-1, 100) < 0)
})

test('a close-up zooms a part to a share of the free view', () => {
  assert.equal(fillZoom({ w: 50, h: 100 }, 0.5, 400), 2)
  assert.ok(fillZoom(PARTS.ssd.r, PARTS.ssd.fill, 500) > fillZoom(PARTS.soc.r, PARTS.soc.fill, 500), 'the small NAND gets closer than the chip')
})

test('a close-up from below turns back to the top, where the parts are', () => {
  const c = focusCam({ ...home(0.5), tilt: 130 }, { x: 10, y: 20, z: 30, zoom: 99 }, 1, 2)
  assert.ok(!isUnder(c))
  assert.equal(c.zoom, FOCUS_ZOOM_MAX)
  assert.deepEqual([c.fx, c.fy, c.fz, c.cx, c.cy], [10, 20, 30, 1, 2])
})

test('the tilted lid lifts its back edge and leaves its pivot alone', () => {
  const pivot = lidPoint(D * 0.8, 20)
  assert.ok(Math.abs(pivot.z) < 1e-9 && Math.abs(pivot.y - D * 0.8) < 1e-9)
  const notch = lidPoint(PARTS.camera.r.y, 14)
  assert.ok(notch.z > 50, 'the notch rises toward the viewer')
  assert.ok(notch.y > PARTS.camera.r.y, 'and slides toward the pivot')
  const flat = lidPoint(100, 0)
  assert.ok(flat.y === 100 && flat.z === 0)
})

test('every part fits its layer, and the smallest part under the pointer wins', () => {
  for (const [k, p] of Object.entries(PARTS)) {
    assert.ok(p.r.x >= 0 && p.r.y >= 0 && p.r.x + p.r.w <= W && p.r.y + p.r.h <= D, k)
    assert.ok(p.layer >= 0 && p.layer < LAYER_Z.length, k)
  }
  assert.equal(pickPart(['display', 'soc', 'trackpad']), 'soc')
  assert.equal(pickPart(['display', 'camera']), 'camera')
  assert.equal(pickPart([]), null)
})
