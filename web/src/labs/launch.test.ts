import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchLaunch } from './launch.ts'

const snap = (t: number, mem: [number, string, number][], pageins: number | null | 'none', readBps = 0, cpu: [number, string][] = []) => ({
  t,
  topMem: mem.map(([pid, name, bytes]) => ({ pid, name, bytes })),
  topCpu: cpu.map(([pid, name]) => ({ pid, name, cpu: 50 })),
  disk: { readBps, writeBps: 0 },
  paging: pageins === 'none' ? null : { pageBytes: 16384, compressorStoredBytes: 0, faults: null, zeroFills: null, pageins, pageouts: null, compressions: null, decompressions: null, swapins: null, swapouts: null },
})

test('a new process in the memory list is an arrival; ones already there are not, even if they grow', () => {
  const start = snap(0, [[10, 'Finder', 100]], 0, 0, [[20, 'Terminal']])
  const w = watchLaunch(start, [snap(1000, [[10, 'Finder', 900], [30, 'Photos', 200]], 5), snap(2000, [[30, 'Photos', 500], [20, 'Terminal', 800]], 0)])
  assert.deepEqual(w.arrivals, [{ pid: 30, name: 'Photos', bytes: 500 }])
  assert.equal(w.seconds, 2)
})

test('an app quit and reopened under the same name counts again, because it is a new process', () => {
  const w = watchLaunch(snap(0, [[10, 'Music', 100]], 0), [snap(1000, [[11, 'Music', 50]], 0)])
  assert.deepEqual(w.arrivals.map((a) => a.pid), [11])
})

test('page-ins add up in bytes and the peak is the biggest one-second rate', () => {
  const w = watchLaunch(snap(0, [], 0), [snap(1000, [], 100, 5e6), snap(2000, [], 400, 2e6), snap(3000, [], null, 1e6)])
  assert.equal(w.pageinBytes, 500 * 16384)
  assert.equal(w.peakPageins, 400)
  assert.equal(w.peakReadBps, 5e6)
})

test('without paging counters the totals are null, not zero', () => {
  const w = watchLaunch(snap(0, [], 'none'), [snap(1000, [], 'none'), snap(2000, [], null)])
  assert.equal(w.pageinBytes, null)
  assert.equal(w.peakPageins, null)
})

test('nothing watched yet', () => {
  const w = watchLaunch(snap(5000, [], 0), [])
  assert.equal(w.seconds, 0)
  assert.deepEqual(w.arrivals, [])
})
