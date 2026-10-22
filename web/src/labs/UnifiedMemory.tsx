import { useState } from 'react'
import { memGB, pct } from '../format.ts'
import { useSimple } from '../simple.ts'
import { peakBandwidth } from '../story.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { CARDS, FORMATS, fitsCard, fitsMac, linkGBs, modelBytes, seconds, textureBytes, type Fit } from './unifiedMemory.ts'
import './UnifiedMemory.css'

// A PC on the left and this Mac on the right, in one 960 x 470 viewBox. The story moves one model's weights
// through each and keeps a clock for both.

const GiB = 2 ** 30
type Box = { x: number; y: number; w: number; h: number }
type Pt = [number, number]
const mid = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]

const PC = {
  cpu: { x: 30, y: 70, w: 130, h: 64 },
  ram: { x: 30, y: 176, w: 130, h: 132 },
  card: { x: 300, y: 60, w: 160, h: 262 },
  gpu: { x: 322, y: 80, w: 116, h: 64 },
  vram: { x: 322, y: 196, w: 116, h: 110 },
}
const OUT_Y = 218
const BACK_Y = 262
const MAC = {
  pkg: { x: 500, y: 60, w: 440, h: 262 },
  cpu: { x: 518, y: 80, w: 114, h: 56 },
  gpu: { x: 642, y: 80, w: 114, h: 56 },
  ane: { x: 518, y: 148, w: 114, h: 56 },
  media: { x: 642, y: 148, w: 114, h: 56 },
  fabric: { x: 518, y: 222, w: 238, h: 30 },
  pool: { x: 776, y: 80, w: 148, h: 226 },
}
const FAB_Y = MAC.fabric.y + MAC.fabric.h / 2
/** From a block on the chip, down to the fabric, across to the memory pool. */
const toPool = (b: Box): Pt[] => [
  [mid(b)[0], b.y + b.h],
  [mid(b)[0], FAB_Y],
  [MAC.pool.x + 10, FAB_Y],
  [MAC.pool.x + 40, FAB_Y + 20],
]
const fromPool = (b: Box) => [...toPool(b)].reverse()

// The worked example: Llama 3.1 8B at Q4_K_M, 4.58 GiB in llama.cpp's table, on the 24 GB card.
const MODEL = 4.58 * GiB
const CARD = CARDS[2]
const F16_8B = 14.96 * GiB

type Seg = { label: string; s: number; kind: 'copy' | 'work' }
type Token = { at: Pt; kind: 'data' | 'ptr' | 'result'; label?: string }
type Frame = {
  tokens: Token[]
  lit: string[]
  ramFill: number
  vramFill: number
  poolFill: number
  linkOn: boolean
  pc: Seg[]
  mac: Seg[]
  /** 0..1 of the way along the longer clock. */
  clock: number
  pcNote: string
  macNote: string
  capacity: number
  /** Keep the PC's finished clock on screen for comparison. */
  pcFull?: boolean
}

