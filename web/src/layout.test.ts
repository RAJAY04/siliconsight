import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIR, D, W, geometry, grid } from './layout.ts'

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
