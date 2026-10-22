import { useState } from 'react'
import { bytes, memGB, num } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, lerp, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { COMP_MAX, MAX_APPS, RAM, SWAP_MAX, ratio as simRatio, simulate, type Mix, type Pressure, type Sim } from './compress-sim.ts'
import './CompressSwap.css'

// RAM running short, as one picture: 48 frames of RAM on the left, the compressor in the middle, swap files on
// the SSD on the right, and a strip underneath for the page queues, the race back in and the pressure gauge.
// Coordinates are in the SVG's 960 x 548 viewBox.

type Kind = 'wired' | 'A' | 'B' | 'C' | 'N' | 'file' | 'free' | 'cmp'
const FR = (f: number) => ({ x: 24 + (f % 8) * 50, y: 70 + Math.floor(f / 8) * 42, w: 46, h: 38 })
const fc = (f: number): [number, number] => {
  const r = FR(f)
  return [r.x + r.w / 2, r.y + r.h / 2]
}
const CMP = { x: 456, y: 70, w: 224, h: 248 }
const WK = { x: 476, y: 122, w: 84, h: 30 }
const LZ = { x: 576, y: 122, w: 84, h: 30 }
const SEG_X = 476
const SEG_W = 184
const SEG_Y = [208, 266]
const SSD = { x: 712, y: 70, w: 224, h: 248 }
const SWAPFILE_Y = (i: number) => 124 + i * 30
const SWAPFILES = 5
const KERNEL = { x: 24, y: 500, w: 912, h: 36 }
const SRC: [number, number] = [700, 30]
/** Width of a whole 16 KB page when drawn as a chunk inside a segment. */
const PAGE_W = 56
/** Segment 1 starts full of older compressed pages, drawn at these widths. */
const SEG1 = [22, 4, 40, 18, 30, 4, 26]
const LEVELS: Pressure[] = ['normal', 'warn', 'critical']
const PLAIN_LEVEL = ['fine', 'tight', 'struggling']

const START: Kind[] = [
  ...Array<Kind>(6).fill('wired'),
  ...Array<Kind>(10).fill('A'),
  ...Array<Kind>(6).fill('B'),
  ...Array<Kind>(5).fill('C'),
  'cmp',
  ...Array<Kind>(10).fill('file'),
  ...Array<Kind>(10).fill('free'),
]
/** What each step does to the frames: at seconds into the step, frame f becomes kind k. */
const CHANGES: { at: number; f: number; k: Kind }[][] = [
  Array.from({ length: 10 }, (_, n) => ({ at: 1.1 + n * 0.35, f: 38 + n, k: 'N' as Kind })),
  [
    ...Array.from({ length: 10 }, (_, n) => ({ at: 0.6 + n * 0.12, f: 28 + n, k: 'free' as Kind })),
    ...Array.from({ length: 10 }, (_, n) => ({ at: 3 + n * 0.3, f: 28 + n, k: 'N' as Kind })),
  ],
  [],
  [
    { at: 0.4, f: 8, k: 'free' },
    { at: 1.4, f: 7, k: 'free' },
    { at: 2.1, f: 8, k: 'cmp' },
    { at: 2.4, f: 6, k: 'free' },
  ],
  [{ at: 4.2, f: 27, k: 'free' }],
  [
    { at: 1.8, f: 6, k: 'A' },
    { at: 4.8, f: 27, k: 'cmp' },
    { at: 6.3, f: 7, k: 'C' },
  ],
  [],
]
function worldAt(i: number, t: number): Kind[] {
  const w = [...START]
  CHANGES.forEach((cs, n) => cs.forEach((c) => (n < i || (n === i && t >= c.at)) && (w[c.f] = c.k)))
  return w
}

// Page queues for step 3. Slots run left to right: newest at the left, oldest at the right.
const AQ = 380
const IQ = 446
const slotX = (j: number) => 50 + j * 52
type Chip = { f: number; k: Kind; x: number; y: number; flash: boolean; picked: boolean }
function chips(t: number): Chip[] {
  const out: Chip[] = []
  const mv = (f: number, k: Kind, a: [number, number], b: [number, number], from: number, to: number, flash = false, picked = false) => {
    // Moves between lanes go through the gap between them, not across other chips.
    const mid = (a[1] + b[1]) / 2
    const [x, y] = along(a[1] === b[1] ? [a, b] : [a, [a[0], mid], [b[0], mid], b], phase(t, from, to))
    out.push({ f, k, x, y, flash, picked })
  }
  // Mail touches page 16 again, so it goes back to the newest end of the active queue and the others shift.
  ;[38, 39, 28, 21].forEach((f, j) => mv(f, f === 21 ? 'B' : 'N', [slotX(j), AQ], [slotX(j + 1), AQ], 2, 3))
  mv(16, 'B', [slotX(2), IQ], [slotX(0), AQ], 2, 3, t >= 1.5 && t < 2.3)
  // Aging: the two oldest active pages drop to the inactive queue.
  mv(17, 'B', [slotX(4), AQ], [slotX(0), IQ], 0.3, 1.4)
  mv(22, 'C', [slotX(5), AQ], [slotX(1), IQ], 0.3, 1.4)
  mv(9, 'A', [slotX(3), IQ], [slotX(3), IQ], 0, 1)
  ;[6, 7, 8].forEach((f, n) => {
    const at = 3.4 + n * 0.8
    mv(f, 'A', [slotX(6 - n), IQ], [500 + n * 56, IQ], at, at + 0.6, false, t >= at)
  })
  return out
}

type Token = { at: [number, number]; label: string; cls: string; w?: number }
type Frame = {
  world: Kind[]
  tokens: Token[]
  hot: number[]
  pick: number[]
  fault: number[]
  kernel: string | null
  /** Widths of the chunks in segment 2. */
  seg2: number[]
  seg1: 'ram' | 'gone'
  lock: number
  wk: boolean
  lz: boolean
}