function frame(i: number, t: number, macGBs: number, simple: boolean): Frame {
  const copy = seconds(MODEL, linkGBs(CARD.lanes))
  const pcPass = seconds(MODEL, CARD.bwGBs)
  const macPass = seconds(MODEL, macGBs)
  const f: Frame = { tokens: [], lit: [], ramFill: 0, vramFill: 0, poolFill: 0, linkOn: false, pc: [], mac: [], clock: 0, pcNote: '', macNote: '', capacity: 0 }
  // n data blocks travelling one path, staggered between from and to.
  const stream = (path: Pt[], from: number, to: number, n: number) => {
    for (let j = 0; j < n; j++) {
      const k = phase(t, from + (j * (to - from)) / (n + 2), from + ((j + 3) * (to - from)) / (n + 2))
      if (k > 0 && k < 1) f.tokens.push({ at: along(path, k), kind: 'data' })
    }
  }
  const ramToVram: Pt[] = [[PC.ram.x + PC.ram.w, OUT_Y], [PC.card.x + 22, OUT_Y], mid(PC.vram)]
  const vramToGpu: Pt[] = [[mid(PC.vram)[0], PC.vram.y + 20], [mid(PC.gpu)[0], PC.gpu.y + PC.gpu.h - 10]]
  const back: Pt[] = [[PC.card.x + 22, BACK_Y], [PC.ram.x + PC.ram.w, BACK_Y], [mid(PC.cpu)[0] + 30, BACK_Y], [mid(PC.cpu)[0] + 30, PC.cpu.y + PC.cpu.h]]
  const work = simple ? 'work' : 'GPU pass'
  const copySeg: Seg = { label: simple ? 'carry over' : 'PCIe copy', s: copy, kind: 'copy' }
  switch (i) {
    case 0:
      f.lit = ['pc', 'mac']
      f.pcNote = simple ? 'Two desks, joined by a narrow road' : 'Two memory pools, joined by PCIe'
      f.macNote = simple ? 'One desk that every worker shares' : 'One memory pool in the package'
      break
    case 1:
      f.lit = ['pc-cpu', 'pc-ram', 'mac-cpu', 'mac-pool']
      stream([mid(PC.cpu), mid(PC.ram)], 0.2, 2.6, 5)
      stream(toPool(MAC.cpu), 0.2, 2.6, 5)
      f.ramFill = f.poolFill = phase(t, 0.4, 2.8)
      f.pcNote = simple ? 'The model lands on the main desk' : 'Weights loaded into system RAM'
      f.macNote = simple ? 'The model lands on the shared desk' : 'Weights loaded into unified memory'
      break
    case 2:
      f.lit = ['pc-ram', 'pc-link', 'pc-vram']
      f.ramFill = f.poolFill = 1
      f.linkOn = true
      stream(ramToVram, 0.3, 4.6, 9)
      f.vramFill = phase(t, 0.6, 4.6)
      f.pc = [copySeg]
      f.clock = phase(t, 0.3, 4.6)
      f.pcNote = simple ? 'Carrying every byte over the road' : `Copying ${memGB(MODEL)} over PCIe 4.0 x16`
      f.macNote = simple ? 'Nothing to carry' : 'Nothing to copy'
      break
    case 3:
      f.lit = ['pc-gpu', 'pc-vram', 'pc-link', 'pc-cpu']
      f.ramFill = f.poolFill = f.vramFill = 1
      stream(vramToGpu, 0.2, 2.6, 7)
      if (t > 2.6 && t < 4.3) f.tokens.push({ at: along(back, phase(t, 2.8, 4.2)), kind: 'result', label: simple ? 'answer' : 'result' })
      f.linkOn = t > 2.8 && t < 4.3
      f.pc = [copySeg, { label: work, s: pcPass, kind: 'work' }]
      f.clock = (copy + pcPass * phase(t, 0.2, 2.6)) / (copy + pcPass)
      f.pcNote = simple ? 'Fast work on its own desk, then the answer goes back' : `GPU reads VRAM at ${CARD.bwGBs} GB/s, result returns over PCIe`
      break
    case 4:
      f.lit = ['mac-cpu', 'mac-gpu', 'mac-pool']
      f.ramFill = f.poolFill = 1
      if (t < 1.8) f.tokens.push({ at: along([mid(MAC.cpu), mid(MAC.gpu)], phase(t, 0.3, 1.6)), kind: 'ptr', label: simple ? 'it is here' : 'address' })
      stream(fromPool(MAC.gpu), 1.8, 4.6, 7)
      f.vramFill = 1
      f.pc = [copySeg, { label: work, s: pcPass, kind: 'work' }]
      f.pcFull = true
      f.mac = [{ label: work, s: macPass, kind: 'work' }]
      f.clock = (phase(t, 1.8, 4.6) * macPass) / (copy + pcPass)
      f.macNote = simple ? 'The GPU is told where the model is, and reads it there' : 'The CPU hands over an address; the GPU reads in place'
      break
    case 5:
      f.lit = ['mac-gpu', 'mac-ane', 'mac-media', 'mac-cpu', 'mac-pool']
      f.ramFill = f.poolFill = f.vramFill = 1
      ;[MAC.cpu, MAC.gpu, MAC.ane, MAC.media].forEach((b, n) => stream(fromPool(b), 0.2 + n * 0.25, 3.6, 4))
      f.macNote = simple ? 'Every worker reads from the same desk' : 'CPU, GPU, Neural Engine and media engines share one pool'
      break
    case 6:
      f.lit = ['pc', 'mac']
      f.ramFill = f.poolFill = 1
      f.vramFill = phase(t, 0.3, 4.4)
      f.linkOn = t < 4.4
      f.pc = [copySeg, { label: work, s: pcPass, kind: 'work' }]
      f.mac = [{ label: work, s: macPass, kind: 'work' }]
      f.clock = phase(t, 0.3, 5)
      stream(ramToVram, 0.3, 4.4, 7)
      stream(fromPool(MAC.gpu), 0.3, 1.6, 4)
      f.pcNote = simple ? 'Carry it over, then work' : 'Copy, then one pass over the weights'
      f.macNote = simple ? 'Start work straight away' : 'One pass, no copy'
      break
    case 7:
      f.lit = ['pc-gpu', 'pc-vram', 'mac-gpu', 'mac-pool']
      f.ramFill = f.poolFill = f.vramFill = 1
      f.pc = [copySeg, { label: simple ? '100 rounds of work' : '100 passes', s: pcPass * 100, kind: 'work' }]
      f.mac = [{ label: simple ? '100 rounds of work' : '100 passes', s: macPass * 100, kind: 'work' }]
      f.clock = phase(t, 0.3, 5)
      stream(vramToGpu, 0.3, 5, 9)
      stream(fromPool(MAC.gpu), 0.3, 5, 9)
      f.pcNote = simple ? 'Its own desk is much faster to read' : `VRAM: ${CARD.bwGBs} GB/s`
      f.macNote = simple ? 'The shared desk is slower to read' : `Unified memory: ${macGBs} GB/s`
      break
    case 8:
      f.lit = ['pc-vram', 'mac-pool']
      f.capacity = phase(t, 0.3, 2.4)
      f.ramFill = f.poolFill = f.vramFill = 1
      break
  }
  return f
}

