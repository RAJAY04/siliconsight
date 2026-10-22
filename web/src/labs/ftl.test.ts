import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WEAR_GAP, amplification, apply, collect, fold, liveIn, makeDisk, makeFtl, replay, trim, viewOf, write, type FileOp, type Ftl } from './ftl.ts'

const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)

/** The map and the pages must always agree: every mapped page is live and holds that logical page, and nothing else is live. */
function consistent(f: Ftl) {
  const mapped = new Set<number>()
  f.map.forEach((ppn, lpn) => {
    if (ppn == null) return
    assert.equal(f.pages[ppn].state, 'live')
    assert.equal(f.pages[ppn].lpn, lpn)
    mapped.add(ppn)
  })
  f.pages.forEach((p, i) => assert.equal(p.state === 'live', mapped.has(i), `page ${i}`))
  assert.equal(f.programs, f.hostWrites + f.gcCopies)
}

test('a first write costs one flash write, and an overwrite leaves the old copy stale', () => {
  const f = makeFtl(4, 4, 8)
  write(f, 3)
  assert.equal(amplification(f), 1)
  const first = f.map[3]!
  write(f, 3)
  assert.equal(f.pages[first].state, 'stale')
  assert.notEqual(f.map[3], first)
  consistent(f)
})

test('amplification is null before any write, not 0 or 1', () => {
  assert.equal(amplification(makeFtl(4, 4, 8)), null)
})

test('garbage collection moves live pages out and erases the block, keeping a spare erased block', () => {
  const f = makeFtl(4, 4, 8)
  for (let i = 0; i < 8; i++) write(f, i)
  // Block 0 and 1 are full; overwrite most of block 0 so it becomes the cheap victim.
  for (const l of [0, 1, 2]) write(f, l)
  for (let n = 0; n < 6; n++) write(f, 4 + (n % 4))
  consistent(f)
  assert.ok(f.erases.some((e) => e > 0), 'something was erased')
  assert.ok(f.gcCopies > 0 || f.erases.reduce((a, b) => a + b) > 0)
  for (let l = 0; l < 8; l++) assert.notEqual(f.map[l], null, `logical ${l} survived`)
})

test('a long random workload never loses data and the map stays consistent', () => {
  const r = seeded(11)
  const f = makeFtl(8, 8, 40)
  for (let i = 0; i < 3000; i++) write(f, Math.floor(r() * 40))
  consistent(f)
  assert.equal(f.map.filter((x) => x != null).length, 40)
  assert.ok(amplification(f)! > 1, 'a full disk under random writes amplifies')
})

test('wear levelling keeps erase counts close under a hot spot', () => {
  const f = makeFtl(8, 8, 40)
  for (let l = 0; l < 40; l++) write(f, l)
  // Only two logical pages ever change.
  for (let i = 0; i < 2000; i++) write(f, i % 2)
  consistent(f)
  assert.ok(Math.max(...f.erases) - Math.min(...f.erases) <= WEAR_GAP + 2, `erases ${f.erases}`)
})

test('trim drops a page so collection never copies it', () => {
  const f = makeFtl(4, 4, 8)
  for (let i = 0; i < 4; i++) write(f, i)
  for (let i = 0; i < 4; i++) trim(f, i)
  assert.equal(liveIn(f, 0), 0)
  const copies = f.gcCopies
  for (let i = 0; i < 4; i++) write(f, 4 + i)
  collect(f)
  assert.equal(f.gcCopies, copies)
  consistent(f)
})

test('refuses a disk with no room for collection to work', () => {
  assert.throws(() => makeFtl(4, 4, 12))
})

test('file operations refuse what cannot happen and change nothing', () => {
  const d = makeDisk(4, 4, 8, true)
  assert.equal(apply(d, { op: 'write', name: 'a', pages: 9 }), false)
  assert.equal(apply(d, { op: 'rewrite', name: 'nope' }), false)
  assert.equal(apply(d, { op: 'write', name: 'a', pages: 3 }), true)
  assert.equal(apply(d, { op: 'write', name: 'a', pages: 1 }), false)
  assert.equal(d.ftl.hostWrites, 3)
  assert.equal(d.freeLpns.length, 5)
})

test('deleting with TRIM off leaves the pages live on the SSD; with TRIM on they go stale', () => {
  for (const useTrim of [false, true]) {
    const d = makeDisk(4, 4, 8, useTrim)
    apply(d, { op: 'write', name: 'a', pages: 4 })
    apply(d, { op: 'delete', name: 'a' })
    assert.equal(d.ftl.map.filter((x) => x != null).length, useTrim ? 0 : 4)
    assert.equal(d.freeLpns.length, 8)
  }
})

test('the same churn with deletes amplifies more without TRIM', () => {
  const r = seeded(5)
  const ops: FileOp[] = []
  let n = 0
  const names: string[] = []
  for (let i = 0; i < 400; i++) {
    if (names.length > 3 && r() < 0.5) ops.push({ op: 'delete', name: names.splice(Math.floor(r() * names.length), 1)[0] })
    else if (names.length && r() < 0.3) ops.push({ op: 'rewrite', name: names[Math.floor(r() * names.length)] })
    else {
      const name = `f${n++}`
      names.push(name)
      ops.push({ op: 'write', name, pages: 2 + Math.floor(r() * 4) })
    }
  }
  const on = replay(8, 8, 40, true, ops)
  const off = replay(8, 8, 40, false, ops)
  consistent(on.ftl)
  consistent(off.ftl)
  assert.equal(on.ftl.hostWrites, off.ftl.hostWrites)
  assert.ok(amplification(off.ftl)! > amplification(on.ftl)!, `${amplification(off.ftl)} vs ${amplification(on.ftl)}`)
})

test('folding the whole event log from an empty disk rebuilds the final state', () => {
  const r = seeded(3)
  const f = makeFtl(6, 4, 14)
  const empty = viewOf(f)
  for (let i = 0; i < 500; i++) (r() < 0.1 ? trim : write)(f, Math.floor(r() * 14))
  const v = fold(empty, f.log, f.log.length, f.perBlock)
  assert.deepEqual(v, viewOf(f))
  // A partial fold never shows more host writes than were made by then.
  assert.ok(fold(empty, f.log, 100, f.perBlock).hostWrites <= 100)
})
