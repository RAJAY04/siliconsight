import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFast, isSample } from './useStream.ts'
import { demoSample } from './demo.ts'

test('a sample missing an object every view reads is rejected, a full one passes', () => {
  const good = demoSample(
    { start: 0, e: [0.1], p: [0.1], burst: 0, burstLevel: 0, app: 5e9, wired: 2e9, compressed: 5e8, gpu: 0, bw: 6, swap: 0, temp: 40, diskR: 0, diskW: 0 },
    1000,
  )
  assert.equal(isSample(good), true)
  assert.equal(isSample({ ...good, cpu: { ...good.cpu, cores: null } }), false)
  assert.equal(isSample({ ...good, memory: undefined }), false)
  assert.equal(isSample(null), false)
  assert.equal(isSample({ type: 'hello' }), false)
})

test('a sample with a null entry in any list is rejected', () => {
  const good = demoSample(
    { start: 0, e: [0.1], p: [0.1], burst: 0, burstLevel: 0, app: 5e9, wired: 2e9, compressed: 5e8, gpu: 0, bw: 6, swap: 0, temp: 40, diskR: 0, diskW: 0 },
    1000,
  )
  assert.equal(isSample({ ...good, topCpu: [null] }), false)
  assert.equal(isSample({ ...good, topMem: [7] }), false)
  assert.equal(isSample({ ...good, fans: [null] }), false)
  assert.equal(isSample({ ...good, cpu: { ...good.cpu, cores: [null] } }), false)
  assert.equal(isSample({ ...good, llm: { runtime: 'ollama', models: [null], tokensPerSec: null } }), false)
  assert.equal(isSample({ ...good, llm: { runtime: 'ollama', models: 'x', tokensPerSec: null } }), false)
})

const base = () =>
  demoSample({ start: 0, e: [0.1], p: [0.1], burst: 0, burstLevel: 0, app: 5e9, wired: 2e9, compressed: 5e8, gpu: 0, bw: 6, swap: 0, temp: 40, diskR: 0, diskW: 0 }, 1000)

test('sensors are optional for older readers, but a non-object sensors field is rejected', () => {
  const { sensors, ...old } = base()
  assert.ok(sensors)
  assert.equal(isSample(old), true)
  assert.equal(isSample({ ...old, sensors: null }), true)
  assert.equal(isSample({ ...old, sensors: 'on' }), false)
  assert.equal(isSample({ ...old, sensors: 3 }), false)
})

test('fast messages: lifted, unavailable and moving pass; anything the canvas would choke on is dropped', () => {
  const f = { type: 'fast', t: 1, lidAngleDeg: 112.5, fingers: [{ id: 1, x: 0.4, y: 0.6, size: 0.3 }] }
  assert.equal(isFast(f), true)
  assert.equal(isFast({ ...f, fingers: [] }), true)
  assert.equal(isFast({ ...f, fingers: null, lidAngleDeg: null }), true)
  assert.equal(isFast({ ...f, lidAngleDeg: '112' }), false)
  assert.equal(isFast({ ...f, lidAngleDeg: NaN }), false)
  assert.equal(isFast({ ...f, t: null }), false)
  assert.equal(isFast({ ...f, fingers: {} }), false)
  assert.equal(isFast({ ...f, fingers: [null] }), false)
  assert.equal(isFast({ ...f, fingers: [{ id: 1, x: null, y: 0.6, size: 0.3 }] }), false)
  assert.equal(isFast({ ...f, fingers: [{ id: 1, x: 0.4, y: 0.6 }] }), false)
  assert.equal(isFast({ ...f, type: 'sample' }), false)
  assert.equal(isFast(null), false)
})
