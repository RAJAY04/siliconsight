import { useState } from 'react'
import { bytes, memGB } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, lerp, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { bin, bytes32, codePoint, encode, float, graphemes, hex, int, nativeLittleEndian, parseNumber, utf8 } from './bits.ts'
import './Bits.css'

// One scene per step, each drawn in a 960 x 450 viewBox. Every scene draws a sensible still frame at the end of
// its step, which is where it rests under reduced motion.

const SMILE = 0x1f600
const emoji = String.fromCodePoint(SMILE)
const fmt = (n: number) => n.toLocaleString('en-US')
type SceneProps = { t: number; simple: boolean }

/** A row of SVG bit cells. Cells past `show` are drawn empty; `gapAfter` adds space after a cell. */
function Cells({ x, y, bits, w = 30, h = 34, cls = '', show = bits.length, gapAfter }: { x: number; y: number; bits: string; w?: number; h?: number; cls?: string | ((i: number) => string); show?: number; gapAfter?: (i: number) => number }) {
  let dx = 0
  return (
    <g>
      {[...bits].map((b, i) => {
        const cx = x + i * w + dx
        if (gapAfter) dx += gapAfter(i)
        return (
          <g key={i} className={`bb-cell ${b === '1' && i < show ? 'on' : ''} ${typeof cls === 'function' ? cls(i) : cls}`} opacity={i < show ? 1 : 0.3}>
            <rect x={cx} y={y} width={w - 4} height={h} rx={5} />
            <text x={cx + (w - 4) / 2} y={y + h / 2 + 5} textAnchor="middle">
              {i < show ? b : ''}
            </text>
          </g>
        )
      })}
    </g>
  )
}

const PULSE = [1, 0, 1, 1, 0, 0, 1, 0]
const PER = 0.7

function Voltage({ t, simple }: SceneProps) {
  const cur = Math.min(PULSE.length - 1, Math.floor(t / PER))
  const part = Math.min(1, t / PER - cur)
  const on = PULSE[cur] === 1
  const X0 = 420
  const SW = 54
  const HI = 120
  const LO = 230
  let d = ''
  PULSE.slice(0, cur + 1).forEach((b, i) => {
    const y = b ? HI : LO
    const x1 = X0 + i * SW
    d += `${i ? 'L' : 'M'} ${x1} ${y} L ${x1 + SW * (i === cur ? part : 1)} ${y} `
  })
  const a = ((on ? 0 : -32) * Math.PI) / 180
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'A switch, flipped on and off' : 'A transistor is a switch'}
      </text>
      <text className="bb-sub" x={40} y={66}>
        {simple ? 'The chip has billions of these.' : 'The voltage on the gate decides whether current flows.'}
      </text>
      <text className="bb-sub" x={40} y={150}>
        {simple ? 'power' : 'supply'}
      </text>
      <line className="bb-wire live" x1={40} y1={160} x2={190} y2={160} />
      <circle className="bb-pivot" cx={190} cy={160} r={6} />
      <line className={`bb-lever ${on ? 'live' : ''}`} x1={190} y1={160} x2={190 + 80 * Math.cos(a)} y2={160 + 80 * Math.sin(a)} />
      <circle className="bb-pivot" cx={270} cy={160} r={6} />
      <line className={`bb-wire ${on ? 'live' : ''}`} x1={270} y1={160} x2={360} y2={160} />
      <circle className={`bb-node ${on ? 'live' : ''}`} cx={372} cy={160} r={12} />
      <text className="bb-sub" x={372} y={198} textAnchor="middle">
        {simple ? 'out' : 'output'}
      </text>
      <line className={`bb-gate ${on ? 'live' : ''}`} x1={230} y1={250} x2={230} y2={176} />
      <text className="bb-sub" x={230} y={270} textAnchor="middle">
        {simple ? 'control' : 'gate'}
      </text>
      <text className="bb-big" x={372} y={118} textAnchor="middle">
        {PULSE[cur]}
      </text>

      <text className="bb-sub" x={X0} y={HI - 30}>
        {simple ? 'The wire over time' : 'Voltage on the output over time'}
      </text>
      <line className="bb-axis" x1={X0} y1={LO + 18} x2={X0 + SW * 8 + 10} y2={LO + 18} />
      <line className="bb-thresh" x1={X0} y1={(HI + LO) / 2} x2={X0 + SW * 8} y2={(HI + LO) / 2} />
      <text className="bb-sub" x={X0 + SW * 8 + 8} y={HI + 4}>
        {simple ? 'high' : 'high = 1'}
      </text>
      <text className="bb-sub" x={X0 + SW * 8 + 8} y={(HI + LO) / 2 + 4}>
        {simple ? 'middle' : 'threshold'}
      </text>
      <text className="bb-sub" x={X0 + SW * 8 + 8} y={LO + 4}>
        {simple ? 'low' : 'low = 0'}
      </text>
      <path className="bb-trace" d={d} />
      {PULSE.map((b, i) => (
        <text key={i} className={`bb-bitlabel ${i <= cur ? '' : 'dim'}`} x={X0 + i * SW + SW / 2} y={LO + 46} textAnchor="middle">
          {i <= cur ? b : '?'}
        </text>
      ))}
      <text className="bb-note" x={40} y={350}>
        {simple
          ? 'A bit is just a wire that is either high or low. Calling those 1 and 0 is our choice.'
          : 'Anything above the threshold reads as 1, anything below as 0, so small noise never changes a bit.'}
      </text>
      <text className="bb-note" x={40} y={378}>
        {simple ? 'Eight of them in a row, here 10110010, can mean a number, a letter or part of a colour.' : 'Eight bits read in order, 10110010, make one byte. What it means depends on how a program reads it.'}
      </text>
    </g>
  )
}

const PLACE = [128, 64, 32, 16, 8, 4, 2, 1]
const COUNT_TO = 13
const COUNT_PER = 0.42

function Counting({ t, simple }: SceneProps) {
  const n = Math.min(COUNT_TO, Math.floor(t / COUNT_PER))
  const fresh = n > 0 && t - n * COUNT_PER < 0.2
  const bits = bin(n, 8)
  const pb = bin(Math.max(0, n - 1), 8)
  const X = 150
  const W = 84
  const parts = PLACE.filter((p) => n & p)
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Counting with only 0 and 1' : 'Binary place values'}
      </text>
      <text className="bb-sub" x={40} y={66}>
        {simple ? 'Each box is worth double the box to its right.' : 'Each place is worth twice the one to its right: powers of two.'}
      </text>
      {PLACE.map((p, i) => (
        <g key={p} className={`bb-place ${bits[i] === '1' ? 'on' : ''} ${fresh && bits[i] !== pb[i] ? 'flip' : ''}`}>
          <text className="bb-pv" x={X + i * W + 38} y={110} textAnchor="middle">
            {p}
          </text>
          <text className="bb-sub" x={X + i * W + 38} y={128} textAnchor="middle">
            2^{7 - i}
          </text>
          <circle cx={X + i * W + 38} cy={178} r={28} />
          <text className="bb-big" x={X + i * W + 38} y={190} textAnchor="middle">
            {bits[i]}
          </text>
        </g>
      ))}
      <text className="bb-sum" x={480} y={280} textAnchor="middle">
        {parts.length ? parts.join(' + ') : '0'} = {n}
      </text>
      <text className="bb-note" x={480} y={330} textAnchor="middle">
        {simple ? 'Adding one flips the rightmost 0 to 1 and turns the 1s after it back to 0, like 9 rolling over to 10.' : 'Adding one sets the lowest 0 and clears every 1 below it: a carry, like 099 becoming 100 in decimal.'}
      </text>
      <text className="bb-note" x={480} y={358} textAnchor="middle">
        {simple ? 'Eight boxes can count from 0 to 255.' : 'Eight bits hold 2^8 = 256 values, 0 to 255.'}
      </text>
    </g>
  )
}

