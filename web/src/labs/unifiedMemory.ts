// Numbers for the Unified memory lab: what a PCIe copy costs and whether a model fits. Pure, so it runs under node:test.

const GiB = 2 ** 30

/** PCIe 4.0: 16 GT/s per lane, 128b/130b encoding, so 16 lanes carry 31.5 GB/s in each direction. */
export const PCIE4_LANE_GBS = (16 * 128) / 130 / 8
export const linkGBs = (lanes: number) => PCIE4_LANE_GBS * lanes

/** Three common cards, one per VRAM size. Bandwidth and lanes from the GeForce 40 series spec tables. */
export const CARDS = [
  { vram: 8 * GiB, name: 'RTX 4060', bwGBs: 272, lanes: 8 },
  { vram: 12 * GiB, name: 'RTX 4070', bwGBs: 504, lanes: 16 },
  { vram: 24 * GiB, name: 'RTX 4090', bwGBs: 1008, lanes: 16 },
] as const

/** Share of RAM Metal recommends the GPU keep in use at once on larger Macs. Secondary source; Apple doesn't publish it. */
export const MAC_GPU_SHARE = 0.75

/** Seconds to move `bytes` at `gbs` decimal gigabytes a second. */
export const seconds = (bytes: number, gbs: number) => bytes / (gbs * 1e9)

/** Bits per weight from llama.cpp's quantize table. */
export const FORMATS = [
  { id: 'F16', bpw: 16 },
  { id: 'Q8_0', bpw: 8.5 },
  { id: 'Q4_K_M', bpw: 4.9 },
] as const

export const modelBytes = (billions: number, bpw: number) => (billions * 1e9 * bpw) / 8

/** A 2D texture with four 8-bit channels and no mipmaps. */
export const textureBytes = (w: number, h: number) => w * h * 4

export type Fit = 'fits' | 'tight' | 'no'

/** A card fits what is smaller than its VRAM; leave nothing for the driver and it still fails, so equal counts as no. */
export const fitsCard = (bytes: number, vram: number): Fit => (bytes < vram ? 'fits' : 'no')

/** On the Mac the GPU can comfortably take about three quarters of RAM; beyond that it competes with everything else. */
export function fitsMac(bytes: number, ram: number): Fit {
  if (bytes <= ram * MAC_GPU_SHARE) return 'fits'
  return bytes < ram ? 'tight' : 'no'
}
