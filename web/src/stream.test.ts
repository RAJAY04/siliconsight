import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSample } from './useStream.ts'
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