function Hex({ t, simple }: SceneProps) {
  const split = phase(t, 0.3, 1.2)
  const digits = phase(t, 1.4, 2.3)
  const total = phase(t, 2.6, 3.4)
  const X = 300
  const R = X + 176 + 40 * split
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'A shorter way to write bits' : 'Hexadecimal: four bits per digit'}
      </text>
      <text className="bb-sub" x={40} y={66}>
        {simple ? 'Four bits have 16 patterns, so one symbol, 0 to 9 then A to F, covers each group.' : 'Four bits have 16 patterns, 0000 to 1111, so one base-16 digit writes exactly one nibble.'}
      </text>
      <Cells x={X} y={110} bits="11001010" w={44} h={44} gapAfter={(i) => (i === 3 ? 40 * split : 0)} />
      <g opacity={digits}>
        <path className="bb-brace" d={`M ${X} 166 q 0 12 12 12 h 148 q 12 0 12 -12`} />
        <path className="bb-brace" d={`M ${R} 166 q 0 12 12 12 h 148 q 12 0 12 -12`} />
        <text className="bb-note" x={X + 86} y={206} textAnchor="middle">
          8 + 4 = 12
        </text>
        <text className="bb-note" x={R + 86} y={206} textAnchor="middle">
          8 + 2 = 10
        </text>
        <text className="bb-hexd" x={X + 86} y={256} textAnchor="middle">
          C
        </text>
        <text className="bb-hexd" x={R + 86} y={256} textAnchor="middle">
          A
        </text>
      </g>
      <text className="bb-sum" x={480} y={312} textAnchor="middle" opacity={total}>
        {simple ? '11001010 is written CA, and means 202' : '0b11001010 = 0xCA = 12 × 16 + 10 = 202'}
      </text>
      {[...'0123456789ABCDEF'].map((c, i) => (
        <g key={c} className={`bb-hexkey ${digits > 0.5 && (c === 'C' || c === 'A') ? 'on' : ''}`}>
          <rect x={64 + i * 52} y={350} width={46} height={52} rx={6} />
          <text className="bb-hexk" x={87 + i * 52} y={373} textAnchor="middle">
            {c}
          </text>
          <text className="bb-tiny" x={87 + i * 52} y={392} textAnchor="middle">
            {bin(i, 4)}
          </text>
        </g>
      ))}
    </g>
  )
}

const UNITS: [string, string, number][] = [
  ['KB', 'KiB', 1],
  ['MB', 'MiB', 2],
  ['GB', 'GiB', 3],
  ['TB', 'TiB', 4],
]

function Sizes({ t, simple, mem }: SceneProps & { mem: number | null }) {
  const merge = phase(t, 0.2, 1)
  const SCALE = 470 / 1.1
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Bytes, and how big a gigabyte is' : 'Bytes and the two kinds of gigabyte'}
      </text>
      <Cells x={40} y={70} bits="01001000" w={lerp(30, 26, merge)} h={30} />
      <rect className="bb-bytebox" x={34} y={64} width={lerp(240, 212, merge)} height={42} rx={8} opacity={merge} />
      <text className="bb-note" x={270} y={92} opacity={merge}>
        {simple ? '8 bits make 1 byte, the smallest piece a Mac stores by address.' : '8 bits = 1 byte, the smallest unit with its own memory address.'}
      </text>
      {UNITS.map(([d, b, k], r) => {
        const y = 140 + r * 58
        const g = phase(t, 0.8 + r * 0.5, 1.6 + r * 0.5)
        const dec = 1000 ** k
        const binv = 1024 ** k
        return (
          <g key={d} opacity={0.3 + 0.7 * g}>
            <text className="bb-unit" x={40} y={y + 26}>
              {d}
            </text>
            <rect className="bb-bar dec" x={100} y={y} width={SCALE * g} height={18} rx={4} />
            <rect className="bb-bar bin" x={100} y={y + 22} width={SCALE * (binv / dec) * g} height={18} rx={4} />
            <text className="bb-barl" x={110 + SCALE * 1.1} y={y + 14}>
              {fmt(dec)} bytes{simple ? '' : `, 10^${3 * k}`}
            </text>
            <text className="bb-barl bin" x={110 + SCALE * 1.1} y={y + 36}>
              {fmt(binv)}{simple ? '' : `, 2^${10 * k} ${b}`}, +{((binv / dec - 1) * 100).toFixed(1)}%
            </text>
          </g>
        )
      })}
      <rect className="bb-bar dec" x={40} y={386} width={40} height={12} rx={3} />
      <text className="bb-legend" x={92} y={397}>
        {simple ? 'Counting in 1,000s: Finder, and the size printed on the box' : 'Decimal: Finder, drive sizes, network speeds'}
      </text>
      <rect className="bb-bar bin" x={40} y={410} width={40} height={12} rx={3} />
      <text className="bb-legend" x={92} y={421}>
        {mem == null
          ? simple
            ? 'Counting in 1,024s: Desk Space in Activity Monitor'
            : 'Binary: memory in Activity Monitor'
          : simple
            ? `Counting in 1,024s: Activity Monitor. This Mac's ${fmt(mem)} bytes of Desk Space show as ${memGB(mem, 0)}`
            : `Binary: memory in Activity Monitor. This Mac: ${fmt(mem)} bytes = ${memGB(mem, 0)} binary, ${bytes(mem)} decimal`}
      </text>
    </g>
  )
}

const WHEEL = { cx: 260, cy: 240, r: 140 }
const wheelAt = (i: number, r = WHEEL.r): [number, number] => {
  const a = ((i * 22.5 - 90) * Math.PI) / 180
  return [WHEEL.cx + r * Math.cos(a), WHEEL.cy + r * Math.sin(a)]
}

