import { AIR, box, geometry, type Rect } from './layout.ts'
import type { View } from './Scene.tsx'

const g = geometry(AIR)
const union = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
}
const panel = box(AIR.panel)

export type PartKey = 'soc' | 'memory' | 'ssd' | 'wifi' | 'power' | 'speakers' | 'battery' | 'trackpad' | 'display' | 'camera'
export type Part = {
  /** Stack layer, bottom case 0 to lid 3. */
  layer: number
  /** Outline in the layer's 600 x 420 box; the close-up centres on it and draws the glow around it. */
  r: Rect
  /** How much of the free view the part's long side takes in its close-up. */
  fill: number
  view: View
  title: string
  plain: string
  text: string
  plainText: string
}

/** Every part the scene can fly to. Positions come from layout.ts, which follows docs/teardown-reference.md. */
export const PARTS: Record<PartKey, Part> = {
  soc: {
    layer: 1,
    r: g.PKG,
    fill: 0.52,
    view: 'chip',
    title: 'Chip',
    plain: 'The brain',
    text: 'CPU, GPU and Neural Engine on one die, with the memory packages beside it on the same substrate. No fan: the heat goes through a thin shield into the case.',
    plainText: 'The Fast Workers, the Eco Workers and the graphics part share one chip, with the Desk Space right beside it. There is no fan, so the case soaks up the heat.',
  },
  memory: {
    layer: 1,
    r: union(g.DRAM),
    fill: 0.55,
    view: 'memory',
    title: 'Unified memory',
    plain: 'Desk Space',
    text: 'Two LPDDR5X packages on the chip package. The CPU and GPU read the same memory, so nothing is copied between separate pools.',
    plainText: 'The Desk Space sits on the chip itself, so every worker reaches it over the same Highway.',
  },
  ssd: {
    layer: 1,
    r: g.NAND,
    fill: 0.34,
    view: 'io',
    title: 'SSD',
    plain: 'Storage',
    text: 'NAND flash soldered to the logic board. The storage controller is inside the M5, not on the flash.',
    plainText: 'Where files and apps live. When the Desk Space fills up, macOS parks things here as Overflow Storage.',
  },
  wifi: {
    layer: 1,
    r: g.WIFI,
    fill: 0.34,
    view: 'io',
    title: 'Wi-Fi and Bluetooth',
    plain: 'Wireless radio',
    text: 'Apple N1: Wi-Fi 7, Bluetooth 6 and Thread. Its antennas sit behind the hinge cover.',
    plainText: 'The radio for Wi-Fi and Bluetooth. Its antennas hide behind the hinge.',
  },
  power: {
    layer: 1,
    r: g.PMU,
    fill: 0.54,
    view: 'power',
    title: 'Power delivery',
    plain: 'Power converter',
    text: 'Two power-management chips, the charger and a bank of inductors turn battery or USB-C power into the voltages the chip runs on.',
    plainText: 'Turns charger and battery power into the small, steady voltages the chip can use.',
  },
  speakers: {
    layer: 1,
    r: union(g.SPEAKERS),
    fill: 0.85,
    view: 'sensors',
    title: 'Speakers',
    plain: 'Speakers',
    text: 'Two speakers, each a woofer and a tweeter, fire into the hinge gap. The top case has no grilles. The drawn speakers pulse here while audio plays.',
    plainText: 'The speakers hide by the hinge and play through the gap under the screen. They glow here while sound plays.',
  },
  battery: {
    layer: 0,
    r: g.TRAY,
    fill: 0.85,
    view: 'battery',
    title: 'Battery',
    plain: 'Battery',
    text: '53.8 Wh in four cells wrapped around the trackpad. The two middle cells are wired in parallel, so the pack behaves like three cells.',
    plainText: 'Four flat cells wrap around the trackpad and hold 53.8 Wh of energy.',
  },
  trackpad: {
    layer: 2,
    r: g.TRACKPAD,
    fill: 0.8,
    view: 'sensors',
    title: 'Trackpad',
    plain: 'Trackpad',
    text: 'Force Touch trackpad with a Taptic Engine along its back edge. It does not move when you click: the engine taps back. Your fingers show here live.',
    plainText: 'There is no real button: a small motor taps back so it feels like a click. Your fingers show here live.',
  },
  display: {
    layer: 3,
    r: panel,
    fill: 0.85,
    view: 'sensors',
    title: 'Display',
    plain: 'Screen',
    text: '13.6-inch Liquid Retina, 2560 x 1664 at 224 ppi. The drawn lid folds with the real hinge angle.',
    plainText: 'The screen. Open or close your lid and the drawing follows.',
  },
  camera: {
    layer: 3,
    r: box(AIR.notch),
    fill: 0.45,
    view: 'sensors',
    title: 'Camera',
    plain: 'Camera',
    text: '12 MP camera in the notch. The lens turns green while an app uses it, like the dot macOS shows.',
    plainText: 'The camera lives in the notch. It turns green here while an app is using it.',
  },
}

/** Several parts can sit under the pointer once layers overlap on screen; the smallest one is the one aimed at. */
export const pickPart = (keys: PartKey[]): PartKey | null =>
  keys.reduce<PartKey | null>((best, k) => (best == null || PARTS[k].r.w * PARTS[k].r.h < PARTS[best].r.w * PARTS[best].r.h ? k : best), null)

/**
 * Text size in layer units that reads at about 10 px when a part's close-up opens, from how much of the view the
 * part fills (about 480 layer units of room on a laptop screen). Smaller notes reward zooming in further.
 */
export const textUnit = (k: PartKey) => Math.max(PARTS[k].r.w, PARTS[k].r.h) / (PARTS[k].fill * 48)
