import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MTU, TLS_OVERHEAD, TLS_RECORD, expectedTries, lossCeiling, packetsPerSecond, plan, seeded, send } from './packets.ts'

test('MSS is the MTU minus IP and TCP headers', () => {
  assert.equal(plan(1).mss, 1460)
  assert.equal(plan(1, 6).mss, 1440)
})

test('an empty message sends nothing', () => {
  const p = plan(0)
  assert.deepEqual([p.packets, p.records, p.wireBytes, p.efficiency, p.last], [0, 0, 0, 0, 0])
  assert.equal(plan(-5).packets, 0)
})

test('a message splits at exact MSS boundaries once the TLS overhead is counted', () => {
  // 1438 + 22 bytes of TLS = 1460: exactly one full packet.
  const one = plan(1460 - TLS_OVERHEAD)
  assert.equal(one.packets, 1)
  assert.equal(one.last, 1460)
  const two = plan(1460 - TLS_OVERHEAD + 1)
  assert.equal(two.packets, 2)
  assert.equal(two.last, 1)
})

test('every TLS record adds its overhead, and a new record starts one byte past 16 KB', () => {
  assert.equal(plan(TLS_RECORD).records, 1)
  assert.equal(plan(TLS_RECORD + 1).records, 2)
  assert.equal(plan(TLS_RECORD + 1).tlsBytes, 2 * TLS_OVERHEAD)
})

test('bytes add up: payload, TLS and headers make the wire total', () => {
  for (const m of [1, 1000, 1460, 50_000, 1_000_000, 10_000_000]) {
    for (const ip of [4, 6] as const) {
      const p = plan(m, ip)
      assert.equal((p.packets - 1) * p.mss + p.last, m + p.tlsBytes)
      assert.ok(p.last > 0 && p.last <= p.mss)
      assert.equal(p.wireBytes, m + p.tlsBytes + p.headerBytes)
      // A full frame on Ethernet is the MTU plus the Ethernet header and checksum.
      assert.equal(p.headerBytes / p.packets + p.mss, MTU + 18)
    }
  }
})

test('small messages waste more of the wire, IPv6 a little more than IPv4', () => {
  assert.ok(plan(100).efficiency < 0.6)
  assert.ok(plan(1_000_000).efficiency > 0.95)
  assert.ok(plan(1_000_000, 6).efficiency < plan(1_000_000, 4).efficiency)
})

test('without loss each packet goes once; with loss the tries match the expectation', () => {
  assert.deepEqual(send(1000, 0, seeded(1)), { tries: 1000, lost: 0 })
  const r = send(20000, 0.1, seeded(42))
  assert.equal(r.tries - r.lost, 20000)
  assert.ok(Math.abs(r.tries / 20000 - expectedTries(0.1)) < 0.02, `${r.tries}`)
  // A link that loses everything still stops.
  assert.deepEqual(send(3, 1, seeded(1), 5), { tries: 15, lost: 15 })
  assert.equal(expectedTries(1), Infinity)
})

test('the loss ceiling falls with the square root of loss and with round-trip time', () => {
  assert.equal(lossCeiling(0, 30), null)
  assert.equal(lossCeiling(0.01, 0), null)
  const a = lossCeiling(0.01, 50) as number
  // 1.2 / 0.1 = 12 segments of 1460 bytes per 50 ms.
  assert.ok(Math.abs(a - (12 * 1460 * 8) / 0.05) < 1e-6)
  assert.ok(Math.abs((lossCeiling(0.04, 50) as number) - a / 2) < 1e-6)
  assert.ok(Math.abs((lossCeiling(0.01, 100) as number) - a / 2) < 1e-6)
})

test('packet rate is n/a for missing or bad readings, never 0', () => {
  assert.equal(packetsPerSecond(null), null)
  assert.equal(packetsPerSecond(NaN), null)
  assert.equal(packetsPerSecond(-1), null)
  assert.equal(packetsPerSecond(1_500_000), 1000)
})

test('the seeded source repeats and stays in [0, 1)', () => {
  const a = seeded(7)
  const b = seeded(7)
  for (let i = 0; i < 1000; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
})