function Wheel({ pos, hot, simple }: { pos: number; hot?: boolean; simple: boolean }) {
  const [px, py] = wheelAt(pos, WHEEL.r - 26)
  const sel = Math.round(pos) % 16
  return (
    <g>
      <circle className="bb-ring" cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r} />
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = wheelAt(i)
        const [bx, by] = wheelAt(i, WHEEL.r + 36)
        const s = i >= 8 ? i - 16 : i
        return (
          <g key={i} className={`bb-tick ${s < 0 ? 'neg' : ''} ${i === sel ? 'on' : ''} ${i === 8 && hot ? 'hot' : ''}`}>
            <circle cx={x} cy={y} r={18} />
            <text x={x} y={y + 5} textAnchor="middle">
              {s}
            </text>
            <text className="bb-tiny" x={bx} y={by + 4} textAnchor="middle">
              {bin(i, 4)}
            </text>
          </g>
        )
      })}
      <line className="bb-hand" x1={WHEEL.cx} y1={WHEEL.cy} x2={px} y2={py} />
      <circle className="bb-pivot" cx={WHEEL.cx} cy={WHEEL.cy} r={6} />
      <text className="bb-sub" x={510} y={74}>
        {simple ? 'A wheel of every 4-bit pattern. Outside: the bits. Inside: what they mean.' : 'Every 4-bit pattern, outside, and its signed value, inside.'}
      </text>
    </g>
  )
}

function Lines({ x, y, rows, t }: { x: number; y: number; rows: { text: string; cls?: string; at: number }[]; t: number }) {
  return (
    <g>
      {rows.map((r, i) => (
        <text key={i} className={`bb-line ${r.cls ?? ''}`} x={x} y={y + i * 40} opacity={phase(t, r.at, r.at + 0.4)}>
          {r.text}
        </text>
      ))}
    </g>
  )
}

function Negative({ t, simple }: SceneProps) {
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Negative numbers' : "Two's complement"}
      </text>
      <Wheel pos={lerp(5, 11, phase(t, 2.4, 3.4))} simple={simple} />
      <Lines
        x={510}
        y={110}
        t={t}
        rows={
          simple
            ? [
                { text: '5 is 0101', at: 0.2 },
                { text: 'Flip every bit: 1010', at: 1 },
                { text: 'Add one: 1011, and that means -5', at: 1.8, cls: 'hl' },
                { text: 'With 8 bits, -5 is 11111011', at: 3.6 },
                { text: 'A leading 1 means below zero.', at: 4.2 },
                { text: '5 plus -5 gives 0 by normal adding.', at: 4.8 },
              ]
            : [
                { text: '+5 = 0101', at: 0.2 },
                { text: 'invert every bit: 1010', at: 1 },
                { text: 'add 1: 1011 = -8 + 2 + 1 = -5', at: 1.8, cls: 'hl' },
                { text: 'int8: -5 = 11111011 = 0xFB', at: 3.6 },
                { text: 'the top bit is worth -8, or -128 in int8', at: 4.2 },
                { text: '0101 + 1011 = 1 0000: the carry drops off', at: 4.8 },
              ]
        }
      />
    </g>
  )
}

function Overflow({ t, simple }: SceneProps) {
  const pos = 5 + phase(t, 0.3, 0.8) + phase(t, 1.1, 1.6) + phase(t, 2, 2.6)
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Running out of room' : 'Overflow: the wheel wraps'}
      </text>
      <Wheel pos={pos} hot={t >= 2.6} simple={simple} />
      <Lines
        x={510}
        y={110}
        t={t}
        rows={[
          { text: '5 + 1 = 6, then 6 + 1 = 7', at: 0.4 },
          { text: simple ? 'With 4 bits, 7 + 1 = -8' : '0111 + 1 = 1000 = -8', at: 2.6, cls: 'bad' },
          { text: simple ? 'With 8 bits, 127 + 1 = -128' : 'int8: 127 + 1 = -128', at: 3.3 },
          { text: simple ? 'No negatives? 255 + 1 = 0' : 'uint8: 255 + 1 = 0', at: 3.9 },
          { text: simple ? '32 bits: 2,147,483,647 + 1' : 'int32: 2,147,483,647 + 1', at: 4.5 },
          { text: '= -2,147,483,648', at: 4.5, cls: 'bad' },
        ]}
      />
    </g>
  )
}

const exact = (v: number) => v.toPrecision(22)

function Floats({ t, simple }: SceneProps) {
  const f = float(0.1)
  const fill = Math.ceil(phase(t, 0.2, 2) * 32)
  const tags = phase(t, 2, 2.8)
  const formula = phase(t, 2.8, 3.6)
  const sum = phase(t, 4, 5)
  const W = 27
  const X = 50
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Decimals: 0.1 in 32 bits' : 'IEEE 754 binary32: 0.1'}
      </text>
      <Cells x={X} y={66} bits={f.bits} w={W} h={32} show={fill} cls={(i) => (i === 0 ? 'sgn' : i <= 8 ? 'exp' : 'frc')} gapAfter={(i) => (i === 0 || i === 8 ? 8 : 0)} />
      <g opacity={tags}>
        <text className="bb-tag sgn" x={X} y={122}>
          {simple ? 'sign: +' : 'sign 0: +'}
        </text>
        <text className="bb-tag exp" x={X + W + 8} y={140}>
          {simple ? 'scale: 2 to the power -4' : `exponent ${f.exponent} - 127 = ${f.power}`}
        </text>
        <text className="bb-tag frc" x={X + 9 * W + 16} y={122}>
          {simple ? 'digits: 1.6000000238, as close as 23 bits get' : 'fraction: binary 1.10011001100110011001101 = 1.6000000238'}
        </text>
      </g>
      <text className="bb-sum" x={480} y={182} textAnchor="middle" opacity={formula}>
        +1.6000000238 × 2^-4 = {f.stored.toPrecision(12)}
      </text>
      <text className="bb-note" x={480} y={208} textAnchor="middle" opacity={formula}>
        {simple ? '1/10 never comes out even in binary, like 1/3 = 0.333... in decimal. It gets rounded.' : '1/10 has no finite binary expansion, so the stored value is the nearest one the format can hold.'}
      </text>
      <g opacity={sum}>
        <rect className="bb-panel" x={140} y={236} width={680} height={186} rx={10} />
        <text className="bb-sub" x={162} y={262}>
          {simple ? 'Most languages use 64 bits. Closer, but still rounded:' : 'binary64, the double JavaScript uses, exact stored values:'}
        </text>
        <text className="bb-mono" x={162} y={294}>
          0.1 is stored as {exact(0.1)}
        </text>
        <text className="bb-mono" x={162} y={320}>
          0.2 is stored as {exact(0.2)}
        </text>
        <text className="bb-mono bad" x={162} y={350}>
          0.1 + 0.2 gives {exact(0.1 + 0.2)}
        </text>
        <text className="bb-mono" x={162} y={376}>
          0.3 is stored as {exact(0.3)}
        </text>
        <text className="bb-note" x={162} y={406}>
          {simple ? 'The two answers differ in the very last bit, so 0.1 + 0.2 == 0.3 is false.' : 'They differ by one unit in the last place, so 0.1 + 0.2 === 0.3 is false.'}
        </text>
      </g>
    </g>
  )
}

const REG = [0x0a, 0x0b, 0x0c, 0x0d]

