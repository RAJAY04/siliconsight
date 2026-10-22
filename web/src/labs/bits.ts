// Encoders for the bits and bytes lab: integers, floats, byte order and UTF-8, all as plain data the scene and
// the Try it cards draw.

/** Parses decimal, 0x hex, 0b binary, NaN and Infinity. Returns null for anything else. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/_/g, '')
  if (/^[+-]?nan$/i.test(t)) return NaN
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity
  const m = /^([+-]?)0([xb])([0-9a-f]+)$/i.exec(t)
  if (m) {
    const base = m[2].toLowerCase() === 'x' ? 16 : 2
    if (base === 2 && /[^01]/.test(m[3])) return null
    const v = parseInt(m[3], base)
    return m[1] === '-' ? -v : v
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  return Number(t)
}

/** Binary digits, most significant first, padded to `width`. */
export const bin = (v: number, width: number) => v.toString(2).padStart(width, '0')
export const hex = (v: number, width = 0) => v.toString(16).toUpperCase().padStart(width, '0')

/**
 * An integer stored in a `bits`-wide register: its bit pattern and what that pattern means read as unsigned and
 * as two's complement. Values that don't fit wrap around, exactly as the hardware does, and `fits` says so.
 */
export function int(v: number, bits: 8 | 16 | 32) {
  const size = 2 ** bits
  const whole = Number.isFinite(v) && Number.isInteger(v)
  const pattern = whole ? ((v % size) + size) % size : null
  const signed = pattern == null ? null : pattern >= size / 2 ? pattern - size : pattern
  return {
    bits: pattern == null ? null : bin(pattern, bits),
    unsigned: pattern,
    signed,
    fits: whole && v >= -size / 2 && v < size / 2,
    fitsUnsigned: whole && v >= 0 && v < size,
  }
}

export type FloatKind = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan'

/** The IEEE 754 binary32 or binary64 fields of a number, after rounding to that format. */
export function float(v: number, width: 32 | 64 = 32) {
  const dv = new DataView(new ArrayBuffer(8))
  let bits: string
  if (width === 32) {
    dv.setFloat32(0, v)
    bits = bin(dv.getUint32(0), 32)
  } else {
    dv.setFloat64(0, v)
    bits = bin(dv.getUint32(0), 32) + bin(dv.getUint32(4), 32)
  }
  const e = width === 32 ? 8 : 11
  const sign = bits[0] === '1' ? 1 : 0
  const expBits = bits.slice(1, 1 + e)
  const fracBits = bits.slice(1 + e)
  const exponent = parseInt(expBits, 2)
  const bias = 2 ** (e - 1) - 1
  const fracZero = !fracBits.includes('1')
  const kind: FloatKind = exponent === 0 ? (fracZero ? 'zero' : 'subnormal') : exponent === 2 ** e - 1 ? (fracZero ? 'infinity' : 'nan') : 'normal'
  return {
    bits,
    sign,
    expBits,
    fracBits,
    exponent,
    bias,
    /** The power of two the fraction is scaled by; null for infinity and NaN. */
    power: kind === 'normal' ? exponent - bias : kind === 'zero' || kind === 'subnormal' ? 1 - bias : null,
    kind,
    /** What actually got stored, which is usually not quite what was asked for. */
    stored: width === 32 ? Math.fround(v) : v,
  }
}

/** The bytes of an unsigned 32-bit pattern in memory order, lowest address first. Apple Silicon is little-endian. */
export function bytes32(pattern: number, little = true): number[] {
  const dv = new DataView(new ArrayBuffer(4))
  dv.setUint32(0, pattern >>> 0, little)
  return [0, 1, 2, 3].map((i) => dv.getUint8(i))
}

/** What this JavaScript engine's typed arrays use, which is the CPU's native order. */
export const nativeLittleEndian = () => new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

const REPLACEMENT = 0xfffd

/** UTF-8 for one code point, per RFC 3629. Lone surrogates can't be encoded and become U+FFFD, as TextEncoder does. */
export function utf8(cp: number): number[] {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = REPLACEMENT
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
}

/** The 1 to 4 byte templates; x marks the bits the code point fills in. */
export const UTF8_TEMPLATES = [['0xxxxxxx'], ['110xxxxx', '10xxxxxx'], ['1110xxxx', '10xxxxxx', '10xxxxxx'], ['11110xxx', '10xxxxxx', '10xxxxxx', '10xxxxxx']]

export type Encoded = { ch: string; cp: number; bytes: number[]; utf16: number }

/** Each code point of a string with its UTF-8 bytes. A surrogate pair is one code point; a lone half is U+FFFD. */
export function encode(text: string): Encoded[] {
  const out: Encoded[] = []
  for (const ch of text) {
    const raw = ch.codePointAt(0) as number
    const lone = raw >= 0xd800 && raw <= 0xdfff
    out.push({ ch, cp: lone ? REPLACEMENT : raw, bytes: utf8(raw), utf16: ch.length })
  }
  return out
}

/** Characters as a person counts them: grapheme clusters, so a flag or an accent built from parts counts once. */
export function graphemes(text: string): number {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length
}

export const codePoint = (cp: number) => 'U+' + hex(cp, 4)