/** Everything that moves at time t of step i. `r` is the compression ratio the text-like page gets. */
function frame(i: number, t: number, simple: boolean, r: number): Frame {
  const out: Frame = {
    world: worldAt(i, t),
    tokens: [],
    hot: [],
    pick: [],
    fault: [],
    kernel: null,
    seg2: [],
    seg1: i > 4 || (i === 4 && t >= 1.8) ? 'gone' : 'ram',
    lock: i === 4 ? phase(t, 0.6, 1.4) : 0,
    wk: false,
    lz: false,
  }
  const tw = Math.max(PAGE_W / r, 6)
  // Order the chunks land in segment 2: the photo page, the zero page, the text-like page.
  const chunks = [PAGE_W, 3, tw]
  const chunkX = (n: number) => SEG_X + 6 + chunks.slice(0, n).reduce((a, b) => a + b + 4, 0)
  if (i > 3) out.seg2 = chunks
  const drop = (f: number, from: number) => {
    if (t >= from && t < from + 0.5) out.tokens.push({ at: along([SRC, [fc(f)[0], SRC[1]], fc(f)], phase(t, from, from + 0.5)), label: '16 KB', cls: 'N' })
  }
  switch (i) {
    case 0:
      for (let n = 0; n < 10; n++) drop(38 + n, 0.6 + n * 0.35)
      if (t >= 4.6) out.kernel = simple ? 'No empty spots left. macOS starts looking for things it can clear away.' : 'Free count below vm_page_free_target: the pageout daemon wakes up to reclaim pages.'
      break
    case 1:
      for (let n = 0; n < 10; n++) if (t >= 0.3 + n * 0.12 && t < 0.6 + n * 0.12) out.hot.push(28 + n)
      for (let n = 0; n < 10; n++) drop(28 + n, 2.5 + n * 0.3)
      if (t >= 0.3 && t < 3) out.kernel = simple ? 'These are spare copies of files. The originals are on the storage drive, so macOS just clears them.' : 'Clean file-backed pages: the SSD already has the data, so the kernel frees them with no write.'
      else if (t >= 3) out.kernel = simple ? 'Xcode takes the cleared spots. The desk is full again.' : 'Xcode takes the reclaimed frames. Free is back to zero, and so is the file cache.'
      break
    case 2:
      for (const c of chips(t)) if (c.picked) out.pick.push(c.f)
      if (t >= 1.5 && t < 3.2) out.kernel = simple ? 'Mail used its spot 16 again, so it goes back to the busy line.' : 'Frame 16 was referenced while inactive: reactivated, back to the active queue.'
      else if (t >= 3.4) out.kernel = simple ? "The oldest untouched spots, all Safari's, get picked for folding." : 'The head of the inactive queue: Safari pages nobody touched since they aged. These get compressed.'
      break
    case 3: {
      const legs: [number, 'photo' | 'zeros' | 'text', number][] = [
        [8, 'photo', 0.4],
        [7, 'zeros', 1.4],
        [6, 'text', 2.4],
      ]
      const wkAt: [number, number] = [WK.x + WK.w / 2, WK.y + WK.h / 2]
      const lzAt: [number, number] = [LZ.x + LZ.w / 2, LZ.y + LZ.h / 2]
      legs.forEach(([f, kind, at], n) => {
        const dest: [number, number] = [chunkX(n) + chunks[n] / 2, SEG_Y[1] + 13]
        const from = kind === 'photo' ? at + 2.6 : at + 1
        const end = from + 1.2
        if (t >= end) out.seg2.push(chunks[n])
        if (t < at || t >= end) return
        if (t < at + 1) {
          out.tokens.push({ at: along([fc(f), [434, fc(f)[1]], [434, wkAt[1]], wkAt], phase(t, at, at + 1)), label: '16 KB', cls: 'A', w: PAGE_W })
          out.wk ||= t >= at + 0.8
        } else if (t < from) {
          // WKdm can't shrink the photo page, so the hybrid codec tries LZ4. No luck: it is kept whole.
          out.wk ||= t < at + 1.6
          out.lz ||= t >= at + 1.6
          out.tokens.push({ at: along([wkAt, lzAt], phase(t, at + 1.1, at + 1.6)), label: simple ? 'will not fold' : t < at + 1.6 ? 'WKdm: no gain' : 'LZ4: no gain', cls: 'bad', w: 112 })
        } else {
          const w = kind === 'photo' ? PAGE_W : lerp(PAGE_W, chunks[n], phase(t, from, from + 0.4))
          out.wk ||= kind !== 'photo' && t < from + 0.4
          out.tokens.push({
            at: along([kind === 'photo' ? lzAt : wkAt, [dest[0], 186], dest], phase(t, from, end)),
            label: kind === 'zeros' ? '4 B' : kind === 'text' ? `${num(16 / r, 1)} KB` : '16 KB',
            cls: kind === 'photo' ? 'A' : 'small',
            w: Math.max(w, 40),
          })
        }
      })
      if (t >= 2.1 && t < 4.6) out.kernel = simple ? 'The bundles still need room on the desk, so the folding corner takes spot 8.' : 'Compressed data lives in RAM too: segment 2 takes frame 8.'
      else if (t >= 4.6) out.kernel = simple ? 'Three spots went in, one spot holds the bundles: two spots freed.' : 'Three pages in, one frame holds the segment: frames 6 and 7 are free.'
      break
    }
    case 4:
      if (t >= 1.8 && t < 3.8)
        out.tokens.push({ at: along([[SEG_X + SEG_W / 2, SEG_Y[0] + 13], [696, SEG_Y[0] + 13], [696, SWAPFILE_Y(0) + 12], [SSD.x + 148, SWAPFILE_Y(0) + 12]], phase(t, 1.8, 3.8)), label: simple ? 'locked bundle' : 'segment 1', cls: 'seg', w: 110 })
      if (t >= 0.6 && t < 1.8) out.kernel = simple ? 'The oldest bundle gets locked with a key only this Mac knows.' : 'The oldest segment is encrypted with AES-XTS before it leaves RAM (vm_swap_encrypt).'
      else if (t >= 1.8) out.kernel = simple ? 'Then it goes to Overflow Storage on the storage drive, and spot 27 is free.' : 'Written to a swap file in /System/Volumes/VM. Frame 27 is free again.'
      break
    case 5:
      if (t >= 0.1 && t < 0.7) out.fault.push(6)
      if (t >= 0.4 && t < 1.8)
        out.tokens.push({ at: along([[chunkX(2) + tw / 2, SEG_Y[1] + 13], [434, SEG_Y[1] + 13], [434, fc(6)[1]], fc(6)], phase(t, 0.4, 1.8)), label: '16 KB', cls: 'A', w: lerp(40, PAGE_W, phase(t, 0.4, 0.9)) })
      if (t >= 2 && t < 2.6) out.fault.push(7)
      if (t >= 2.2 && t < 4.8)
        out.tokens.push({ at: along([[SSD.x + 148, SWAPFILE_Y(0) + 12], [696, SWAPFILE_Y(0) + 12], [696, SEG_Y[0] + 13], [SEG_X + SEG_W / 2, SEG_Y[0] + 13]], phase(t, 2.2, 4.6)), label: simple ? 'locked bundle' : 'segment 1', cls: 'seg', w: 110 })
      out.seg1 = t >= 4.8 ? 'ram' : 'gone'
      out.lock = t >= 4.8 ? 1 - phase(t, 4.8, 5.2) : 0
      if (t >= 5.3 && t < 6.3) out.tokens.push({ at: along([[SEG_X + 30, SEG_Y[0] + 13], [434, SEG_Y[0] + 13], [434, fc(7)[1]], fc(7)], phase(t, 5.3, 6.3)), label: '16 KB', cls: 'C', w: PAGE_W })
      if (t < 1.9) out.kernel = simple ? 'Safari needs its spot back. It is folded on the desk, so it is unfolded right away.' : 'Fault on a compressed page: decompress it from segment 2 into a free frame. CPU work, no I/O.'
      else if (t < 5.3) out.kernel = simple ? 'Music needs a spot that went to Overflow Storage. It waits for the storage drive.' : 'Fault on a swapped page: the whole segment is read back from the swap file, then decrypted.'
      else out.kernel = simple ? 'Unlocked, unfolded and back on the desk, much later than Safari.' : 'Then the page is decompressed into a frame. Only now can Music carry on.'
      break
    case 6:
      if (t >= 2.6 && t < 3.8) out.kernel = simple ? 'Struggling: macOS ends background helpers that agreed to be closed when idle.' : 'Critical: memorystatus, the jetsam code, kills idle processes that opted in to idle exit.'
      else if (t >= 3.8) out.kernel = simple ? 'If that is still not enough, macOS asks you to quit an app.' : 'Still short: macOS shows the "out of application memory" window and asks you to quit apps.'
      else out.kernel = simple ? 'The desk gets fuller and fuller.' : 'Available memory keeps falling: normal, then warn, then critical.'
      break
  }
  return out
}