function Endian({ t, simple, little }: SceneProps & { little: boolean | null }) {
  const le = bytes32(0x0a0b0c0d)
  const RX = 340
  const MX = 280
  const ghost = phase(t, 4, 4.8)
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Which end goes first' : 'Byte order: little-endian'}
      </text>
      <text className="bb-sub" x={RX} y={78}>
        {simple ? 'The number 0x0A0B0C0D, held by a worker' : 'A 32-bit register holding 0x0A0B0C0D'}
      </text>
      {REG.map((b, i) => (
        <g key={i} className={`bb-byte ghost b${i}`}>
          <rect x={RX + i * 72} y={90} width={64} height={40} rx={7} />
          <text x={RX + i * 72 + 32} y={116} textAnchor="middle">
            {hex(b, 2)}
          </text>
        </g>
      ))}
      <text className="bb-tiny" x={RX} y={150}>
        {simple ? 'big end' : 'most significant'}
      </text>
      <text className="bb-tiny" x={RX + 4 * 72 - 8} y={150} textAnchor="end">
        {simple ? 'little end' : 'least significant'}
      </text>
      <text className="bb-sub" x={60} y={250}>
        {simple ? 'Memory, this Mac' : 'Memory, little-endian'}
      </text>
      {le.map((_, slot) => (
        <g key={slot}>
          <rect className="bb-slot" x={MX + slot * 100} y={220} width={88} height={48} rx={7} />
          <text className="bb-tiny" x={MX + slot * 100 + 44} y={286} textAnchor="middle">
            {simple ? `box ${slot}` : `address +${slot}`}
          </text>
        </g>
      ))}
      {REG.map((b, i) => {
        const slot = le.indexOf(b)
        const k = phase(t, 0.4 + (3 - i) * 0.7, 1.2 + (3 - i) * 0.7)
        const x = lerp(RX + i * 72, MX + slot * 100 + 12, k)
        const y = lerp(90, 224, k)
        return (
          <g key={i} className={`bb-byte b${i}`}>
            <rect x={x} y={y} width={64} height={40} rx={7} />
            <text x={x + 32} y={y + 26} textAnchor="middle">
              {hex(b, 2)}
            </text>
          </g>
        )
      })}
      <g opacity={ghost}>
        <text className="bb-sub" x={60} y={352}>
          {simple ? 'The other way round' : 'Big-endian, for comparison'}
        </text>
        {REG.map((b, i) => (
          <g key={i} className={`bb-byte ghost b${i}`}>
            <rect x={MX + i * 100 + 12} y={326} width={64} height={40} rx={7} />
            <text x={MX + i * 100 + 44} y={352} textAnchor="middle">
              {hex(b, 2)}
            </text>
          </g>
        ))}
        <text className="bb-note" x={60} y={404}>
          {simple
            ? 'Internet messages put the big end first, so a Mac swaps the order when it reads them.'
            : 'Internet protocol headers send the most significant byte first, so network code swaps bytes.'}
        </text>
        <text className="bb-note" x={60} y={428}>
          {little == null ? '' : little ? (simple ? 'This page checked your Mac: little end first.' : 'Measured in this page on this Mac: little-endian.') : 'Measured in this page: big-endian.'}
        </text>
      </g>
    </g>
  )
}

function Ascii({ t, simple }: SceneProps) {
  const cmp = phase(t, 3.2, 4)
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'Letters are numbers' : 'ASCII: 128 characters in 7 bits'}
      </text>
      {[...'Hi!'].map((c, i) => {
        const k = phase(t, 0.3 + i * 0.6, 1.1 + i * 0.6)
        const x = 70 + i * 170
        const code = c.charCodeAt(0)
        return (
          <g key={i}>
            <text className="bb-glyph" x={x + 66} y={120} textAnchor="middle">
              {c}
            </text>
            <g opacity={k} transform={`translate(0 ${lerp(-30, 0, k)})`}>
              <text className="bb-sum" x={x + 66} y={176} textAnchor="middle">
                {code}
              </text>
              <Cells x={x} y={194} bits={bin(code, 8)} w={17} h={26} />
              <text className="bb-mono" x={x + 66} y={250} textAnchor="middle">
                0x{hex(code, 2)}
              </text>
            </g>
          </g>
        )
      })}
      <g opacity={cmp}>
        <rect className="bb-panel" x={600} y={80} width={330} height={190} rx={10} />
        <text className="bb-sub" x={620} y={106}>
          {simple ? 'Capital and small letters' : 'Case is one bit'}
        </text>
        <text className="bb-glyph sm" x={646} y={156} textAnchor="middle">
          A
        </text>
        <Cells x={680} y={128} bits={bin(65, 8)} w={28} h={30} cls={(i) => (i === 2 ? 'mark' : '')} />
        <text className="bb-glyph sm" x={646} y={212} textAnchor="middle">
          a
        </text>
        <Cells x={680} y={184} bits={bin(97, 8)} w={28} h={30} cls={(i) => (i === 2 ? 'mark' : '')} />
        <text className="bb-note" x={620} y={252}>
          {simple ? '65 and 97: one switch apart' : '65 vs 97: only the 32s bit differs'}
        </text>
      </g>
      <text className="bb-note" x={40} y={330}>
        {simple
          ? 'Computers agree that 72 means H because they share one table, called ASCII.'
          : 'ASCII, written up for network use in RFC 20, maps 0 to 127 to English letters, digits, punctuation and control codes.'}
      </text>
      <text className="bb-note" x={40} y={358}>
        {simple ? 'It has no room for é, for Chinese, or for emoji. The next step fixes that.' : 'Seven bits leave no room for é, any non-Latin script or emoji. Unicode is the fix.'}
      </text>
    </g>
  )
}

const SAMPLES: { cp: number; name: string }[] = [
  { cp: 0x41, name: 'LATIN CAPITAL LETTER A' },
  { cp: 0xe9, name: 'LATIN SMALL LETTER E WITH ACUTE' },
  { cp: 0x20ac, name: 'EURO SIGN' },
  { cp: SMILE, name: 'GRINNING FACE' },
]

function Unicode({ t, simple }: SceneProps) {
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? 'One number for every character' : 'Unicode code points, UTF-8 bytes'}
      </text>
      <text className="bb-sub" x={40} y={66}>
        {simple ? 'Every character in every language gets its own number. UTF-8 stores small numbers in few bytes.' : 'Unicode gives each character a code point, U+0000 to U+10FFFF. UTF-8 stores each in 1 to 4 bytes.'}
      </text>
      {SAMPLES.map((s, r) => {
        const y = 92 + r * 80
        const k = phase(t, 0.3 + r * 0.7, 1 + r * 0.7)
        const b = utf8(s.cp)
        return (
          <g key={s.cp} opacity={0.3 + 0.7 * phase(t, r * 0.7, 0.3 + r * 0.7)}>
            <text className="bb-glyph sm" x={70} y={y + 42} textAnchor="middle">
              {String.fromCodePoint(s.cp)}
            </text>
            <text className="bb-mono" x={120} y={y + 26}>
              {codePoint(s.cp)}
            </text>
            <text className="bb-tiny" x={120} y={y + 46}>
              {simple ? `number ${fmt(s.cp)}` : s.name}
            </text>
            {b.map((v, i) => (
              <g key={i} className={`bb-byte u${b.length}`} opacity={k}>
                <rect x={lerp(380, 420 + i * 80, k)} y={y + 10} width={70} height={40} rx={7} />
                <text x={lerp(380, 420 + i * 80, k) + 35} y={y + 36} textAnchor="middle">
                  {hex(v, 2)}
                </text>
              </g>
            ))}
            <text className="bb-count" x={760} y={y + 36} opacity={k}>
              {b.length} {b.length === 1 ? 'byte' : 'bytes'}
            </text>
          </g>
        )
      })}
      <text className="bb-note" x={40} y={428}>
        {simple ? 'Plain English text stays as small as ASCII, because those letters keep their old numbers.' : 'U+0000 to U+007F encode as the same single byte as ASCII, so ASCII text is already valid UTF-8.'}
      </text>
    </g>
  )
}

