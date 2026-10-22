import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARDS, fitsCard, fitsMac, linkGBs, modelBytes, seconds, textureBytes } from './unifiedMemory.ts'

const GiB = 2 ** 30
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('a PCIe 4.0 x16 link carries about 31.5 GB/s each way, and x8 half that', () => {
  near(linkGBs(16), 31.5077, 1e-3)
  near(linkGBs(8), linkGBs(16) / 2)
})

test('copy time is size over speed, in decimal gigabytes', () => {
  near(seconds(31.5e9, 31.5), 1)
  near(seconds(4.58 * GiB, linkGBs(16)), 0.156, 1e-3)
  assert.equal(seconds(0, 31.5), 0)
})

test("llama.cpp's Llama 3.1 8B sizes come back from parameters times bits per weight, within a few percent", () => {
  // The README lists 4.58 GiB for Q4_K_M; 8.03 billion weights at 4.9 bits is close.
  near(modelBytes(8.03, 4.9) / GiB, 4.58, 0.05)
  near(modelBytes(8.03, 16) / GiB, 14.96, 0.05)
})

test('a 4K texture is 33 MB', () => {
  assert.equal(textureBytes(3840, 2160), 33_177_600)
})

test('a card holds only what is smaller than its VRAM', () => {
  assert.equal(fitsCard(7.9 * GiB, CARDS[0].vram), 'fits')
  assert.equal(fitsCard(8 * GiB, CARDS[0].vram), 'no')
  assert.equal(fitsCard(14.96 * GiB, CARDS[1].vram), 'no')
  assert.equal(fitsCard(14.96 * GiB, CARDS[2].vram), 'fits')
})

test('on a 16 GB Mac, up to 12 GB fits, up to 16 is tight, beyond does not', () => {
  const ram = 16 * GiB
  assert.equal(fitsMac(12 * GiB, ram), 'fits')
  assert.equal(fitsMac(12 * GiB + 1, ram), 'tight')
  assert.equal(fitsMac(15.9 * GiB, ram), 'tight')
  assert.equal(fitsMac(16 * GiB, ram), 'no')
})

test('the cards are listed smallest first, and only the 8 GB one is on eight lanes', () => {
  assert.deepEqual(CARDS.map((c) => c.vram / GiB), [8, 12, 24])
  assert.deepEqual(CARDS.map((c) => c.lanes), [8, 16, 16])
})
