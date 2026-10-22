import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOSS, PLAN, crosses, fractionOfMilliwatt, heat, milliwatts, powerRatio, quality, simLink, trend } from './wifi.ts'

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('dBm is logarithmic: 0 dBm is 1 mW, 10 dB is ten times, 3 dB about double', () => {
  near(milliwatts(0), 1)
  near(milliwatts(-30), 0.001)
  near(powerRatio(-40, -50), 10)
  near(powerRatio(-47, -50), 1.995, 0.001)
  near(powerRatio(-80, -50), 0.001)
})

test('quality bands meet at their edges without gaps', () => {
  assert.equal(quality(-30).label, 'excellent')
  assert.equal(quality(-50).label, 'excellent')
  assert.equal(quality(-51).label, 'good')
  assert.equal(quality(-60).label, 'good')
  assert.equal(quality(-75).label, 'fair')
  assert.equal(quality(-76).label, 'weak')
})

test('the meter is clamped at both ends', () => {
  assert.equal(heat(-120), 0)
  assert.equal(heat(-10), 1)
  near(heat(-60), 0.5)
})

test('a move needs 3 dB against the recent average; one noisy dB is not warmer', () => {
  assert.equal(trend([-60, -61, -59], -56), 'warmer')
  assert.equal(trend([-60, -61, -59], -61), 'same')
  assert.equal(trend([-60, -60], -64), 'colder')
  assert.equal(trend([], -40), 'same')
})

test('tiny received powers read as plain fractions of a milliwatt', () => {
  assert.equal(fractionOfMilliwatt(-30), '1,000')
  assert.equal(fractionOfMilliwatt(-60), '1.0 million')
  assert.equal(fractionOfMilliwatt(-96), '4.0 billion')
})

test('segments cross only when they really cross', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 2, y: 2 }
  assert.ok(crosses(a, b, { x: 0, y: 2 }, { x: 2, y: 0 }))
  assert.ok(!crosses(a, b, { x: 3, y: 0 }, { x: 3, y: 5 }))
  assert.ok(!crosses(a, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }))
})

test('in the flat: next to the router is strongest, farther is weaker, and a wall costs its loss', () => {
  const r = PLAN.router
  const close = simLink({ x: r.x + 0.5, y: r.y }, 5, false).rssi
  const far = simLink({ x: r.x + 3, y: r.y }, 5, false).rssi
  assert.ok(close > far)
  // Same distance from the router, one through the brick wall and one through the door gap.
  const plan = { ...PLAN, walls: [{ a: { x: 3, y: 0 }, b: { x: 3, y: 1.6 }, m: 'brick' as const }] }
  const behind = simLink({ x: 4, y: 1.4 }, 5, false, plan)
  const clear = simLink({ x: 4, y: 1.4 }, 5, false, { ...plan, walls: [] })
  assert.equal(clear.rssi - behind.rssi, LOSS.brick)
  assert.equal(behind.walls.length, 1)
})

test('5 GHz loses about 6 dB more than 2.4 GHz, and only 2.4 GHz hears the microwave', () => {
  const p = { x: 9.8, y: 6.6 }
  const lo = simLink(p, 2.4, true)
  const hi = simLink(p, 5, true)
  assert.equal(lo.rssi - hi.rssi, 6)
  assert.ok(lo.noise > -95)
  assert.equal(hi.noise, -95)
  assert.equal(simLink(p, 2.4, false).noise, -95)
})

test('every room of the flat is reachable and the far corner is the weakest spot', () => {
  const rooms = PLAN.rooms.map((r) => simLink(r, 5, false).rssi)
  assert.ok(rooms.every((v) => v < -20 && v > -110), `${rooms}`)
  const store = simLink(PLAN.rooms[4], 5, false).rssi
  assert.equal(store, Math.min(...rooms))
})