const KIND_LABEL = (k: Kind, simple: boolean) =>
  ({ wired: simple ? 'locked' : 'wired', A: 'Safari', B: 'Mail', C: 'Music', N: 'Xcode', file: simple ? 'copy' : 'cached', free: simple ? 'empty' : 'free', cmp: simple ? 'bundles' : 'cmpr' })[k]

function Lock({ x, y, o }: { x: number; y: number; o: number }) {
  if (o <= 0) return null
  return (
    <g className="cs-lock" transform={`translate(${x} ${y})`} opacity={o}>
      <path d="M-4.5 -1 V-5 A4.5 4.5 0 0 1 4.5 -5 V-1" />
      <rect x={-6.5} y={-1} width={13} height={10} rx={2} />
    </g>
  )
}

type SceneProps = { i: number; t: number; f: Frame; r: number; rLive: boolean; swapUsed: number | null; pressure: Pressure | null; simple: boolean }

function Scene(p: SceneProps) {
  const { f, simple, swapUsed } = p
  const word = (tech: string, plain: string) => (simple ? plain : tech)
  // The swap files on this Mac are 1 GB each; fill them in order from the live swap used.
  const fill = (n: number) => (swapUsed == null ? 0 : Math.min(1, Math.max(0, swapUsed / 2 ** 30 - n)))
  let seg1x = SEG_X + 6
  return (
    <svg className="cs-scene" viewBox="0 0 960 548" role="img" aria-label="RAM frames, the compressor and the swap files on the SSD, with pages moving between them">
      <text className="cs-head" x={24} y={56}>
        {word('RAM: 48 frames of 16 KB', 'Desk Space: 48 spots of 16 KB')}
      </text>
      <g className="cs-src">
        <rect x={SRC[0] - 66} y={SRC[1] - 14} width={132} height={28} rx={14} />
        <text x={SRC[0]} y={SRC[1] + 5} textAnchor="middle">
          {simple ? 'Xcode wants room' : 'Xcode allocates'}
        </text>
      </g>
      {f.world.map((k, n) => {
        const r = FR(n)
        return (
          <g key={n} className={`cs-frame k-${k} ${f.hot.includes(n) ? 'hot' : ''} ${f.pick.includes(n) ? 'pick' : ''} ${f.fault.includes(n) ? 'fault' : ''}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
            <text className="cs-frame-n" x={r.x + 5} y={r.y + 13}>
              {n}
            </text>
            <text className="cs-frame-k" x={r.x + r.w / 2} y={r.y + 31} textAnchor="middle">
              {KIND_LABEL(k, simple)}
            </text>
          </g>
        )
      })}

      <g className="cs-box">
        <rect x={CMP.x} y={CMP.y} width={CMP.w} height={CMP.h} rx={12} />
        <text className="cs-head" x={CMP.x + 20} y={CMP.y + 24}>
          {word('Compressor', 'Folding corner')}
        </text>
        <text className="cs-sub" x={CMP.x + 20} y={CMP.y + 42}>
          {word('compressed pages, still in RAM', 'folded bundles, still on the desk')}
        </text>
        <g className={`cs-codec ${f.wk ? 'on' : ''}`}>
          <rect x={WK.x} y={WK.y} width={WK.w} height={WK.h} rx={8} />
          <text x={WK.x + WK.w / 2} y={WK.y + 20} textAnchor="middle">
            WKdm
          </text>
        </g>
        <g className={`cs-codec ${f.lz ? 'on' : ''}`}>
          <rect x={LZ.x} y={LZ.y} width={LZ.w} height={LZ.h} rx={8} />
          <text x={LZ.x + LZ.w / 2} y={LZ.y + 20} textAnchor="middle">
            LZ4
          </text>
        </g>
        <text className="cs-sub" x={SEG_X} y={SEG_Y[0] - 8}>
          {f.seg1 === 'gone' ? word('segment 1: on swap', 'bundle 1: in Overflow Storage') : word('segment 1, in frame 27', 'bundle 1, in spot 27')}
        </text>
        <rect className={`cs-seg ${f.seg1 === 'gone' ? 'gone' : ''}`} x={SEG_X} y={SEG_Y[0]} width={SEG_W} height={26} rx={6} />
        {f.seg1 === 'ram' &&
          SEG1.map((w, n) => {
            const x = seg1x
            seg1x += w + 4
            return <rect key={n} className="cs-chunk C" x={x} y={SEG_Y[0] + 5} width={w} height={16} rx={3} />
          })}
        {f.seg1 === 'ram' && <Lock x={SEG_X + SEG_W - 12} y={SEG_Y[0] + 10} o={f.lock} />}
        <text className="cs-sub" x={SEG_X} y={SEG_Y[1] - 8}>
          {p.i < 3 || (p.i === 3 && p.t < 2.1) ? word('segment 2: empty', 'bundle 2: empty') : word('segment 2, in frame 8', 'bundle 2, in spot 8')}
        </text>
        <rect className="cs-seg" x={SEG_X} y={SEG_Y[1]} width={SEG_W} height={26} rx={6} />
        {f.seg2.map((w, n) => (
          <rect key={n} className="cs-chunk A" x={SEG_X + 6 + f.seg2.slice(0, n).reduce((a, b) => a + b + 4, 0)} y={SEG_Y[1] + 5} width={w} height={16} rx={3} />
        ))}
      </g>

      <g className="cs-box ssd">
        <rect x={SSD.x} y={SSD.y} width={SSD.w} height={SSD.h} rx={12} />
        <text className="cs-head" x={SSD.x + 20} y={SSD.y + 24}>
          {word('Swap files on the SSD', 'Overflow Storage (SSD)')}
        </text>
        <text className="cs-sub mono" x={SSD.x + 20} y={SSD.y + 42}>
          /System/Volumes/VM
        </text>
        {Array.from({ length: SWAPFILES }, (_, n) => (
          <g key={n} className="cs-swapfile">
            <rect x={SSD.x + 20} y={SWAPFILE_Y(n)} width={184} height={24} rx={6} />
            <rect className="fill" x={SSD.x + 20} y={SWAPFILE_Y(n)} width={184 * fill(n)} height={24} rx={6} />
            <text x={SSD.x + 30} y={SWAPFILE_Y(n) + 16}>
              swapfile{n}
            </text>
          </g>
        ))}
        {f.seg1 === 'gone' && !f.tokens.some((t) => t.cls === 'seg') && (
          <g className="cs-swapped">
            <rect x={SSD.x + 122} y={SWAPFILE_Y(0) + 3} width={56} height={18} rx={4} />
            <Lock x={SSD.x + 150} y={SWAPFILE_Y(0) + 10} o={1} />
          </g>
        )}
        <text className="cs-sub" x={SSD.x + 20} y={SSD.y + SSD.h - 14}>
          {swapUsed == null ? word('swap used: n/a', 'in use: n/a') : `${word('Swap used', 'In use')} ${memGB(swapUsed)}, ${word('live', 'right now')}`}
        </text>
      </g>

      <Lower {...p} />

      <g className={`cs-kernel ${f.kernel ? 'on' : ''}`}>
        <rect x={KERNEL.x} y={KERNEL.y} width={KERNEL.w} height={KERNEL.h} rx={8} />
        <text x={KERNEL.x + 14} y={KERNEL.y + 23}>
          <tspan className="cs-kernel-k">{simple ? 'macOS' : 'Kernel'}</tspan> {f.kernel ?? (simple ? 'keeps an eye on how full the desk is' : 'watching the free page count')}
        </text>
      </g>

      {f.tokens.map((tk, n) => {
        const w = tk.w ?? tk.label.length * 8 + 20
        return (
          <g key={n} className={`cs-token ${tk.cls}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
            <rect x={-w / 2} y={-11} width={w} height={22} rx={6} />
            <text y={4} textAnchor="middle">
              {tk.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** A labelled card in the strip under the RAM. */
function Card({ x, w, title, lines }: { x: number; w: number; title: string; lines: string[] }) {
  return (
    <g className="cs-card">
      <rect x={x} y={346} width={w} height={136} rx={10} />
      <text className="cs-card-t" x={x + 16} y={374}>
        {title}
      </text>
      {lines.map((l, n) => (
        <text key={n} className="cs-card-l" x={x + 16} y={400 + n * 22}>
          {l}
        </text>
      ))}
    </g>
  )
}

/** The strip under the RAM: what each step needs beyond the frames. */
function Lower({ i, t, f, r, rLive, pressure, simple }: SceneProps) {
  const word = (tech: string, plain: string) => (simple ? plain : tech)
  switch (i) {
    case 0: {
      const free = f.world.filter((k) => k === 'free').length
      return <Card x={24} w={396} title={word(`Free frames: ${free}`, `Empty spots: ${free}`)} lines={[word('New pages land in free frames first.', 'New things go into empty spots first.'), word('Each one is zero-filled before use.', 'Each spot is wiped clean first.'), word('No free frame left: time to reclaim.', 'No empty spot left: time to make room.')]} />
    }
    case 1: {
      const gone = t < 0.6 ? 0 : Math.min(10, Math.floor((t - 0.6) / 0.12) + 1)
      return <Card x={24} w={396} title={word(`File pages dropped: ${gone}`, `File copies cleared: ${gone}`)} lines={[word('Bytes written to the SSD: 0.', 'Nothing had to be saved first.'), word('Reading the file again would mean', 'If an app needs the file again,'), word('a page-in from the SSD.', 'the Mac fetches it from the SSD.')]} />
    }
    case 2:
      return (
        <g className="cs-queues">
          <text className="cs-sub" x={24} y={354}>
            {word('Active queue: recently used, newest on the left', 'The busy line: used lately, newest on the left')}
          </text>
          <rect className="cs-lane" x={24} y={AQ - 18} width={396} height={36} rx={8} />
          <text className="cs-sub" x={24} y={420}>
            {word('Inactive queue: oldest at the right end', 'The waiting line: oldest at the right end')}
          </text>
          <rect className="cs-lane" x={24} y={IQ - 18} width={396} height={36} rx={8} />
          <text className="cs-sub" x={474} y={420}>
            {word('picked for the compressor', 'picked for folding')}
          </text>
          {chips(t).map((c) => (
            <g key={c.f} className={`cs-chip k-${c.k} ${c.flash ? 'flash' : ''} ${c.picked ? 'picked' : ''}`} transform={`translate(${c.x} ${c.y})`}>
              <rect x={-22} y={-13} width={44} height={26} rx={6} />
              <text y={5} textAnchor="middle">
                {c.f}
              </text>
            </g>
          ))}
          {t >= 1.5 && t < 2.4 && (
            <text className="cs-tag" x={slotX(2)} y={IQ + 34} textAnchor="middle">
              {word('touched!', 'used again!')}
            </text>
          )}
        </g>
      )
    case 3: {
      const rr = num(r, 1)
      return (
        <g>
          <Card x={24} w={290} title={word('Photo page: 16 KB, kept whole', 'Photo: will not fold')} lines={[word('Already compressed data.', 'It is already packed tight,'), word('WKdm and LZ4 both fail,', 'so macOS keeps it'), word('so it is stored as is.', 'as it is.')]} />
          <Card x={334} w={290} title={word('Page of zeros: 4 bytes', 'Blank page: almost nothing')} lines={[word('One repeated 32-bit value:', 'Every word is the same,'), word('the compressor keeps just', 'so a short note saying'), word('that value.', 'so is enough.')]} />
          <Card
            x={644}
            w={292}
            title={word(`Text-like page: ${num(16 / r, 1)} KB`, `Typical page: ${num(16 / r, 1)} KB`)}
            lines={[rLive ? word(`${rr} to 1, this Mac's live average.`, `This Mac's average now: ${rr} to 1.`) : word("About 2 to 1, Apple's figure.", 'About half, Apple says.'), word('WKdm first, LZ4 if WKdm', 'Memory repeats itself a lot,'), word('saves too little.', 'so it usually folds well.')]}
          />
        </g>
      )
    }
    case 4:
      return <Card x={24} w={396} title={word('Segment 1 goes to swap', 'Bundle 1 goes to Overflow Storage')} lines={[word('Whole segments move, not single pages.', 'Whole bundles move, not single pages.'), word('Encrypted first, with AES-XTS.', 'Locked first, so nobody can read it.'), word('Its RAM frame is freed.', 'Its spot on the desk is freed.')]} />
    case 5: {
      const bar = (y: number, k: number, label: string, cls: string) => (
        <g className={`cs-race ${cls}`}>
          <text className="cs-card-l" x={40} y={y - 9}>
            {label}
          </text>
          <rect className="track" x={40} y={y} width={880} height={14} rx={7} />
          <rect className="done" x={40} y={y} width={880 * k} height={14} rx={7} />
        </g>
      )
      return (
        <g>
          <rect className="cs-card-bg" x={24} y={346} width={912} height={136} rx={10} />
          {bar(388, phase(t, 0.1, 1.8), word('Safari, from the compressor: decompress. Done in RAM by a CPU core.', 'Safari, folded on the desk: unfold it. Quick.'), 'fast')}
          {bar(452, phase(t, 2, 6.3), word('Music, from swap: read the segment from the SSD, decrypt, then decompress.', 'Music, in Overflow Storage: fetch, unlock, unfold. Slow.'), 'slow')}
        </g>
      )
    }
    case 6: {
      const live = pressure ? LEVELS.indexOf(pressure) / 2 : 0
      const k = t < 0.4 ? 0 : t < 5 ? phase(t, 0.4, 3.6) : lerp(1, live, phase(t, 5, 6.2))
      const x0 = 40
      const w = 390
      const labels = simple ? PLAIN_LEVEL : LEVELS
      return (
        <g>
          <rect className="cs-card-bg" x={24} y={346} width={912} height={136} rx={10} />
          <text className="cs-card-t" x={x0} y={374}>
            {word('Memory pressure', 'How hard the desk is working')}
          </text>
          {LEVELS.map((l, n) => (
            <g key={l} className={`cs-band ${l}`}>
              <rect x={x0 + (n * w) / 3} y={396} width={w / 3 - 4} height={18} rx={5} />
              <text className="cs-card-l" x={x0 + (n * w) / 3 + w / 6} y={434} textAnchor="middle">
                {labels[n]}
              </text>
            </g>
          ))}
          <path className="cs-needle" d={`M ${x0 + k * (w - 4)} 394 l -7 -12 h 14 Z`} />
          {t >= 5 && pressure && (
            <text className="cs-card-l" x={x0} y={466}>
              {word(`This Mac right now: ${pressure}`, `This Mac right now: ${PLAIN_LEVEL[LEVELS.indexOf(pressure)]}`)}
            </text>
          )}
          <g opacity={phase(t, 2.6, 3.2)}>
            <text className="cs-card-t" x={470} y={374}>
              {word('Jetsam', 'Closing helpers')}
            </text>
            {['idle helper', 'idle daemon', 'idle agent'].map((n, j) => (
              <g key={n} className="cs-jet">
                <rect x={470 + j * 150} y={392} width={140} height={28} rx={7} />
                <text className="cs-card-l" x={540 + j * 150} y={411} textAnchor="middle">
                  {n}
                </text>
                <path d={`M ${476 + j * 150} 416 L ${604 + j * 150} 396`} />
              </g>
            ))}
            <text className="cs-card-l" x={470} y={452}>
              {word('memorystatus ends them to free their memory', 'background helpers that agreed to be closed')}
            </text>
          </g>
          {t >= 3.8 && (
            <g className="cs-dialog" opacity={phase(t, 3.8, 4.4)}>
              <rect x={500} y={96} width={420} height={196} rx={14} />
              <text className="cs-dialog-t" x={710} y={136} textAnchor="middle">
                Your system has run out of
              </text>
              <text className="cs-dialog-t" x={710} y={158} textAnchor="middle">
                application memory.
              </text>
              <text className="cs-dialog-s" x={710} y={190} textAnchor="middle">
                {simple ? 'macOS asks you to quit' : 'Force Quit Applications opens,'}
              </text>
              <text className="cs-dialog-s" x={710} y={210} textAnchor="middle">
                {simple ? 'apps you are not using.' : 'listing apps by memory used.'}
              </text>
              <rect className="cs-dialog-b" x={640} y={234} width={140} height={32} rx={8} />
              <text className="cs-dialog-s" x={710} y={255} textAnchor="middle">
                Force Quit
              </text>
            </g>
          )}
        </g>
      )
    }
  }
  return null
}

// Try it: the toy Mac from compress-sim.ts, drawn as frames, the compressor and the swap space.

const MIXES: { id: Mix; tech: string; plain: string }[] = [
  { id: 'text', tech: 'Text-like', plain: 'Text' },
  { id: 'zeros', tech: 'Zeros', plain: 'Blank pages' },
  { id: 'random', tech: 'Photos, random', plain: 'Photos' },
  { id: 'mixed', tech: 'A mix', plain: 'A mix' },
]

function whatChanged(prev: Sim, cur: Sim, n: number, simple: boolean): string {
  if (n === 0) return simple ? 'No apps open. Plenty of empty spots and some file copies.' : 'No apps open: wired frames, free frames and some cached file pages.'
  if (cur.oom && cur.opened < n)
    return simple
      ? `App ${cur.opened + 1} could not open. The desk, the folding corner and Overflow Storage are all full. A real Mac would ask you to quit something.`
      : `App ${cur.opened + 1} could not open: no free frames, the compressor is full and swap is full. On a real Mac, jetsam and the out of memory window step in.`
  const parts: string[] = []
  const drops = cur.drops - prev.drops
  const comp = cur.compressions - prev.compressions
  const swap = cur.swapouts - prev.swapouts
  if (drops) parts.push(simple ? `cleared ${drops} file copies` : `dropped ${drops} cached file pages`)
  if (comp) parts.push(simple ? `folded ${comp} papers` : `compressed ${comp} pages`)
  if (swap) parts.push(simple ? `moved ${swap} folded papers to Overflow Storage` : `swapped out ${swap} compressed pages`)
  if (!parts.length) return `Opening app ${n}: ${simple ? 'it fit in empty spots.' : 'it fit in free frames.'}`
  return `Opening app ${n}: macOS ${parts.join(', ')}.`
}

function Simulator() {
  const simple = useSimple()
  const word = (tech: string, plain: string) => (simple ? plain : tech)
  const [n, setN] = useState(6)
  const [mix, setMix] = useState<Mix>('text')
  const sim = simulate(n, mix)
  const prev = simulate(Math.max(0, n - 1), mix)
  const r = simRatio(sim)
  const level = LEVELS.indexOf(sim.pressure)
  const cell = (k: number) => ({ x: 20 + (k % 16) * 30, y: 46 + Math.floor(k / 16) * 36 })
  return (
    <section className="card lab-try">
      <h3>{word('Try it: fill a toy Mac', 'Try it: fill a toy desk')}</h3>
      <p className="fine">
        {word(
          `A toy Mac with ${RAM} frames. Each app needs 5 pages. Open apps and watch macOS drop cached pages, compress the oldest app pages, then swap. The newest app is never compressed, because it is in use.`,
          `A toy desk with ${RAM} spots. Each app needs 5. Open apps and watch macOS clear file copies, fold old papers, then use Overflow Storage. The newest app always stays unfolded, because you are using it.`,
        )}
      </p>
      <div className="lab-try-row">
        <label className="lab-field cs-range">
          <span>
            Apps open: <span className="num">{n}</span>
          </span>
          <input type="range" min={0} max={MAX_APPS} step={1} value={n} onChange={(e) => setN(Number(e.currentTarget.value))} aria-valuetext={`${n} apps`} />
        </label>
        <div className="lab-seg" role="group" aria-label="What the apps hold">
          {MIXES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mix === m.id} onClick={() => setMix(m.id)}>
              {simple ? m.plain : m.tech}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-stage cs-sim-stage">
        <svg className="cs-sim" viewBox="0 0 960 214" role="img" aria-label={`Toy RAM with ${sim.opened} apps open: ${sim.cmpSlots} compressor frames, ${sim.swapPages} pages in swap, pressure ${sim.pressure}`}>
          <text className="cs-head" x={20} y={30}>
            {word('RAM', 'Desk Space')}
          </text>
          {sim.slots.map((s, k) => {
            const { x, y } = cell(k)
            return (
              <g key={k} className={`cs-cell ${s.k === 'app' ? `app d-${s.data} ${s.hot ? 'hot' : ''}` : s.k}`}>
                <rect x={x} y={y} width={26} height={32} rx={4} />
                {s.k === 'app' && (
                  <text x={x + 13} y={y + 21} textAnchor="middle">
                    {s.app + 1}
                  </text>
                )}
              </g>
            )
          })}
          <text className="cs-head" x={530} y={30}>
            {word('Compressor', 'Folded')}
          </text>
          {Array.from({ length: COMP_MAX }, (_, k) => (
            <rect key={k} className={`cs-cell ${k < sim.cmpSlots ? 'cmp' : 'empty'}`} x={530 + (k % 5) * 30} y={46 + Math.floor(k / 5) * 36} width={26} height={32} rx={4} />
          ))}
          <text className="cs-sub" x={530} y={140}>
            {sim.inCompressor} {word('pages', 'papers')}
            {r != null ? `, ${num(r, 1)} to 1` : ''}
          </text>
          <text className="cs-head" x={710} y={30}>
            {word('Swap on the SSD', 'Overflow Storage')}
          </text>
          {Array.from({ length: SWAP_MAX }, (_, k) => (
            <rect key={k} className={`cs-cell ${k < Math.ceil(sim.swapUnits - 1e-9) ? 'swap' : 'empty'}`} x={710 + (k % 8) * 30} y={46 + Math.floor(k / 8) * 36} width={26} height={32} rx={4} />
          ))}
          <text className="cs-sub" x={710} y={174}>
            {sim.swapPages} {word('pages swapped out', 'papers moved')}
          </text>
          {LEVELS.map((l, k) => (
            <rect key={l} className={`cs-band ${l} ${k === level ? 'now' : ''}`} x={20 + k * 160} y={190} width={156} height={14} rx={5} />
          ))}
          <text className={`cs-gauge-t ${sim.pressure}`} x={510} y={202}>
            {word('Pressure', 'How hard it works')}: {simple ? PLAIN_LEVEL[level] : sim.pressure}
          </text>
        </svg>
      </div>
      <p className={`lab-verdict ${sim.oom ? 'bad' : sim.swapPages ? '' : 'ok'}`} aria-live="polite">
        {whatChanged(prev, sim, n, simple)}
      </p>
      <p className="fine">
        {word(
          'Toy numbers: a real Mac has about a million frames, and macOS sets pressure from its own counts of available pages. The sizes follow the XNU source: a page of one repeated value takes 4 bytes, data that will not shrink is kept whole, and text-like data is drawn at 2 to 1.',
          'This is a toy with made-up sizes. A real Mac has about a million spots. How blank pages, photos and text fold follows the real macOS code.',
        )}
      </p>
    </section>
  )
}

export default function CompressSwap({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const pg = s.paging ?? null
  const m = s.memory
  const liveRatio = pg && m.compressedBytes > 0 ? pg.compressorStoredBytes / m.compressedBytes : null
  const r = liveRatio != null && liveRatio >= 1 ? liveRatio : 2
  const frames = pg ? hw.memBytes / pg.pageBytes : null
  const level = LEVELS.indexOf(m.pressure)
  const per = (v: number | null | undefined, unit: string) => (v == null ? '' : ` On this Mac right now: ${Math.round(v).toLocaleString('en-US')} ${unit} a second.`)
  const steps: Step[] = [
    {
      title: simple ? 'The empty spots run out' : 'Free pages run out',
      dur: 5.6,
      tech: (
        <p>
          Xcode starts and asks for memory. Each new page goes into a free frame, zero-filled first. Ten pages later there are no free frames left. When the free count drops below the kernel's target, <code>vm_page_free_target</code>, the pageout daemon wakes up and starts reclaiming. This Mac has {frames ? frames.toLocaleString('en-US') : 'about a million'} frames, not 48, but the order of events is the same.
        </p>
      ),
      plain: (
        <p>
          Xcode opens and needs room on the desk. It takes the empty spots one by one until none are left. That is when macOS starts making room. This Mac has {frames ? frames.toLocaleString('en-US') : 'about a million'} spots, not 48, but it happens in the same order.
        </p>
      ),
    },
    {
      title: simple ? 'Clear the file copies' : 'Drop cached file pages',
      dur: 6.2,
      tech: (
        <p>
          The cheapest pages to take are clean copies of files: app code, libraries, documents read recently. The SSD already has every byte, so the kernel frees them with no write. If anything needs them again, that's a page-in from the SSD. This is why a Mac with almost no free memory is fine while plenty is cached: Activity Monitor calls it Cached Files, and it's reclaimable.{per(pg?.pageins, 'page-ins')}
        </p>
      ),
      plain: (
        <p>
          Some of the desk holds spare copies of files, kept in case they're needed again. The originals are safe on the SSD, so macOS can clear them away at once. If a file is needed later, the Mac fetches it again. This is why a nearly full desk isn't a problem by itself.
        </p>
      ),
    },
    {
      title: simple ? 'Pick the papers nobody is using' : 'Pick cold pages',
      dur: 7,
      tech: (
        <p>
          App memory has no copy on the SSD, so it can't just be dropped. The kernel keeps pages on queues, chiefly active and inactive. Pages age from active to inactive. One touched again while inactive goes back to active, which <code>vm_stat</code> counts as reactivated. Pages that reach the head of the inactive queue untouched are the cold ones. XNU's own comment calls this "a reasonable LRU approximation".
        </p>
      ),
      plain: (
        <p>
          Your apps' own papers have no spare copy, so they can't be thrown away. macOS keeps two lines: a busy line of things used lately, and a waiting line. Papers drift from the busy line into the waiting line. If an app uses one again, it jumps back. The ones that reach the end of the waiting line untouched get picked.
        </p>
      ),
    },
    {
      title: simple ? 'Fold them into bundles' : 'The compressor squeezes them',
      dur: 7.2,
      tech: (
        <p>
          On Apple Silicon, XNU compresses with a hybrid codec: WKdm first, built for the word patterns in memory, then LZ4 if WKdm fails or saves too little. A page of one repeated 32-bit value is stored as that value. Data that's already compressed, such as photos, video or encrypted bytes, won't shrink and is stored whole. The results are packed into segments that live in RAM, so here three pages in costs one frame.{liveRatio != null ? ` This Mac's compressor holds ${num(liveRatio, 1)} times the RAM it occupies.` : ''}
          {per(pg?.compressions, 'compressions')}
        </p>
      ),
      plain: (
        <p>
          macOS folds the picked papers into tight bundles that stay on the desk. Ordinary papers fold to about half. A blank page folds to almost nothing. A photo is already packed tight and won't fold, so it's kept as it is. Three papers went in and the bundles fit in one spot, so two spots are free again.
        </p>
      ),
    },
    {
      title: simple ? 'Send bundles to Overflow Storage' : 'Segments go to swap',
      dur: 5.6,
      tech: (
        <p>
          When the compressor itself grows too big, the kernel writes whole segments, oldest first, to swap files in <code>/System/Volumes/VM</code>. Each one is encrypted with AES-XTS first. Compressing first means fewer bytes reach the SSD. The swap files on the right fill from this Mac's live swap use.{per(pg?.swapouts, 'pages swapped out')}
        </p>
      ),
      plain: (
        <p>
          When even the bundles take too much room, macOS locks the oldest bundle and carries it to Overflow Storage, a set of files on the SSD. Its spot on the desk is free again. Folding first means less has to travel. The files on the right fill from this Mac's real Overflow Storage use.
        </p>
      ),
    },
    {
      title: simple ? 'Getting a piece back' : 'Faulting a page back in',
      dur: 7,
      tech: (
        <p>
          When an app touches a page that isn't resident, it faults, as in the virtual memory lab. If the page is in the compressor, the kernel decompresses it into a free frame: CPU work on data already in RAM. If its segment is on swap, the kernel reads the whole segment back from the SSD, decrypts it, then decompresses the page. The app waits the whole time. That wait is what a Mac short of memory feels like.{per(pg?.decompressions, 'decompressions')}
          {per(pg?.swapins, 'swap-ins')}
        </p>
      ),
      plain: (
        <p>
          When an app needs a folded paper, macOS unfolds it right away. That's quick. When it needs one from Overflow Storage, the bundle has to come back from the SSD, be unlocked and unfolded, and the app waits. Lots of that waiting is what makes a Mac feel slow when it's short of Desk Space.
        </p>
      ),
    },
    {
      title: simple ? 'When it gets serious' : 'Memory pressure and jetsam',
      dur: 7,
      tech: (
        <p>
          The kernel sums all this up as a pressure level, <code>kern.memorystatus_vm_pressure_level</code>: normal, warn or critical. Activity Monitor's green, yellow and red graph shows the same thing. At warn, apps are asked to free caches. Near critical, memorystatus, the code still called jetsam, ends idle processes that opted in to idle exit. If memory is still short, macOS shows the "out of application memory" window and asks you to quit apps. This Mac is at {m.pressure} right now.
        </p>
      ),
      plain: (
        <p>
          macOS keeps a simple score of how hard the desk is working: fine, tight or struggling. When it's tight, apps are asked to tidy up. When it's struggling, macOS closes background helpers that agreed to it. If that still isn't enough, a window asks you to quit an app. Right now this Mac is {PLAIN_LEVEL[level]}.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const f = frame(story.i, story.t, simple, r)
  const comp = history.map((x) => x.paging?.compressions ?? null)
  const swaps = history.map((x) => x.memory.swapUsedBytes)
  const legend: [Kind, string, string][] = [
    ['wired', 'wired', 'locked for macOS'],
    ['A', 'app memory', 'apps'],
    ['N', 'new app', 'the new app'],
    ['file', 'cached files', 'file copies'],
    ['cmp', 'compressor', 'bundles'],
    ['free', 'free', 'empty'],
  ]

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          pg == null
            ? 'This reader is older than the paging update, so it sends no compressor counters. Pull the repo and run ./run.sh again.'
            : simple
              ? `The folding ratio is how much room the bundles would take unfolded, divided by the room they take now: ${memGB(pg.compressorStoredBytes)} folded into ${memGB(m.compressedBytes)}.`
              : `Compression ratio = compressorStoredBytes / compressedBytes: the original size of what the compressor holds, ${memGB(pg.compressorStoredBytes)}, over the RAM it occupies, ${memGB(m.compressedBytes)}. vm_stat calls these "stored in" and "occupied by" the compressor.`
        }
      >
        <LiveStat label={simple ? 'Folding' : 'Compressions'} value={pg?.compressions == null ? 'n/a' : `${Math.round(pg.compressions).toLocaleString('en-US')}/s`} sub={<Sparkline values={comp} w={90} h={18} label="Compressions over the last minutes" />} />
        <LiveStat label={simple ? 'Unfolding' : 'Decompressions'} value={pg?.decompressions == null ? 'n/a' : `${Math.round(pg.decompressions).toLocaleString('en-US')}/s`} sub={simple ? 'papers taken back' : 'pages a second'} />
        <LiveStat label={simple ? 'Bundles' : 'Compressed'} value={memGB(m.compressedBytes)} sub={liveRatio == null ? 'ratio n/a' : `${num(liveRatio, 2)} to 1`} />
        <LiveStat label={simple ? 'Overflow Storage' : 'Swap used'} value={memGB(m.swapUsedBytes)} sub={<Sparkline values={swaps} w={90} h={18} label="Swap used over the last minutes" />} />
        <LiveStat label={simple ? 'To and from storage' : 'Swap out / in'} value={pg?.swapouts == null || pg.swapins == null ? 'n/a' : `${num(pg.swapouts)} / ${num(pg.swapins)}`} sub={pg?.swapouts == null || pg.swapins == null ? 'pages a second' : `${bytes((pg.swapouts + pg.swapins) * pg.pageBytes)}/s`} hot={(pg?.swapins ?? 0) > 100} />
        <LiveStat label={simple ? 'How hard it works' : 'Pressure'} value={simple ? PLAIN_LEVEL[level] : m.pressure} hot={m.pressure !== 'normal'} sub={`${memGB(m.freeBytes)} ${simple ? 'empty' : 'free'}`} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene i={story.i} t={story.t} f={f} r={r} rLive={liveRatio != null} swapUsed={m.swapUsedBytes} pressure={m.pressure} simple={simple} />
        </div>
        <ul className="cs-legend" aria-label="Colours">
          {legend.map(([k, tech, plain]) => (
            <li key={k}>
              <i className={`k-${k}`} />
              {simple ? plain : tech}
            </li>
          ))}
        </ul>
        <StepBar story={story} steps={steps} />
      </section>

      <Simulator />

      <Deeper title={simple ? 'Reading the numbers' : 'Reading the compression ratio'}>
        {simple ? (
          <>
            <p>
              Right now this Mac holds {pg ? memGB(pg.compressorStoredBytes) : 'n/a'} of folded papers in {memGB(m.compressedBytes)} of Desk Space. That's {liveRatio == null ? 'a ratio this reader cannot show' : `about ${num(liveRatio, 1)} to 1`}. Apple said folding saves about half when it added it in 2013.
            </p>
            <ul>
              <li>A little Overflow Storage is normal. macOS moves things nobody has touched for hours even when the desk is fine.</li>
              <li>Overflow Storage that keeps growing while you work, with a tight or struggling score, means the desk is too small for what you're doing.</li>
              <li>Quitting apps frees their space at once. The Fill the RAM game in Play lets you watch it happen.</li>
            </ul>
          </>
        ) : (
          <>
            <p>
              Two numbers describe the compressor. <code>compressorStoredBytes</code> is the original size of every page it holds, {pg ? memGB(pg.compressorStoredBytes) : 'n/a'} now. <code>compressedBytes</code> is the RAM it actually occupies, {memGB(m.compressedBytes)}, which Activity Monitor shows as Compressed. The ratio, {liveRatio == null ? 'n/a here' : `${num(liveRatio, 2)} to 1`}, is how much RAM compression is saving. Apple's 2013 claim was about half, so 2 to 1.
            </p>
            <ul>
              <li>A high ratio means lots of zero or repetitive pages. A ratio near 1 means the compressor is full of data it can't shrink, which ends up in swap.</li>
              <li>A steady amount of swap is normal: macOS writes out pages nobody has touched for hours even with memory to spare. Swap that grows while you work, plus warn pressure, means what you're doing needs more than the RAM.</li>
              <li>Swap-ins are the expensive number. A Mac can compress all day without you noticing; reading back from swap is what you feel.</li>
            </ul>
            <p>
              In Terminal, <code>vm_stat</code> shows "Pages stored in compressor" and "Pages occupied by compressor"; divide one by the other. <code>sysctl vm.swapusage</code> shows swap, and <code>ls -lh /System/Volumes/VM</code> lists the swap files. Lesson 8 of the course has more.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Apple, View memory usage in Activity Monitor', url: 'https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac', note: 'App, wired, compressed and cached memory, and what memory pressure is made of.' },
          { title: 'Apple newsroom, OS X Mavericks (2013)', url: 'https://www.apple.com/newsroom/2013/10/23OS-X-Mavericks-Available-Today-Free-from-the-Mac-App-Store/', note: 'Where compressed memory was introduced.' },
          { title: 'Apple XNU source, vm_compressor_algorithms.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_compressor_algorithms.c', note: 'The hybrid codec on arm64: WKdm first, LZ4 when WKdm fails or saves too little.' },
          { title: 'Apple XNU source, vm_compressor.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_compressor.c', note: 'Segments, single-value pages, incompressible pages stored whole, and swapping a whole segment back in.' },
          { title: 'Apple XNU source, vm_compressor_backing_store.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_compressor_backing_store.c', note: 'Swap files, and AES-XTS encryption of each segment before it is written.' },
          { title: 'Apple XNU source, vm_pageout.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_pageout.c', note: 'The active and inactive queues, the free target, and the "reasonable LRU approximation".' },
          { title: 'Apple XNU source, kern_memorystatus.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus.c', note: 'Pressure levels and jetsam kill causes, including idle exit, low swap and compressor space shortage.' },
          { title: 'Arpaci-Dusseau, OSTEP: Beyond Physical Memory: Policies', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf', note: 'Free textbook chapter on LRU and approximations of it.' },
          { title: 'Eclectic Light, Memory Lane: grokking memory problems in Activity Monitor', url: 'https://eclecticlight.co/2022/01/19/memory-lane-grokking-memory-problems-in-activity-monitor/', note: 'Reading compressed memory, swap and pressure without panicking.' },
          { title: 'How-To Geek, Your system has run out of application memory', url: 'https://www.howtogeek.com/836649/how-to-fix-your-system-has-run-out-of-application-memory-on-a-mac/', note: 'The out of memory window and Force Quit Applications.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>sysctl vm.swapusage</code> reported 5120 MB of swap, 3508 MB used, "(encrypted)". <code>ls -lh /System/Volumes/VM</code> listed swapfile0 to swapfile4, 1 GB each. <code>vm_stat</code> showed 516,501 pages stored in 266,192, which is 1.94 to 1. <code>sysctl kern.memorystatus_vm_pressure_level</code> printed 1, normal.
      </p>
    </div>
  )
}
