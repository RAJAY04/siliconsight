import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIR, D, W, geometry, grid, inset, lidLabel, lidTilt, serpentine } from './layout.ts'
import { PARTS, textUnit, type PartKey } from './parts.ts'

test('every drawn part sits inside the case and the SoC stays on its board', () => {
  const g = geometry(AIR)
  for (const r of [g.BOARD, g.PKG, g.DIE, ...g.DRAM, g.NAND, g.WIFI, g.PMU, ...g.CELLS, ...g.KEYS]) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= D, JSON.stringify(r))
  }
  assert.ok(g.PKG.x >= g.BOARD.x && g.PKG.x + g.PKG.w <= g.BOARD.x + g.BOARD.w && g.PKG.y >= g.BOARD.y && g.PKG.y + g.PKG.h <= g.BOARD.y + g.BOARD.h)
  for (const l of g.LANES) assert.ok(l.len > 5, 'lane too short for particles')
})

test('grid keeps tiles near square and never negative, even for big core counts', () => {
  const tiles = grid(40, { x: 0, y: 0, w: 100, h: 50 }, 2)
  assert.equal(tiles.length, 40)
  const { w, h } = tiles[0]
  assert.ok(w / h > 0.5 && w / h < 2, `${w} x ${h}`)
  for (const t of grid(64, { x: 0, y: 0, w: 10, h: 4 }, 3)) assert.ok(t.w >= 0 && t.h >= 0)
})

test('the drawn lid folds with the real one but stays inside a readable range', () => {
  assert.equal(lidTilt(180), 0)
  assert.equal(lidTilt(110), 14)
  assert.ok(lidTilt(100) > lidTilt(120), 'closing the lid folds the drawing further')
  // Nearly closed stops at one readable pose; a shut lid (clamshell) lies flat so the board stays in view.
  for (const deg of [19, 5, 1]) assert.equal(lidTilt(deg), 32)
  for (const deg of [0, 0.5, -10, 250]) assert.equal(lidTilt(deg), 0)
})

test('a shut lid reads as clamshell mode, a nearly closed one says so', () => {
  assert.equal(lidLabel(0), 'Lid closed, using an external display')
  assert.equal(lidLabel(12.4), 'Lid nearly closed, 12°')
  assert.equal(lidLabel(110.6), 'Lid 111°')
})

test('serpentine stays inside its box and draws one leg per count', () => {
  const r = { x: 10, y: 20, w: 30, h: 8 }
  const d = serpentine(r, 6)
  const nums = d.match(/-?[\d.]+/g)!.map(Number)
  assert.equal(d.match(/V/g)!.length, 6)
  assert.ok(nums.every((v) => (v >= r.x && v <= r.x + r.w) || (v >= r.y && v <= r.y + r.h)), d)
  assert.ok(d.endsWith(`V ${r.y}`) || d.endsWith(`V ${r.y + r.h}`))
})

test('inset shrinks evenly and never goes negative', () => {
  assert.deepEqual(inset({ x: 0, y: 0, w: 10, h: 6 }, 2), { x: 2, y: 2, w: 6, h: 2 })
  assert.deepEqual(inset({ x: 0, y: 0, w: 2, h: 2 }, 3), { x: 3, y: 3, w: 0, h: 0 })
})

test('close-up text is larger on parts that open less zoomed in', () => {
  const u = (k: PartKey) => textUnit(k)
  assert.ok(u('battery') > u('trackpad') && u('trackpad') > u('soc') && u('soc') > u('ssd'))
  for (const k of Object.keys(PARTS) as PartKey[]) assert.ok(u(k) > 1 && u(k) < 20, `${k} ${u(k)}`)
})