const TEMPLATE = ['11110xxx', '10xxxxxx', '10xxxxxx', '10xxxxxx']

function Packing({ t, simple }: SceneProps) {
  const cpBits = bin(SMILE, 21)
  const W = 26
  const BX = 46
  const bx = (b: number, i: number) => BX + b * (8 * W + 14) + i * W
  const slots: number[] = []
  TEMPLATE.forEach((byte, b) => [...byte].forEach((c, i) => c === 'x' && slots.push(bx(b, i))))
  const out = utf8(SMILE)
  const TX = 165
  const done = phase(t, 4.6, 5.2)
  return (
    <g>
      <text className="bb-head" x={40} y={44}>
        {simple ? `Packing ${codePoint(SMILE)} into 4 bytes` : `UTF-8 encoding of ${codePoint(SMILE)}, bit by bit`}
      </text>
      <text className="bb-glyph sm" x={70} y={118} textAnchor="middle">
        {emoji}
      </text>
      <text className="bb-sub" x={TX} y={80}>
        {simple ? 'Its number, 128,512, in 21 bits' : 'Code point 0x1F600 = 128,512, as 21 bits'}
      </text>
      {[...cpBits].map((b, i) => (
        <g key={i} className={`bb-cell ghost ${b === '1' ? 'on' : ''}`}>
          <rect x={TX + i * 30} y={92} width={26} height={30} rx={5} />
          <text x={TX + i * 30 + 13} y={112} textAnchor="middle">
            {b}
          </text>
        </g>
      ))}
      <text className="bb-sub" x={BX} y={200}>
        {simple ? 'The 4-byte pattern: marker bits are fixed, the gaps take the number' : 'The 4-byte form from RFC 3629: fixed marker bits, and x for code point bits'}
      </text>
      {TEMPLATE.map((byte, b) =>
        [...byte].map((c, i) =>
          c === 'x' ? (
            <rect key={`${b}${i}`} className="bb-hole" x={bx(b, i)} y={220} width={W - 4} height={30} rx={5} />
          ) : (
            <g key={`${b}${i}`} className={`bb-cell mark ${c === '1' ? 'on' : ''}`}>
              <rect x={bx(b, i)} y={220} width={W - 4} height={30} rx={5} />
              <text x={bx(b, i) + (W - 4) / 2} y={240} textAnchor="middle">
                {c}
              </text>
            </g>
          ),
        ),
      )}
      {[...cpBits].map((b, i) => {
        const k = phase(t, 0.4 + i * 0.17, 1.0 + i * 0.17)
        if (k <= 0) return null
        const x = lerp(TX + i * 30, slots[i], k)
        const y = lerp(92, 220, k)
        return (
          <g key={i} className={`bb-cell fly ${b === '1' ? 'on' : ''}`}>
            <rect x={x} y={y} width={W - 4} height={30} rx={5} />
            <text x={x + (W - 4) / 2} y={y + 20} textAnchor="middle">
              {b}
            </text>
          </g>
        )
      })}
      <g opacity={done}>
        {out.map((v, b) => (
          <g key={b} className="bb-byte u4">
            <rect x={bx(b, 0) + 64} y={268} width={80} height={36} rx={7} />
            <text x={bx(b, 0) + 104} y={292} textAnchor="middle">
              {hex(v, 2)}
            </text>
          </g>
        ))}
        <text className="bb-note" x={40} y={350}>
          {simple ? 'The first byte starts with four 1s, which says "this character is 4 bytes long".' : 'The lead byte 11110 announces four bytes; every continuation byte starts 10.'}
        </text>
        <text className="bb-note" x={40} y={378}>
          {simple
            ? 'The other bytes start 10, so a Mac dropped into the middle of text can always find where a character begins.'
            : 'So a reader can find a character boundary from any byte, and bytes C0, C1 and F5 to FF never appear.'}
        </text>
        <text className="bb-note" x={40} y={406}>
          {simple
            ? 'Inside JavaScript the same face takes two 16-bit pieces, a surrogate pair, so its length is 2.'
            : 'In UTF-16, the string format JavaScript uses, it is the surrogate pair D83D DE00, so its .length is 2.'}
        </text>
      </g>
    </g>
  )
}

function Scene({ i, t, simple, mem, little }: { i: number; t: number; simple: boolean; mem: number | null; little: boolean | null }) {
  const p = { t, simple }
  const body = [
    <Voltage {...p} />,
    <Counting {...p} />,
    <Hex {...p} />,
    <Sizes {...p} mem={mem} />,
    <Negative {...p} />,
    <Overflow {...p} />,
    <Floats {...p} />,
    <Endian {...p} little={little} />,
    <Ascii {...p} />,
    <Unicode {...p} />,
    <Packing {...p} />,
  ][i]
  return (
    <svg className="bb-scene" viewBox="0 0 960 450" role="img" aria-label="How bits, numbers and text are stored, one step at a time">
      {body}
    </svg>
  )
}

