import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clusterLoad, pickedUp, qosOfPriority, simulate, type SimConfig, type SimThread } from './sched.ts'

const M5: SimConfig = { p: 4, e: 6, pMHz: 4464, eMHz: 3048, eBgMHz: 1524 }
const th = (id: number, qos: SimThread['qos'], work: number, arrive = 0): SimThread => ({ id, qos, work, arrive })
const coresOf = (r: ReturnType<typeof simulate>, id: number) => new Set(r.frames.flatMap((f) => f.cores.flatMap((x, c) => (x === id ? [c] : []))))

test('background work never touches a P core, even when every P core is idle', () => {
  const r = simulate([th(1, 'background', 30), th(2, 'background', 30)], M5)
  for (const id of [1, 2]) for (const c of coresOf(r, id)) assert.ok(c >= M5.p, `thread ${id} ran on P core ${c}`)
  assert.equal(r.threads[0].onP, 0)
})

test('background waits for an E core rather than spill onto an idle P core', () => {
  const cfg = { ...M5, p: 2, e: 1 }
  const r = simulate([th(1, 'background', 10), th(2, 'background', 10)], cfg)
  assert.ok(r.threads.every((t) => t.onP === 0))
  assert.ok(r.threads.some((t) => t.waited > 0))
  assert.ok(r.frames.some((f) => f.ready.length > 0 && f.cores.slice(0, cfg.p).every((x) => x == null)))
})

test('higher QoS fills the P cores first and spills onto E only when they are full', () => {
  const r = simulate([1, 2, 3, 4, 5, 6].map((i) => th(i, 'initiated', 40)), M5)
  const first = r.frames[0]
  assert.deepEqual(first.cores.slice(0, 4).sort(), [1, 2, 3, 4])
  assert.equal(first.cores.filter((x) => x != null).length, 6)
  assert.ok(first.eFast, 'spilled high-QoS work runs the E cluster at its top clock')
})

test('the E cluster clocks down when it runs only background work, so the same work takes longer', () => {
  const bg = simulate([th(1, 'background', 50)], M5).threads[0]
  const util = simulate([th(1, 'utility', 50), ...[2, 3, 4, 5].map((i) => th(i, 'ui', 200))], M5).threads[0]
  assert.equal(util.onP, 0, 'utility spilled onto E because four UI threads hold the P cores')
  assert.ok(bg.finish! > util.finish!, `background ${bg.finish} vs utility ${util.finish}`)
  assert.ok(Math.abs(bg.finish! - Math.ceil(50 * M5.pMHz / M5.eBgMHz)) <= 1)
})

test('a higher-priority arrival preempts at once, and the preempted thread finishes later', () => {
  const cfg = { ...M5, p: 1, e: 0 }
  const r = simulate([th(1, 'utility', 30), th(2, 'ui', 10, 5)], cfg)
  assert.equal(r.frames[5].cores[0], 2)
  const [low, high] = r.threads
  assert.equal(high.waited, 0)
  assert.equal(high.finish, 15)
  assert.equal(low.finish, 40)
  assert.equal(r.switches, 2)
})

test('equal threads on one core take turns every time slice', () => {
  const r = simulate([th(1, 'default', 30), th(2, 'default', 30)], { ...M5, p: 1, e: 0 })
  assert.equal(r.frames[9].cores[0], 1)
  assert.equal(r.frames[10].cores[0], 2)
  assert.equal(r.frames[20].cores[0], 1)
  assert.equal(r.end, 60)
  assert.equal(r.switches, 5)
})

test('a lone thread keeps its core across slices instead of hopping', () => {
  const r = simulate([th(1, 'background', 20)], M5)
  assert.equal(coresOf(r, 1).size, 1)
  assert.equal(r.switches, 0)
})

test('no work is lost or invented, and the limit stops a run that cannot finish', () => {
  const list = [th(1, 'ui', 25), th(2, 'utility', 70, 3), th(3, 'background', 15, 8), th(4, 'default', 40)]
  const r = simulate(list, { ...M5, p: 1, e: 1 })
  for (const t of r.threads) {
    const src = list.find((x) => x.id === t.id)!
    assert.equal(t.finish! - src.arrive, t.waited + t.onP + t.onE)
  }
  const stuck = simulate([th(1, 'background', 50)], { ...M5, e: 0 }, 100)
  assert.equal(stuck.end, 100)
  assert.equal(stuck.threads[0].finish, null)
  assert.equal(stuck.threads[0].waited, 100)
})

test('base priorities map to the right QoS band', () => {
  assert.equal(qosOfPriority(47), 'ui')
  assert.equal(qosOfPriority(46), 'ui')
  assert.equal(qosOfPriority(37), 'initiated')
  assert.equal(qosOfPriority(31), 'default')
  assert.equal(qosOfPriority(25), 'default')
  assert.equal(qosOfPriority(20), 'utility')
  assert.equal(qosOfPriority(4), 'background')
  assert.equal(qosOfPriority(0), 'background')
  assert.equal(qosOfPriority(63), 'above')
  assert.equal(qosOfPriority(97), 'above')
})

test('a spin is credited to the cluster whose load rose by a real share of a core', () => {
  const idle = [{ kind: 'E' as const, usage: 0.2 }, { kind: 'E' as const, usage: 0.1 }, { kind: 'P' as const, usage: 0.05 }, { kind: 'P' as const, usage: 0 }]
  const onP = idle.map((c, i) => (i === 3 ? { ...c, usage: 1 } : c))
  assert.equal(pickedUp(idle, onP), 'P')
  // The same core's worth spread thinly over the E cluster still counts.
  assert.equal(pickedUp(idle, idle.map((c) => (c.kind === 'E' ? { ...c, usage: c.usage + 0.5 } : c))), 'E')
  assert.equal(pickedUp(idle, idle.map((c) => ({ ...c, usage: c.usage + 0.1 }))), null)
  assert.equal(pickedUp(idle, idle.map((c) => ({ ...c, usage: c.usage + 0.4 }))), 'both')
  assert.deepEqual(clusterLoad(idle), { P: 0.025, E: 0.15000000000000002 })
  assert.deepEqual(clusterLoad([]), { P: null, E: null })
})