const fmtS = (s: number) => (s < 1e-3 ? `${(s * 1e6).toFixed(0)} µs` : s < 1 ? `${(s * 1e3).toFixed(s < 0.01 ? 1 : 0)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`)

const fitText = (f: Fit, simple: boolean) => (f === 'fits' ? 'fits' : f === 'tight' ? (simple ? 'only just' : 'tight, past ~75%') : 'does not fit')

function Block({ b, name, lit }: { b: Box; name: string; lit: boolean }) {
  return (
    <g className={`um-block ${lit ? 'lit' : ''}`}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9} />
      <text className="um-name" x={b.x + b.w / 2} y={b.y + b.h / 2 + 5} textAnchor="middle">
        {name}
      </text>
    </g>
  )
}

function Mem({ b, k, label, sub, lit }: { b: Box; k: number; label: string; sub: string; lit: boolean }) {
  const inner = { x: b.x + 8, y: b.y + 42, w: b.w - 16, h: b.h - 50 }
  const h = inner.h * k
  return (
    <g className={`um-mem ${lit ? 'lit' : ''}`}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9} />
      {[0, 1, 2, 3].map((n) => (
        <rect key={n} className="um-chip" x={inner.x + (n % 2) * (inner.w / 2 + 3)} y={inner.y + Math.floor(n / 2) * (inner.h / 2 + 3)} width={inner.w / 2 - 3} height={inner.h / 2 - 3} rx={4} />
      ))}
      {k > 0 && <rect className="um-fill" x={inner.x} y={inner.y + inner.h - h} width={inner.w} height={h} rx={4} />}
      <text className="um-name" x={b.x + b.w / 2} y={b.y + 18} textAnchor="middle">
        {label}
      </text>
      <text className="um-sub" x={b.x + b.w / 2} y={b.y + 33} textAnchor="middle">
        {sub}
      </text>
    </g>
  )
}

/** Both clocks on one time scale, filled up to `clock` of the longer one. */
function Clocks({ f, simple }: { f: Frame; simple: boolean }) {
  const total = (s: Seg[]) => s.reduce((a, x) => a + x.s, 0)
  const scale = Math.max(total(f.pc), total(f.mac), 1e-9)
  const lane = (segs: Seg[], x0: number, w: number, y: number, name: string, full = false) => {
    const shown = full ? scale : f.clock * scale
    let at = 0
    return (
      <g>
        <text className="um-clock-name" x={x0} y={y - 8}>
          {name}
        </text>
        <rect className="um-track" x={x0} y={y} width={w} height={24} rx={6} />
        {segs.map((sg, n) => {
          const from = at
          at += sg.s
          const vis = Math.max(0, Math.min(sg.s, shown - from))
          if (!vis) return null
          const sw = Math.max(3, (vis / scale) * w)
          return (
            <g key={n} className={`um-seg ${sg.kind}`}>
              <rect x={x0 + (from / scale) * w} y={y} width={sw} height={24} rx={6} />
              {sw > 100 && (
                <text x={x0 + (from / scale) * w + 8} y={y + 16}>
                  {sg.label}
                </text>
              )}
            </g>
          )
        })}
        <text className="um-clock-t" x={x0 + w} y={y - 8} textAnchor="end">
          {segs.length ? fmtS(Math.min(shown, total(segs))) : simple ? 'nothing to do' : 'idle'}
        </text>
      </g>
    )
  }
  return (
    <g>
      {lane(f.pc, 30, 430, 404, simple ? 'PC clock' : 'PC clock, 24 GB card', f.pcFull)}
      {lane(f.mac, 500, 440, 404, simple ? 'Mac clock' : 'Mac clock')}
    </g>
  )
}

function Capacity({ k, ram, simple }: { k: number; ram: number; simple: boolean }) {
  const top = Math.max(ram, 24 * GiB, F16_8B)
  const bar = (v: number) => Math.max(3, (v / top) * 230 * k)
  const rows: { label: string; v: number; mac: boolean }[] = [
    ...CARDS.map((c) => ({ label: simple ? `${memGB(c.vram, 0)} card` : `${memGB(c.vram, 0)} VRAM`, v: c.vram, mac: false })),
    { label: simple ? 'GPU share' : 'GPU, ~75%', v: ram * 0.75, mac: true },
    { label: simple ? 'Whole desk' : 'All RAM', v: ram, mac: true },
  ]
  const model = (v: number, name: string, x: number, w: number) => {
    const fits = CARDS.filter((c) => fitsCard(v, c.vram) === 'fits').map((c) => memGB(c.vram, 0))
    return (
      <text className="um-cap-note" x={x} y={w}>
        {name}: {fits.length ? `fits ${fits.length === CARDS.length ? 'every card' : `the ${fits.join(' and ')} card${fits.length > 1 ? 's' : ''}`}` : 'fits no card'}; this Mac: {fitText(fitsMac(v, ram), simple)}
      </text>
    )
  }
  let pcRow = 0
  let macRow = 0
  return (
    <g className="um-cap" opacity={k}>
      {rows.map((r, n) => {
        const x = r.mac ? 500 : 30
        const y = 352 + (r.mac ? macRow++ : pcRow++) * 26
        return (
          <g key={n}>
            <text x={x} y={y + 14}>
              {r.label}
            </text>
            <rect className={r.mac ? 'mac' : 'pc'} x={x + 96} y={y + 2} width={bar(r.v)} height={16} rx={4} />
            <text className="um-cap-v" x={x + 102 + bar(r.v)} y={y + 14}>
              {memGB(r.v, 0)}
            </text>
          </g>
        )
      })}
      {model(MODEL, simple ? `Small 8B model, ${memGB(MODEL)}` : `8B Q4_K_M, ${memGB(MODEL)}`, 500, 424)}
      {model(F16_8B, simple ? `Full 8B model, ${memGB(F16_8B)}` : `8B F16, ${memGB(F16_8B)}`, 500, 446)}
    </g>
  )
}

