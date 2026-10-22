import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXIT, ITER, STREAMS, cyclesOf, ooo, predictTaken, runLoop, runPredictor, schedule, seeded, train } from './pipeline.ts'

test('the loop sums the array and stops when the count reaches zero', () => {
  const tr = runLoop([5, 3, 8, 2])
  assert.equal(tr.length, 16)
  assert.equal(tr.at(-1)!.regs.x8, 18)
  assert.equal(tr.at(-1)!.regs.x0, 0x1000 + 32)
  assert.ok(tr.at(-1)!.regs.z)
  assert.ok(tr.slice(0, -1).every((s) => s.pc !== 3 || !s.regs.z || s === tr.at(-1)))
  assert.deepEqual(runLoop([]), [])
})

test('serial takes five cycles each; a pipeline overlaps them', () => {
  assert.equal(cyclesOf(schedule(ITER, 'serial')), 20)
  assert.equal(cyclesOf(schedule(ITER, 'pipelined', false)), 8)
})

test('a use right after a load stalls one cycle, and ALU results forward without a stall', () => {
  const rows = schedule(ITER, 'pipelined')
  assert.equal(cyclesOf(rows), 9)
  assert.equal(rows[1].cells.filter((c) => c === 'stall').length, 1)
  // subs feeds b.ne straight away.
  assert.equal(rows[3].cells.indexOf('X'), rows[2].cells.indexOf('X') + 1)
  // Never two instructions in the same stage in the same cycle.
  for (let c = 0; c < rows[0].cells.length; c++) {
    const here = rows.map((r) => r.cells[c]).filter((s) => s && s !== 'stall')
    assert.equal(new Set(here).size, here.length, `cycle ${c}`)
  }
})

test('a wrong guess flushes the two instructions behind the branch and costs two cycles', () => {
  const rows = schedule(EXIT, 'pipelined')
  const flushed = rows.filter((r) => r.flushed)
  assert.equal(flushed.length, 2)
  for (const r of flushed) assert.ok(!r.cells.includes('X') && !r.cells.includes('W'))
  const right = schedule(EXIT.filter((r) => !r.wrong).map((r) => ({ ...r, mispredicted: false })), 'pipelined')
  assert.equal(cyclesOf(rows) - cyclesOf(right), 2)
  // Fetch restarts the cycle after the branch executes.
  assert.equal(rows[6].cells.indexOf('F'), rows[3].cells.indexOf('X') + 1)
})

test('the out-of-order core retires in order, never before inputs are ready, and runs a trip a cycle', () => {
  const { uops, cycles } = ooo({ iters: 8 })
  const ret = uops.map((u) => u.retire!)
  assert.ok(ret.every((r, i) => r != null && (i === 0 || r >= ret[i - 1])))
  for (const u of uops) assert.ok(u.issue! > u.dec && u.done! > u.issue! && u.retire! >= u.done!)
  const adds = uops.filter((u) => u.op === 'add')
  for (let i = 1; i < adds.length; i++) assert.ok(adds[i].issue! >= adds[i - 1].done!)
  // One taken branch per cycle caps decode at one trip, four instructions, per cycle.
  for (let c = 0; c < cycles; c++) assert.ok(uops.filter((u) => u.dec === c && u.op !== 'mov' && u.op !== 'ret').length <= 4)
  assert.ok(cycles < 8 * 2 + 4)
})

test('a slow load lets younger loads run, holds up retirement, and fills the buffer', () => {
  const rob = 24
  const { uops } = ooo({ iters: 8, slowIter: 1, slowLat: 20, rob })
  const slow = uops.find((u) => u.op === 'ldr' && u.iter === 1)!
  const later = uops.find((u) => u.op === 'ldr' && u.iter === 2)!
  assert.ok(later.done! < slow.done!, 'younger load finishes first')
  assert.ok(uops.filter((u) => u.n > slow.n).every((u) => u.retire! >= slow.done!))
  for (let c = 0; c < 40; c++) assert.ok(uops.filter((u) => u.dec <= c && (u.retire == null || u.retire > c)).length <= rob)
})

test('a mispredicted exit throws away the wrong path and nothing from it retires', () => {
  const { uops } = ooo({ iters: 4, mispredictLast: true })
  const wrong = uops.filter((u) => u.wrong)
  assert.ok(wrong.length >= 4)
  assert.ok(wrong.every((u) => u.flushed != null && u.retire == null))
  const br = uops.find((u) => u.op === 'b.ne' && u.iter === 3 && !u.wrong)!
  assert.ok(wrong.every((u) => u.flushed === br.done))
  const exit = uops.filter((u) => u.op === 'mov' || u.op === 'ret')
  assert.equal(exit.length, 2)
  assert.ok(exit.every((u) => u.dec >= br.done! && u.retire != null))
})

test('the 2-bit counter saturates and needs two misses to change its mind', () => {
  assert.equal(train(3, true), 3)
  assert.equal(train(0, false), 0)
  assert.ok(predictTaken(train(3, false)))
  assert.ok(!predictTaken(train(train(3, false), false)))
})

test('the counter learns a loop but cannot learn every third or random data', () => {
  const r = seeded(3)
  const n = 600
  const acc = (id: string) => {
    const s = STREAMS.find((x) => x.id === id)!.gen(n, r)
    return runPredictor(s).right / n
  }
  const loop = acc('loop')
  assert.ok(Math.abs(loop - 5 / 6) < 0.01, `${loop}`)
  assert.ok(acc('sorted') > 0.99)
  const rnd = acc('random')
  assert.ok(rnd > 0.4 && rnd < 0.6, `${rnd}`)
  // N N T: the counter sits low and misses every taken one.
  assert.ok(Math.abs(acc('pattern') - 2 / 3) < 0.01)
})

test('streams are the asked length and repeat for the same seed', () => {
  for (const s of STREAMS) {
    assert.equal(s.gen(24, seeded(1)).length, 24)
    assert.deepEqual(s.gen(24, seeded(9)), s.gen(24, seeded(9)))
  }
})