/** HTML bit cells for the Try it cards, wrapped a byte at a time so 32 bits fit a phone. */
function BitRow({ bits, cls }: { bits: string; cls?: (i: number) => string }) {
  return (
    <span className="bb-bits">
      {(bits.match(/.{1,8}/g) ?? []).map((g, gi) => (
        <span key={gi} className="bb-bits-byte">
          {[...g].map((b, i) => (
            <span key={i} className={`bb-bit ${b === '1' ? 'on' : ''} ${cls ? cls(gi * 8 + i) : ''}`}>
              {b}
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

function Mem({ bs }: { bs: number[] }) {
  return (
    <span className="bb-mem">
      {bs.map((b, i) => (
        <span key={i} className="bb-mem-cell">
          <span className="num">{hex(b, 2)}</span>
          <span className="bb-mem-a">+{i}</span>
        </span>
      ))}
    </span>
  )
}

const NUM_PRESETS = ['42', '-1', '255', '-128', '0.1', '1e-40', '2147483648', 'NaN', '-Infinity']

function NumberExplorer() {
  const simple = useSimple()
  const [text, setText] = useState('-5')
  const v = parseNumber(text)
  const i8 = v == null ? null : int(v, 8)
  const i32 = v == null ? null : int(v, 32)
  const f = v == null ? null : float(v)
  const wrapNote = (r: ReturnType<typeof int>, bits: number) =>
    r.bits == null
      ? simple
        ? 'not a whole number, so it can only be stored as a decimal'
        : 'not an integer: only the float encoding applies'
      : r.fits
        ? null
        : `${simple ? "doesn't fit, wraps to" : 'overflows, wraps to'} ${fmt(r.signed as number)}${r.fitsUnsigned ? `; fits unsigned as ${fmt(r.unsigned as number)}` : ''}`
  const kindText: Record<string, string> = simple
    ? { zero: 'Zero', subnormal: 'Tiny, below the normal range', normal: 'A normal number', infinity: 'Infinity: too big to hold', nan: 'Not a number' }
    : { zero: 'Zero', subnormal: 'Subnormal: exponent field 0, no hidden 1', normal: 'Normal', infinity: 'Infinity: exponent all 1s, fraction 0', nan: 'NaN: exponent all 1s, fraction not 0' }
  const n8 = i8 && wrapNote(i8, 8)
  const n32 = i32 && wrapNote(i32, 32)
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: see any number as bits' : 'Try it: number explorer'}</h3>
      <p className="fine">
        {simple
          ? 'Type a number, whole or with a decimal point. Hex like 0xFF works too, and so do NaN and Infinity.'
          : "Decimal, 0x hex, 0b binary, NaN and Infinity all parse. Integers show their two's complement patterns; every value also shows its float32 encoding and byte layout."}
      </p>
      <div className="lab-try-row">
        <label className="lab-field">
          <span>{simple ? 'Number' : 'Value'}</span>
          <input value={text} onChange={(e) => setText(e.currentTarget.value)} spellCheck={false} autoComplete="off" className="num" />
        </label>
        <div className="bb-presets" role="group" aria-label="Examples">
          {NUM_PRESETS.map((p) => (
            <button key={p} type="button" className="lab-btn" aria-pressed={text === p} onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {v == null || !i32 || !f ? (
        <p className="lab-verdict bad" aria-live="polite">
          {simple ? 'That is not a number this explorer can read.' : 'Not a number: try 42, -1, 0x7F, 0b1010 or 3.14.'}
        </p>
      ) : (
        <dl className="bb-out" aria-live="polite">
          {i32.bits != null && (
            <>
              <dt>{simple ? 'Hex' : 'Hex, int32 pattern'}</dt>
              <dd className="num">0x{hex(i32.unsigned as number, 8)}</dd>
              <dt>int8</dt>
              <dd>
                {i8?.bits && <BitRow bits={i8.bits} />}
                {n8 && <span className="bb-warn">{n8}</span>}
              </dd>
              <dt>int32</dt>
              <dd>
                <BitRow bits={i32.bits} />
                {n32 && <span className="bb-warn">{n32}</span>}
              </dd>
              <dt>{simple ? 'int32 in memory' : 'int32 in memory, little-endian'}</dt>
              <dd>
                <Mem bs={bytes32(i32.unsigned as number)} />
              </dd>
            </>
          )}
          {i32.bits == null && (
            <>
              <dt>{simple ? 'Whole number' : 'Integer'}</dt>
              <dd className="bb-warn">{n32}</dd>
            </>
          )}
          <dt>float32</dt>
          <dd>
            <BitRow bits={f.bits} cls={(i) => (i === 0 ? 'sgn' : i <= 8 ? 'exp' : 'frc')} />
            <span className="bb-fl">
              <span className="sgn">sign {f.sign}</span>
              <span className="exp">
                {simple ? 'scale' : 'exponent'} {f.exponent}
                {f.power != null ? `, 2^${f.power}` : ''}
              </span>
              <span className="frc">
                {simple ? 'digits' : 'fraction'} 0x{hex(parseInt(f.fracBits, 2), 6)}
              </span>
            </span>
            <span className="bb-fl">
              {`${kindText[f.kind]}. ${simple ? 'Stored as' : 'Stored value'} ${String(f.stored)}${f.stored !== v && !Number.isNaN(v) ? (simple ? ', not quite what you typed.' : ', rounded from the input.') : '.'}`}
            </span>
          </dd>
          <dt>{simple ? 'float32 in memory' : 'float32 in memory, little-endian'}</dt>
          <dd>
            <Mem bs={bytes32(parseInt(f.bits, 2))} />
          </dd>
        </dl>
      )}
    </section>
  )
}

const TEXT_PRESETS: [string, string][] = [
  ['English', 'Hello'],
  ['accents', 'naïve café'],
  ['combining', 'é'],
  ['emoji', `hi ${emoji}`],
  ['flag', String.fromCodePoint(0x1f1ee, 0x1f1f3)],
  ['Hindi', 'नमस्ते'],
]

function TextExplorer() {
  const simple = useSimple()
  const [text, setText] = useState(`café ${emoji}`)
  const enc = encode(text)
  const total = enc.reduce((a, e) => a + e.bytes.length, 0)
  const shown = enc.slice(0, 40)
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: turn text into bytes' : 'Try it: text to UTF-8'}</h3>
      <p className="fine">
        {simple ? 'Type anything, in any language, emoji too. Each character becomes 1 to 4 bytes.' : 'Each code point with its UTF-8 bytes, coloured by length. The counts compare bytes, code points, UTF-16 units and grapheme clusters.'}
      </p>
      <div className="lab-try-row">
        <label className="lab-field bb-wide">
          <span>Text</span>
          <input value={text} onChange={(e) => setText(e.currentTarget.value)} spellCheck={false} autoComplete="off" />
        </label>
        <div className="bb-presets" role="group" aria-label="Examples">
          {TEXT_PRESETS.map(([label, s]) => (
            <button key={label} type="button" className="lab-btn" aria-pressed={text === s} onClick={() => setText(s)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="bb-counts" aria-live="polite">
        <span>
          <b className="num">{total}</b> {simple ? 'bytes' : 'UTF-8 bytes'}
        </span>
        <span>
          <b className="num">{graphemes(text)}</b> {simple ? 'characters you see' : 'grapheme clusters'}
        </span>
        <span>
          <b className="num">{enc.length}</b> {simple ? 'Unicode numbers' : 'code points'}
        </span>
        <span>
          <b className="num">{text.length}</b> {simple ? 'JavaScript length' : 'UTF-16 units, .length'}
        </span>
      </div>
      <ul className="bb-chars">
        {shown.map((e, n) => (
          <li key={n} className={`u${e.bytes.length}`}>
            <span className="bb-ch">{/\s/.test(e.ch) ? '␣' : e.cp === 0xfffd ? '�' : e.ch}</span>
            <span className="bb-cp num">{codePoint(e.cp)}</span>
            <span className="bb-bs num">{e.bytes.map((b) => hex(b, 2)).join(' ')}</span>
          </li>
        ))}
        {enc.length > shown.length && <li className="bb-more">+{enc.length - shown.length} more</li>}
      </ul>
      <p className="fine bb-legend-row">
        <span className="u1">1 byte</span> <span className="u2">2 bytes</span> <span className="u3">3 bytes</span> <span className="u4">4 bytes</span>
      </p>
    </section>
  )
}

export default function Bits({ hw, demo }: LabProps) {
  const simple = useSimple()
  const mem = hw.memBytes > 0 ? hw.memBytes : null
  const little = typeof Uint32Array === 'function' ? nativeLittleEndian() : null
  const steps: Step[] = [
    {
      title: simple ? 'A bit is a switch' : 'A bit is a voltage',
      dur: 6,
      tech: (
        <p>
          Inside the chip, a bit is a wire held at a high or a low voltage. Transistors are switches that a voltage on their gate opens or closes, and logic gates are built from them. Circuits only need to tell high from low, with a wide gap between, so noise rarely flips a bit. Apple's first M1 already had 16 billion transistors.
        </p>
      ),
      plain: (
        <p>
          Everything in your Mac comes down to tiny switches. Each one is on or off, and we call that 1 or 0: one bit. The chip in a Mac has billions of these switches. Reading a wire only means asking "high or low?", which is easy to get right every time.
        </p>
      ),
    },
    {
      title: simple ? 'Counting with two digits' : 'Binary counting',
      dur: 6.4,
      tech: (
        <p>
          Binary is place value with base 2. The rightmost bit is worth 1, the next 2, then 4, 8 and so on, each a power of two. A number is the sum of the places holding a 1: <code>00001101</code> is 8 + 4 + 1 = 13. Adding one carries just as it does in decimal.
        </p>
      ),
      plain: (
        <p>
          With only 0 and 1 you can still count. Each box is worth twice the box to its right: 1, 2, 4, 8 and up. Add up the boxes that are on to get the number. Watch it count to 13: the 8, the 4 and the 1.
        </p>
      ),
    },
    {
      title: simple ? 'Hex, a shorthand' : 'Hexadecimal',
      dur: 4,
      tech: (
        <p>
          Long rows of bits are hard to read, so programmers write them in base 16. Each hex digit stands for exactly four bits, so a byte is always two hex digits: <code>11001010</code> is <code>0xCA</code>. Memory addresses, web colours like <code>#CA00FF</code> and the bytes in the next steps are all written this way.
        </p>
      ),
      plain: (
        <p>
          Long strings of 0s and 1s are hard to read. So we split them into groups of four and give each group one symbol, 0 to 9 then A to F. Any byte becomes just two symbols. You'll see this in web colours like <code>#CA00FF</code>.
        </p>
      ),
    },
    {
      title: simple ? 'Bytes, and two kinds of gigabyte' : 'Bytes, KB, MB, GB',
      dur: 3.4,
      tech: (
        <p>
          Eight bits make a byte, the smallest unit with its own address. Above that, there are two systems. Drive makers and Finder count in powers of 1000. Memory is built in powers of two, so Activity Monitor counts in 1024s: its "16 GB" is 16 GiB, 17,179,869,184 bytes. The gap grows at each step, to almost 10% at a terabyte.
        </p>
      ),
      plain: (
        <p>
          Eight bits make one byte, about one letter of text. A kilobyte is roughly a thousand bytes, but "roughly" hides two answers. Finder counts in thousands. Activity Monitor counts Desk Space in 1,024s, because memory chips come in powers of two. At gigabyte size the two differ by about 7%.
        </p>
      ),
    },
    {
      title: simple ? 'Negative numbers' : "Two's complement",
      dur: 5.4,
      tech: (
        <p>
          Signed integers use two's complement: the top bit is worth minus its place value, so in 4 bits <code>1011</code> is -8 + 2 + 1 = -5. To negate, invert every bit and add one. The adder needs no special case: <code>5 + (-5)</code> is plain binary addition, and the carry out of the top drops off to leave 0.
        </p>
      ),
      plain: (
        <p>
          How do you store -5 with only 0s and 1s? Computers flip every bit, then add one. Picture the numbers on a clock face. One step back from 0 lands on the biggest pattern, 1111, which means -1. Adding still works the normal way, so the chip needs nothing extra.
        </p>
      ),
    },
    {
      title: simple ? 'Running out of room' : 'Integer overflow',
      dur: 5,
      tech: (
        <p>
          A fixed number of bits is a wheel, not a line. Add 1 to the largest signed value and the pattern wraps to the most negative one: <code>0111 + 1 = 1000</code>, so 7 becomes -8. Unsigned values wrap from the top to 0. C lets it happen silently; Swift stops the program with an error unless you ask for wrapping with <code>&amp;+</code>.
        </p>
      ),
      plain: (
        <p>
          A fixed number of boxes can only count so high. Go one past the top and the number wraps around, like an old car's mileage counter rolling back to zero. With 4 bits, 7 + 1 comes out as -8. Programs that forget this have real bugs.
        </p>
      ),
    },
    {
      title: simple ? 'Decimals, and why 0.1 + 0.2 is off' : 'Floating point',
      dur: 5.4,
      tech: (
        <p>
          IEEE 754 stores a number as a sign, an exponent and a fraction: scientific notation in base 2. In 32 bits that's 1 + 8 + 23 bits, with the exponent stored plus 127. A normal number always starts with 1, so that bit is implied and not stored. Most decimals, 0.1 included, have no exact binary form and get rounded. In 64-bit doubles, 0.1 + 0.2 rounds to a different double than 0.3.
        </p>
      ),
      plain: (
        <p>
          Decimals are stored a bit like scientific notation: a sign, a scale and some digits. But 0.1 can't be written exactly in binary, the same way 1/3 can't be written exactly in decimal. So it's rounded a tiny amount. Add two rounded numbers and the tiny errors show: 0.1 + 0.2 comes out as 0.30000000000000004.
        </p>
      ),
    },
    {
      title: simple ? 'Which end first' : 'Byte order',
      dur: 5,
      tech: (
        <p>
          A 32-bit value spans four byte addresses, and the CPU must pick an order. Apple Silicon, like x86, is little-endian: the least significant byte, <code>0D</code>, goes at the lowest address. Network protocols send the most significant byte first, big-endian, so code converts at the boundary with calls like <code>htonl</code>.
        </p>
      ),
      plain: (
        <p>
          A big number takes four bytes, and they go into four memory boxes in a row. Which byte goes in the first box? Your Mac puts the little end first. Messages on the internet put the big end first, so your Mac swaps them around when sending and receiving.
        </p>
      ),
    },
    {
      title: simple ? 'Letters are numbers' : 'ASCII',
      dur: 4.4,
      tech: (
        <p>
          Text is numbers too. ASCII assigns 0 to 127 to letters, digits, punctuation and control codes, so <code>Hi!</code> is the bytes 72, 105 and 33. Upper and lower case differ in a single bit, worth 32. ASCII covers English only.
        </p>
      ),
      plain: (
        <p>
          Letters are stored as numbers from a shared table. H is 72, i is 105, ! is 33. Capital A and small a are just one switch apart. But the table only has 128 places, which is enough for English and nothing else.
        </p>
      ),
    },
    {
      title: simple ? 'Every language, every emoji' : 'Unicode and UTF-8',
      dur: 3.4,
      tech: (
        <p>
          Unicode gives every character a code point, from U+0000 to U+10FFFF, over a million slots. UTF-8 stores a code point in 1 to 4 bytes. ASCII stays one byte, <code>é</code> takes two, <code>€</code> three, and emoji, above U+FFFF, four.
        </p>
      ),
      plain: (
        <p>
          Unicode is one giant numbered list with room for every character in every language, plus emoji. UTF-8 is the way those numbers become bytes. English letters take one byte, accented letters two, many other scripts three and emoji four.
        </p>
      ),
    },
    {
      title: simple ? 'How 4 bytes hold an emoji' : 'Inside a 4-byte UTF-8 sequence',
      dur: 5.4,
      tech: (
        <p>
          U+1F600 needs 21 bits. The 4-byte UTF-8 form has exactly 21 free slots: 3 in the lead byte after <code>11110</code>, and 6 in each continuation byte after <code>10</code>. Pour the bits in from the top and the result is <code>F0 9F 98 80</code>. The fixed prefixes let a reader resynchronise from any byte.
        </p>
      ),
      plain: (
        <p>
          The grinning face is number 128,512. That needs 21 bits. UTF-8 has a 4-byte pattern with exactly 21 gaps, and the bits drop into the gaps in order. The fixed bits at the front of each byte tell the Mac how long the character is.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={simple ? "Your Mac's Desk Space in both kinds of unit, and the byte order, checked in this page." : 'Memory size from hw.memsize via the reader. Byte order measured in this page: a Uint32Array holding 1, read back as bytes.'}
      >
        <div className="bb-span2">
          <LiveStat label={simple ? 'Desk Space, exact' : 'RAM in bytes'} value={mem == null ? 'n/a' : fmt(mem)} sub={simple ? 'every single byte' : 'hw.memsize'} />
        </div>
        <LiveStat label={simple ? 'Counting in 1,024s' : 'Binary units'} value={memGB(mem, 0)} sub={simple ? 'as Activity Monitor says' : 'GiB, as Activity Monitor shows'} />
        <LiveStat label={simple ? 'Counting in 1,000s' : 'Decimal units'} value={bytes(mem)} sub={simple ? 'how Finder would count it' : 'GB, as Finder counts'} />
        <div className="bb-span2">
          <LiveStat label="Byte order" value={little == null ? 'n/a' : little ? 'little-endian' : 'big-endian'} sub={simple ? 'little end first' : 'measured in this page'} />
        </div>
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene i={story.i} t={story.t} simple={simple} mem={mem} little={little} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <NumberExplorer />
      <TextExplorer />

      <Deeper title={simple ? 'Why it matters' : 'Where this shows up'}>
        {simple ? (
          <>
            <p>These rules sit under everything your Mac does.</p>
            <ul>
              <li>A photo is millions of numbers, a few for the colour of each dot.</li>
              <li>Money is best counted in whole cents, not decimals, because of the 0.1 + 0.2 problem.</li>
              <li>When text shows up as garbage like Ã©, a program read UTF-8 bytes with the wrong table.</li>
            </ul>
          </>
        ) : (
          <>
            <p>Bits mean nothing on their own; the type a program reads them as decides everything.</p>
            <ul>
              <li>The same four bytes are an int32, a float32, four ASCII letters or one emoji. The number explorer shows two of those readings side by side.</li>
              <li>Money belongs in integers of cents or in decimal types, never in binary floats, because most decimal fractions round.</li>
              <li>
                Mojibake such as <code>Ã©</code> for <code>é</code> is UTF-8's two bytes, <code>C3 A9</code>, decoded as two Latin-1 characters.
              </li>
              <li>A string has several lengths: UTF-8 bytes on disk, UTF-16 units in JavaScript, code points, and the grapheme clusters a person sees.</li>
            </ul>
            <p>
              Try it in Terminal: <code>printf 'é' | xxd</code> prints <code>c3a9</code>, and <code>sysctl hw.byteorder</code> prints <code>1234</code>, which means little-endian.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Dive into Systems, chapter 4: Binary and data representation', url: 'https://diveintosystems.org/book/C4-Binary/index.html', note: 'Free textbook. Place values, hex, unsigned and signed integers.' },
          { title: 'Dive into Systems: Signed binary integers', url: 'https://diveintosystems.org/book/C4-Binary/signed.html', note: "Two's complement and how to negate." },
          { title: 'Dive into Systems: Integer overflow', url: 'https://diveintosystems.org/book/C4-Binary/overflow.html', note: 'Why a fixed-width integer wraps like a wheel.' },
          { title: 'Dive into Systems: Integer byte order', url: 'https://diveintosystems.org/book/C4-Binary/byte_order.html', note: 'Little- and big-endian layouts; x86 and most Arm hardware are little-endian.' },
          { title: 'Dive into Systems: Logic gates', url: 'https://diveintosystems.org/book/C5-Arch/gates.html', note: 'Transistors act as switches, and gates are built from them.' },
          { title: 'Apple, M1 announcement', url: 'https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/', note: '16 billion transistors in M1.' },
          { title: 'Apple, How iOS and macOS report storage capacity', url: 'https://support.apple.com/en-us/102119', note: 'Decimal units for storage; 1 GB = 1,073,741,824 bytes in binary.' },
          { title: 'Swift book, Advanced Operators', url: 'https://docs.swift.org/swift-book/documentation/the-swift-programming-language/advancedoperators/', note: 'Swift reports overflow as an error; the & operators wrap.' },
          { title: 'Goldberg, What Every Computer Scientist Should Know About Floating-Point Arithmetic', url: 'https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html', note: 'The classic explainer of IEEE 754, rounding and error.' },
          { title: 'The Floating-Point Guide', url: 'https://floating-point-gui.de/formats/fp/', note: 'Sign, exponent and fraction, and why 0.1 + 0.2 != 0.3, in plain words.' },
          { title: 'RFC 20, ASCII format for network interchange', url: 'https://www.rfc-editor.org/rfc/rfc20', note: 'The 7-bit ASCII table.' },
          { title: 'The Unicode Standard, chapter 3: Conformance', url: 'https://www.unicode.org/versions/latest/core-spec/chapter-3/', note: 'Code points from U+0000 to U+10FFFF, surrogates, and the UTF-8 bit table.' },
          { title: 'Unicode FAQ: UTF-8, UTF-16, UTF-32 and BOM', url: 'https://www.unicode.org/faq/utf_bom.html', note: 'Surrogate pairs and how the encodings compare.' },
          { title: 'RFC 3629, UTF-8', url: 'https://www.rfc-editor.org/rfc/rfc3629', note: 'The 1 to 4 byte templates, the bytes that never appear, and boundary finding.' },
          { title: 'RFC 791, Internet Protocol, appendix B', url: 'https://www.rfc-editor.org/rfc/rfc791', note: 'Network byte order: most significant byte first.' },
          { title: 'MDN, String: UTF-16 characters, code points and grapheme clusters', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String', note: "Why JavaScript's length counts UTF-16 units." },
        ]}
      />
      <p className="fine">
        Checked on this Mac, an Apple M5: <code>sysctl hw.byteorder</code> prints 1234, little-endian; <code>sysctl hw.memsize</code> prints 17179869184, which Activity Monitor shows as 16 GB; <code>node -e "console.log(0.1+0.2)"</code> prints 0.30000000000000004. The encoders behind the Try it cards are tested against the platform's own TextEncoder and DataView.
      </p>
    </div>
  )
}