function Scene({ f, chip, ram, simple }: { f: Frame; chip: string; ram: number; simple: boolean }) {
  const on = (id: string) => f.lit.includes(id) || f.lit.includes(id.split('-')[0])
  return (
    <svg className="um-scene" viewBox="0 0 960 470" role="img" aria-label="A PC with a graphics card copying data over PCIe, beside an Apple Silicon Mac whose CPU and GPU share one memory pool">
      <line className="um-divider" x1={480} y1={20} x2={480} y2={360} />
      <text className="um-head" x={245} y={34} textAnchor="middle">
        {simple ? 'A PC with a graphics card' : 'Typical PC with a discrete GPU'}
      </text>
      <text className="um-head" x={720} y={34} textAnchor="middle">
        This Mac, {chip}
      </text>

      <Block b={PC.cpu} name="CPU" lit={on('pc-cpu')} />
      <Mem b={PC.ram} k={f.ramFill} label={simple ? 'Main desk' : 'System RAM'} sub="DDR5" lit={on('pc-ram')} />
      <g className="um-card">
        <rect x={PC.card.x} y={PC.card.y} width={PC.card.w} height={PC.card.h} rx={12} />
        <text className="um-sub" x={PC.card.x + PC.card.w / 2} y={PC.card.y + PC.card.h + 17} textAnchor="middle">
          {simple ? 'graphics card' : `graphics card, ${CARD.name}`}
        </text>
      </g>
      <Block b={PC.gpu} name="GPU" lit={on('pc-gpu')} />
      <line className="um-wide" x1={mid(PC.gpu)[0]} y1={PC.gpu.y + PC.gpu.h} x2={mid(PC.gpu)[0]} y2={PC.vram.y} />
      <text className="um-sub um-bw" x={mid(PC.gpu)[0] + 10} y={(PC.gpu.y + PC.gpu.h + PC.vram.y) / 2 + 4}>
        {CARD.bwGBs} GB/s
      </text>
      <Mem b={PC.vram} k={f.vramFill} label={simple ? 'Its own desk' : 'VRAM'} sub="GDDR6X" lit={on('pc-vram')} />
      <g className={`um-link ${f.linkOn ? 'on' : ''} ${on('pc-link') ? 'lit' : ''}`}>
        <line x1={PC.ram.x + PC.ram.w} y1={OUT_Y} x2={PC.card.x} y2={OUT_Y} />
        <line x1={PC.ram.x + PC.ram.w} y1={BACK_Y} x2={PC.card.x} y2={BACK_Y} />
        <text className="um-name" x={230} y={OUT_Y - 10} textAnchor="middle">
          {simple ? 'Narrow road' : 'PCIe 4.0 x16'}
        </text>
        <text className="um-sub" x={230} y={(OUT_Y + BACK_Y) / 2 + 4} textAnchor="middle">
          31.5 GB/s each way
        </text>
      </g>

      <g className="um-pkg">
        <rect x={MAC.pkg.x} y={MAC.pkg.y} width={MAC.pkg.w} height={MAC.pkg.h} rx={14} />
        <text className="um-sub" x={MAC.pkg.x + MAC.pkg.w / 2} y={MAC.pkg.y + MAC.pkg.h + 17} textAnchor="middle">
          {simple ? 'one chip package' : 'one package: chip and memory together'}
        </text>
      </g>
      <g className="um-fabric">
        {[MAC.cpu, MAC.gpu, MAC.ane, MAC.media].map((b, n) => (
          <line key={n} x1={mid(b)[0] + 30} y1={b.y + b.h} x2={mid(b)[0] + 30} y2={MAC.fabric.y} />
        ))}
        <rect x={MAC.fabric.x} y={MAC.fabric.y} width={MAC.fabric.w} height={MAC.fabric.h} rx={7} />
        <text className="um-sub" x={MAC.fabric.x + MAC.fabric.w / 2} y={FAB_Y + 4} textAnchor="middle">
          {simple ? 'shared hallway' : 'fabric and system level cache'}
        </text>
        <line className="um-wide" x1={MAC.fabric.x + MAC.fabric.w} y1={FAB_Y} x2={MAC.pool.x} y2={FAB_Y} />
      </g>
      <Block b={MAC.cpu} name="CPU" lit={on('mac-cpu')} />
      <Block b={MAC.gpu} name="GPU" lit={on('mac-gpu')} />
      <Block b={MAC.ane} name={simple ? 'AI engine' : 'Neural Engine'} lit={on('mac-ane')} />
      <Block b={MAC.media} name={simple ? 'Video engines' : 'Media engines'} lit={on('mac-media')} />
      <Mem b={MAC.pool} k={f.poolFill} label={simple ? 'Shared desk' : 'Unified memory'} sub={`LPDDR5X, ${memGB(ram, 0)}`} lit={on('mac-pool')} />

      {f.tokens.map((tk, n) =>
        tk.label ? (
          <g key={n} className={`um-token ${tk.kind}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
            <rect x={-tk.label.length * 4 - 9} y={-11} width={tk.label.length * 8 + 18} height={22} rx={11} />
            <text y={4} textAnchor="middle">
              {tk.label}
            </text>
          </g>
        ) : (
          <rect key={n} className={`um-token ${tk.kind}`} x={tk.at[0] - 6} y={tk.at[1] - 6} width={12} height={12} rx={3} />
        ),
      )}

      {f.capacity > 0 ? (
        <Capacity k={f.capacity} ram={ram} simple={simple} />
      ) : (
        <>
          <text className="um-note" x={245} y={366} textAnchor="middle">
            {f.pcNote}
          </text>
          <text className="um-note" x={720} y={366} textAnchor="middle">
            {f.macNote}
          </text>
          <Clocks f={f} simple={simple} />
          {(f.pc.length > 0 || f.mac.length > 0) && (
            <text className="um-sub" x={480} y={455} textAnchor="middle">
              {simple ? 'Real times for an AI model of 4.6 GB, slowed down so you can watch. Both clocks share one scale.' : 'Real times for Llama 3.1 8B at Q4_K_M (4.58 GiB), slowed down. Both clocks share one scale.'}
            </text>
          )}
        </>
      )}
    </svg>
  )
}

type Preset = { id: string; label: string; plain: string; bytes: number }
const PRESETS: Preset[] = [
  { id: '4k', label: '4K texture', plain: '4K picture', bytes: textureBytes(3840, 2160) },
  { id: '8k', label: '8K texture', plain: '8K picture', bytes: textureBytes(7680, 4320) },
  ...[3, 8, 14, 32, 70].flatMap((b) =>
    FORMATS.filter((fm) => fm.id !== 'Q8_0' || b === 8).map((fm) => ({
      id: `${b}${fm.id}`,
      label: `${b}B ${fm.id}`,
      plain: `${b}B AI model, ${fm.id === 'F16' ? 'full' : fm.id === 'Q8_0' ? 'half' : 'small'}`,
      bytes: modelBytes(b, fm.bpw),
    })),
  ),
]

function TryIt({ ram, macGBs, simple }: { ram: number; macGBs: number; simple: boolean }) {
  const [id, setId] = useState('8Q4_K_M')
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]
  const mac = fitsMac(p.bytes, ram)
  const copy16 = seconds(p.bytes, linkGBs(16))
  const passPc = seconds(p.bytes, CARD.bwGBs)
  const passMac = seconds(p.bytes, macGBs)
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: carry it over, or just use it' : 'Try it: copy over PCIe or use it in place'}</h3>
      <p className="fine">
        {simple
          ? 'Pick a picture or an AI model. See how long a PC takes to carry it to the graphics card, how long one full read takes once it is there, and whether it fits.'
          : 'Pick a texture (RGBA, 8 bits a channel, no mipmaps) or a model (parameters times bits per weight, from llama.cpp). Times are size divided by rated bandwidth, so real runs are a little slower.'}
      </p>
      <div className="um-presets" role="group" aria-label={simple ? 'What to move' : 'Data to move'}>
        {PRESETS.map((x) => (
          <button key={x.id} type="button" className="lab-btn" aria-pressed={x.id === id} onClick={() => setId(x.id)}>
            {simple ? x.plain : x.label}
          </button>
        ))}
      </div>
      <div className="um-table-wrap">
        <table className="um-table">
          <thead>
            <tr>
              <th scope="col">{simple ? 'Where it goes' : 'GPU'}</th>
              <th scope="col">{simple ? 'Carry over' : 'Copy first'}</th>
              <th scope="col">One full read</th>
              <th scope="col">Fits?</th>
            </tr>
          </thead>
          <tbody>
            {CARDS.map((c) => {
              const fit = fitsCard(p.bytes, c.vram)
              return (
                <tr key={c.name}>
                  <th scope="row">
                    {memGB(c.vram, 0)} {simple ? 'graphics card' : c.name}
                    <span className="fine"> PCIe x{c.lanes}</span>
                  </th>
                  <td className="num">{fmtS(seconds(p.bytes, linkGBs(c.lanes)))}</td>
                  <td className="num">{fit === 'fits' ? fmtS(seconds(p.bytes, c.bwGBs)) : 'n/a'}</td>
                  <td className={`um-fit ${fit}`}>{fit === 'fits' ? 'fits' : 'too big'}</td>
                </tr>
              )
            })}
            <tr className="um-mac-row">
              <th scope="row">
                {simple ? 'This Mac' : 'This Mac'}
                <span className="fine"> {memGB(ram, 0)} {simple ? 'shared' : 'unified'}</span>
              </th>
              <td className="num">{simple ? 'nothing' : 'none'}</td>
              <td className="num">{mac === 'no' ? 'n/a' : fmtS(passMac)}</td>
              <td className={`um-fit ${mac}`}>{fitText(mac, simple)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`lab-verdict ${mac === 'no' ? 'bad' : 'ok'}`} aria-live="polite">
        {simple
          ? `${memGB(p.bytes)}. A PC needs ${fmtS(copy16)} just to carry it to a fast graphics card. This Mac starts at once, but each full read takes ${fmtS(passMac)} against ${fmtS(passPc)} on the 24 GB card.`
          : `${memGB(p.bytes)}. Copy over x16: ${fmtS(copy16)}. Each pass after that: ${fmtS(passPc)} on the 24 GB card, ${fmtS(passMac)} here at ${macGBs} GB/s. The copy has paid for itself after ${Math.ceil(copy16 / (passMac - passPc))} passes.`}
        {p.bytes >= CARD.vram && mac !== 'no' ? (simple ? ' It does not fit on any of these cards, but it fits on this Mac.' : ' No card here can hold it at all; this Mac can.') : ''}
      </p>
    </section>
  )
}

export default function UnifiedMemory({ hw, s, history, demo }: LabProps) {
  const simple = useSimple()
  const peak = peakBandwidth(hw.chip)
  const macGBs = peak ?? 153
  const ram = hw.memBytes
  const bw = s.memory.bandwidthGBs
  const llm = s.llm?.models.reduce<number | null>((a, m) => (m.vramBytes == null ? a : (a ?? 0) + m.vramBytes), null) ?? null
  const copy = seconds(MODEL, linkGBs(16))
  const passPc = seconds(MODEL, CARD.bwGBs)
  const passMac = seconds(MODEL, macGBs)
  const steps: Step[] = [
    {
      title: simple ? 'Two desks or one' : 'Two designs',
      dur: 2,
      tech: (
        <p>
          A typical gaming or workstation PC has two separate memories. The CPU uses system RAM on the motherboard. The discrete GPU sits on its own card with its own VRAM, joined to the rest of the PC by a PCIe link. This Mac's {hw.chip} has one pool of LPDDR5X memory inside the chip package, {memGB(ram, 0)} here, and every block on the chip reads and writes the same pool.
        </p>
      ),
      plain: (
        <p>
          A typical PC with a graphics card has two desks. The main workers use the main desk. The graphics card has its own desk, and a narrow road joins the two. This Mac has one desk of {memGB(ram, 0)} that every worker on the chip shares.
        </p>
      ),
    },
    {
      title: simple ? 'The model arrives' : 'Loading the weights',
      dur: 3,
      tech: (
        <p>
          The example is Llama 3.1 8B at Q4_K_M, {memGB(MODEL)} of weights in llama.cpp's table. Both machines first read the file from the SSD into the CPU's memory. On the PC that is system RAM. On the Mac it is the unified pool. So far they are even.
        </p>
      ),
      plain: (
        <p>
          The example is an AI model of {memGB(MODEL)}. Both computers first bring it off the SSD onto a desk. The PC puts it on the main desk. The Mac puts it on the shared desk. So far it is a tie.
        </p>
      ),
    },
    {
      title: simple ? 'Carrying it over the road' : 'The copy over PCIe',
      dur: 5,
      tech: (
        <p>
          The PC's GPU can't work from system RAM at full speed, so the program copies every byte into VRAM first. PCIe 4.0 runs each lane at 16 GT/s with 128b/130b encoding, so a x16 slot moves about 31.5 GB/s each way, and {memGB(MODEL)} takes at least {fmtS(copy)}. A card wired for 8 lanes, like the RTX 4060, gets half that. The Mac has nothing to copy.
        </p>
      ),
      plain: (
        <p>
          The graphics card only works fast from its own desk, so the PC carries the whole model over the narrow road first. The road moves about 31.5 GB a second, so this takes at least {fmtS(copy)}. The Mac has nothing to carry.
        </p>
      ),
    },
    {
      title: simple ? 'Fast work, then back again' : 'Work in VRAM, copy the result back',
      dur: 4.4,
      tech: (
        <p>
          Now the GPU reads its VRAM at {CARD.bwGBs} GB/s on an RTX 4090, far faster than a base Mac. One pass over the weights takes {fmtS(passPc)}. Anything the CPU needs back crosses PCIe again in the other direction, so programs work hard to keep data on the card and pay that toll once.
        </p>
      ),
      plain: (
        <p>
          Once the model is on its own desk, the graphics card reads it very fast, much faster than this Mac reads its desk. Anything the main workers need back travels over the road again, so programs try hard to leave things on the card.
        </p>
      ),
    },
    {
      title: simple ? 'Just say where it is' : 'Zero copy: hand over an address',
      dur: 4.8,
      tech: (
        <p>
          On Apple Silicon the CPU and GPU see the same physical memory. With Metal's shared storage mode both use one buffer, so the CPU hands the GPU an address, not a copy, and the GPU starts reading in place. A pass here runs at up to {macGBs} GB/s{peak == null ? ', the M5 figure, since this chip is not in the table' : `, Apple's figure for the ${hw.chip}`}, so it takes {fmtS(passMac)}.
        </p>
      ),
      plain: (
        <p>
          On this Mac the main workers and the graphics workers use the same desk. So the CPU just tells the GPU where the model is, and the GPU starts reading right away. Nothing gets carried anywhere.
        </p>
      ),
    },
    {
      title: simple ? 'Everyone shares' : 'Every engine on one pool',
      dur: 4,
      tech: (
        <p>
          The Neural Engine and the video and image engines read the same pool through the chip's fabric and system level cache, so a camera frame can pass from the image processor to the GPU to the video encoder with no copies. They also share its bandwidth: when one block streams hard, the others get less.{bw == null ? '' : ` Right now all of them together are moving about ${bw.toFixed(0)} GB/s.`}
        </p>
      ),
      plain: (
        <p>
          The AI engine and the video engines use the same desk too. A video frame can pass from one engine to the next without being copied. The catch is that they all share one Highway Speed.{bw == null ? '' : ` Right now they are using about ${bw.toFixed(0)} GB/s of it together.`}
        </p>
      ),
    },
    {
      title: simple ? 'The race: first answer' : 'Race: copy plus one pass',
      dur: 5.4,
      tech: (
        <p>
          To the end of the first pass over the weights, the PC spends {fmtS(copy)} copying and {fmtS(passPc)} working, {fmtS(copy + passPc)} in all. This Mac takes {fmtS(passMac)}. When data changes often, or moves back and forth between CPU and GPU, skipping the copy wins.
        </p>
      ),
      plain: (
        <p>
          Who finishes the first round of work first? The PC spends most of its time on the road. The Mac starts right away and wins this round.
        </p>
      ),
    },
    {
      title: simple ? 'The race: a long job' : 'Race: copy once, 100 passes',
      dur: 5.4,
      tech: (
        <p>
          Generating 100 tokens reads the weights 100 times. The copy happens once, and after that the card's {CARD.bwGBs} GB/s VRAM wins easily: {fmtS(copy + 100 * passPc)} against {fmtS(100 * passMac)} here. That's the honest trade. Discrete GPUs have much more memory bandwidth. Unified memory saves the copies and, as the next step shows, gives the GPU far more room.
        </p>
      ),
      plain: (
        <p>
          Now ask for a long answer, which means reading the model 100 times. The PC carries it over only once, then its fast private desk pulls ahead. A big graphics card really is faster at this, as long as the model fits on its desk.
        </p>
      ),
    },
    {
      title: simple ? 'Will it fit?' : 'Capacity',
      dur: 3,
      tech: (
        <p>
          A model that doesn't fit in VRAM has to stay partly in system RAM and cross PCIe on every pass, which wrecks the speed. Common cards have 8, 12 or 24 GB. On a Mac, Metal lets the GPU keep about 75% of RAM in use, a figure reported by developers rather than published by Apple: about {memGB(ram * 0.75, 0)} on this {memGB(ram, 0)} Mac. Macs with more memory can hold models no card here can. Lesson 10 works through it.
        </p>
      ),
      plain: (
        <p>
          The graphics card's desk holds 8, 12 or 24 GB. If an AI model doesn't fit, it gets very slow. On a Mac the GPU can use about three quarters of the shared desk. Macs with lots of Desk Space can run AI models that won't fit on these graphics cards at all.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const f = frame(story.i, story.t, macGBs, simple)

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          simple
            ? 'Every worker on the chip shares this Highway. The reader cannot see how much of the desk the GPU holds, except for a local AI model.'
            : `Bandwidth is all DRAM traffic from IOReport, every block together${peak == null ? '' : `, against the ${hw.chip}'s ${peak} GB/s peak`}. macOS doesn't report the GPU's share of memory; the reader shows it only for a model loaded in Ollama or LM Studio.`
        }
      >
        <LiveStat
          label={simple ? 'Highway Speed' : 'Memory bandwidth'}
          value={bw == null ? 'n/a' : `${bw.toFixed(1)} GB/s`}
          sub={<Sparkline values={history.map((x) => x.memory.bandwidthGBs)} max={peak ?? undefined} w={90} h={18} label="Memory bandwidth over the last minutes" />}
          hot={bw != null && peak != null && bw > peak * 0.3}
        />
        <LiveStat label={simple ? 'Top Highway Speed' : 'Peak bandwidth'} value={peak == null ? 'n/a' : `${peak} GB/s`} sub={`Apple, ${hw.chip}`} />
        <LiveStat label={simple ? 'Shared desk' : 'Unified memory'} value={memGB(ram, 0)} sub={simple ? 'for every worker' : 'hw.memsize'} />
        <LiveStat label={simple ? 'AI model on GPU' : 'GPU memory, local LLM'} value={memGB(llm)} sub={s.llm ? s.llm.runtime : simple ? 'no AI model running' : 'no runtime found'} />
        <LiveStat label={simple ? 'Graphics busy' : 'GPU busy'} value={pct(s.gpu.usage)} sub={`${hw.gpuCores ?? 'n/a'} ${simple ? 'graphics cores' : 'GPU cores'}`} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene f={f} chip={hw.chip} ram={ram} simple={simple} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <TryIt ram={ram} macGBs={macGBs} simple={simple} />

      <Deeper title={simple ? 'So which is better?' : 'Which design wins'}>
        {simple ? (
          <>
            <p>Neither. It depends on the job.</p>
            <ul>
              <li>A big graphics card reads its own desk much faster. For games, and for AI models that fit on it, that wins.</li>
              <li>One shared desk means nothing is carried back and forth, and the graphics workers can use most of the room. For big AI models, and for apps that pass work between the main workers and the graphics workers, that wins.</li>
              <li>The catch of sharing: every worker uses the same Highway, so one busy worker slows the others.</li>
            </ul>
          </>
        ) : (
          <>
            <p>It depends on the workload, and the numbers above show both sides.</p>
            <ul>
              <li>Bandwidth. High-end cards put a wide GDDR bus right beside the GPU: 1008 GB/s on an RTX 4090, against {macGBs} GB/s on this Mac. Pro and Max chips narrow the gap with wider buses: 307 GB/s on the M5 Pro, 614 GB/s on the M5 Max.</li>
              <li>Copies. Discrete GPUs need data staged across PCIe, which costs time and makes code more complex. On Apple GPUs a shared buffer is visible to the CPU and GPU with no copy, though Metal still offers private storage so the GPU can lay data out its own way.</li>
              <li>Capacity. VRAM is fixed by the card. Unified memory lets the GPU use most of the RAM, which is why Macs run local LLMs that don't fit on consumer cards. Generation speed then follows bandwidth, as lesson 10 explains.</li>
              <li>Sharing. One pool also means one bandwidth budget. Lesson 9 measured the GPU copying at about 125 GB/s alone, and the GPU and CPU together reaching only about 119 GB/s.</li>
            </ul>
            <p>A PC's GPU can also read system RAM directly over PCIe, but then every read runs at PCIe speed, which is why programs copy instead. Laptop PCs with integrated graphics share one RAM like a Mac does.</p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Wikipedia, PCI Express', url: 'https://en.wikipedia.org/wiki/PCI_Express', note: 'PCIe 4.0: 16 GT/s per lane, 128b/130b encoding, 31.5 GB/s each way for x16. PCI-SIG publishes the same rates, but its site refused our automated link check.' },
          { title: 'Wikipedia, GeForce RTX 40 series', url: 'https://en.wikipedia.org/wiki/GeForce_RTX_40_series', note: 'Memory size, bandwidth and lanes: RTX 4060 8 GB, 272 GB/s, x8; RTX 4070 12 GB, 504 GB/s; RTX 4090 24 GB, 1008 GB/s.' },
          { title: 'NVIDIA, GeForce RTX 4090', url: 'https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/', note: '24 GB GDDR6X on a 384-bit bus, PCI Express Gen 4.' },
          { title: 'NVIDIA, How to optimize data transfers in CUDA', url: 'https://developer.nvidia.com/blog/how-optimize-data-transfers-cuda-cc/', note: 'Why host to device copies over PCIe are a bottleneck, and why code keeps data on the GPU.' },
          { title: 'Apple, Choosing a resource storage mode for Apple GPUs', url: 'https://developer.apple.com/documentation/metal/choosing-a-resource-storage-mode-for-apple-gpus', note: 'The unified memory model, and the shared, private and memoryless storage modes.' },
          { title: 'Apple newsroom, M5', url: 'https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/', note: '153 GB/s unified memory bandwidth on the M5. Other chips use the per-chip table from the course.' },
          { title: 'Apple newsroom, M5 Pro and M5 Max', url: 'https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/', note: '307 and 614 GB/s.' },
          { title: 'llama.cpp, quantize README', url: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md', note: 'Bits per weight and sizes for Llama 3.1 8B: 4.58 GiB at Q4_K_M, 14.96 GiB at F16.' },
          { title: 'Note on the macOS Metal working set limit', url: 'https://github.com/ivanopcode/devnote-override-macos-metal-vram-cap', note: 'The roughly 75% of RAM the GPU may keep in use. Secondary; Apple does not publish the rule.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>sysctl hw.memsize</code> prints 17179869184, 16 GB. Lesson 9's GPU copy test reached about 125 GB/s of the M5's 153 GB/s. Times in the scene and the table are size divided by rated bandwidth, so real runs are somewhat slower on both sides.
      </p>
    </div>
  )
}
