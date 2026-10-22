import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytes32, encode, float, graphemes, int, nativeLittleEndian, parseNumber, utf8 } from './bits.ts'

test('parses decimal, hex, binary, NaN and infinity, and rejects junk', () => {
  assert.equal(parseNumber('42'), 42)
  assert.equal(parseNumber(' -7 '), -7)
  assert.equal(parseNumber('0xFF'), 255)
  assert.equal(parseNumber('-0x80'), -128)
  assert.equal(parseNumber('0b1010_0101'), 0xa5)
  assert.equal(parseNumber('0.1'), 0.1)
  assert.equal(parseNumber('.5'), 0.5)
  assert.equal(parseNumber('1e-3'), 0.001)
  assert.ok(Number.isNaN(parseNumber('NaN')))
  assert.equal(parseNumber('-inf'), -Infinity)
  assert.equal(parseNumber('Infinity'), Infinity)
  for (const bad of ['', 'abc', '0b102', '0x', '1.2.3', '12px', '--1']) assert.equal(parseNumber(bad), null, bad)
})

test('two\'s complement wraps the way the hardware does', () => {
  assert.deepEqual(int(-1, 8), { bits: '11111111', unsigned: 255, signed: -1, fits: true, fitsUnsigned: false })
  assert.equal(int(-128, 8).bits, '10000000')
  assert.equal(int(127, 8).bits, '01111111')
  // 127 + 1 overflows int8 to -128; 255 + 1 overflows uint8 to 0.
  assert.equal(int(128, 8).signed, -128)
  assert.equal(int(128, 8).fits, false)
  assert.equal(int(128, 8).fitsUnsigned, true)
  assert.equal(int(256, 8).unsigned, 0)
  assert.equal(int(-129, 8).signed, 127)
  assert.equal(int(-1, 32).unsigned, 0xffffffff)
  assert.equal(int(2 ** 31, 32).signed, -(2 ** 31))
  assert.equal(int(-5, 8).bits, '11111011')
})

test('integers refuse fractions, NaN and infinity rather than inventing a pattern', () => {
  for (const v of [0.5, NaN, Infinity, -Infinity]) {
    const r = int(v, 8)
    assert.equal(r.bits, null)
    assert.equal(r.fits, false)
  }
})

test('float32 fields match IEEE 754, including 0.1 rounding', () => {
  const one = float(1)
  assert.equal(one.bits, '00111111100000000000000000000000')
  assert.equal(one.power, 0)
  const f = float(0.1)
  assert.equal(f.sign, 0)
  assert.equal(f.exponent, 123)
  assert.equal(f.power, -4)
  assert.equal(f.fracBits, '10011001100110011001101')
  assert.equal(f.stored, 0.10000000149011612)
  assert.equal(float(-2).sign, 1)
  assert.equal(float(-2).power, 1)
})

test('float specials: zeros, subnormals, infinity and NaN', () => {
  assert.equal(float(0).kind, 'zero')
  const nz = float(-0)
  assert.equal(nz.kind, 'zero')
  assert.equal(nz.sign, 1)
  assert.equal(float(1e-40).kind, 'subnormal')
  assert.equal(float(1e-40).power, -126)
  assert.equal(float(Infinity).kind, 'infinity')
  assert.equal(float(-Infinity).bits, '11111111100000000000000000000000')
  assert.equal(float(NaN).kind, 'nan')
  assert.equal(float(NaN).power, null)
  // Too big for float32 rounds to infinity, though it is fine in float64.
  assert.equal(float(1e39).kind, 'infinity')
  assert.equal(float(1e39, 64).kind, 'normal')
})

test('float64 shows why 0.1 + 0.2 is not 0.3', () => {
  const a = float(0.1 + 0.2, 64)
  const b = float(0.3, 64)
  assert.equal(a.bits.length, 64)
  assert.notEqual(a.bits, b.bits)
  assert.equal(a.exponent, b.exponent)
  // They differ in the very last bit of the fraction.
  assert.equal(parseInt(a.fracBits.slice(-4), 2) - parseInt(b.fracBits.slice(-4), 2), 1)
})

test('little-endian puts the low byte first', () => {
  assert.deepEqual(bytes32(0x0a0b0c0d), [0x0d, 0x0c, 0x0b, 0x0a])
  assert.deepEqual(bytes32(0x0a0b0c0d, false), [0x0a, 0x0b, 0x0c, 0x0d])
  assert.deepEqual(bytes32(-1), [255, 255, 255, 255])
  assert.deepEqual(bytes32(int(-2, 32).unsigned as number), [0xfe, 0xff, 0xff, 0xff])
  assert.equal(nativeLittleEndian(), true)
})

test('UTF-8 lengths step at each RFC 3629 boundary', () => {
  const len = (cp: number) => utf8(cp).length
  assert.deepEqual([0, 0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff].map(len), [1, 1, 2, 2, 3, 3, 4, 4])
  assert.deepEqual(utf8(0x41), [0x41])
  assert.deepEqual(utf8(0xe9), [0xc3, 0xa9])
  assert.deepEqual(utf8(0x20ac), [0xe2, 0x82, 0xac])
  assert.deepEqual(utf8(0x1f600), [0xf0, 0x9f, 0x98, 0x80])
  // Out of range and lone surrogates become U+FFFD.
  for (const bad of [0xd800, 0xdfff, 0x110000, -1]) assert.deepEqual(utf8(bad), [0xef, 0xbf, 0xbd])
})

test('encode agrees with TextEncoder, surrogate pairs and lone halves included', () => {
  const smile = String.fromCodePoint(0x1f600)
  const samples = ['', 'A', 'café', 'é', smile, 'a' + smile + 'b', '\ud83d', 'x\ude00y', String.fromCodePoint(0x10ffff), String.fromCodePoint(0x1f1ee, 0x1f1f3)]
  for (const s of samples) {
    const ours = encode(s).flatMap((e) => e.bytes)
    assert.deepEqual(ours, [...new TextEncoder().encode(s)], JSON.stringify(s))
  }
  const e = encode('a' + smile)
  assert.equal(e.length, 2)
  assert.equal(e[1].cp, 0x1f600)
  assert.equal(e[1].utf16, 2)
  assert.equal(encode('\ud83d')[0].cp, 0xfffd)
})

test('graphemes count what a person sees as one character', () => {
  assert.equal(graphemes('é'), 1)
  assert.equal(encode('é').length, 2)
  assert.equal(graphemes(String.fromCodePoint(0x1f1ee, 0x1f1f3)), 1)
  assert.equal(graphemes(''), 0)
})
