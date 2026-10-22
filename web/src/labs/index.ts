import { lazy, type ComponentType } from 'react'
import type { LabProps } from './kit.tsx'

export type LabMeta = {
  id: string
  title: string
  /** The title in Simple mode. */
  plain: string
  blurb: string
  plainBlurb: string
  group: Group
  minutes: number
  /** True when the lab's animation follows live readings from this Mac. */
  live: boolean
  Lab: ComponentType<LabProps>
}

/** Course order: the groups follow the lessons, from bits up to the network. */
export const GROUPS = ['Foundations', 'Processor', 'Memory', 'Apps and storage', 'Talking to the world'] as const
export type Group = (typeof GROUPS)[number]

/** Every lab, sorted into course order below. Each loads only when opened. */
const ALL: LabMeta[] = [
  {
    id: 'virtual-memory',
    title: 'Virtual memory',
    plain: 'Every app gets its own make-believe memory',
    blurb: 'How one address becomes another: page tables, the TLB, page faults, shared libraries and copy on write.',
    plainBlurb: 'Each app thinks it has the whole desk to itself. Watch the Mac keep up the illusion.',
    group: 'Memory',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./VirtualMemory.tsx')),
  },
  {
    id: 'compress-swap',
    title: 'Compression and swap',
    plain: 'When the desk runs out of room',
    blurb: 'What macOS does when RAM runs short: which pages it picks, how the compressor squeezes them, and when they go to swap on the SSD.',
    plainBlurb: 'Watch the Mac fold papers into bundles, then carry bundles to the basement, when the desk gets full.',
    group: 'Memory',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./CompressSwap.tsx')),
  },
  {
    id: 'unified-memory',
    title: 'Unified memory',
    plain: 'One desk for every worker',
    blurb: 'Why a PC copies data to its graphics card and an Apple Silicon Mac does not, and what that means for games and local AI.',
    plainBlurb: 'A PC keeps two desks and copies papers between them. This Mac has one shared desk.',
    group: 'Memory',
    minutes: 10,
    live: true,
    Lab: lazy(() => import('./UnifiedMemory.tsx')),
  },
  {
    id: 'caches',
    title: 'Caches and the memory hierarchy',
    plain: 'Why nearby things are fast',
    blurb: 'Registers, L1, L2, the system level cache, DRAM and the SSD, with their real distances in time, and why access patterns matter.',
    plainBlurb: 'From the hands of a worker to the basement: how far away each kind of memory is, in human time.',
    group: 'Memory',
    minutes: 10,
    live: true,
    Lab: lazy(() => import('./Caches.tsx')),
  },
  {
    id: 'cpu-pipeline',
    title: 'Inside a CPU core',
    plain: 'How a worker gets through instructions',
    blurb: 'Fetch, decode, execute: pipelines, wide superscalar issue, out-of-order execution and branch prediction, with a guess-the-branch game.',
    plainBlurb: 'How one worker reads, understands and does many small jobs at once, and guesses what comes next.',
    group: 'Processor',
    minutes: 14,
    live: true,
    Lab: lazy(() => import('./Pipeline.tsx')),
  },
  {
    id: 'scheduler',
    title: 'Threads and the scheduler',
    plain: 'Who gets to work, and where',
    blurb: 'Processes, threads, quality of service and how macOS places work on performance and efficiency cores.',
    plainBlurb: 'How macOS decides which job runs on a Fast Worker and which on an Eco Worker.',
    group: 'Processor',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./Scheduler.tsx')),
  },
  {
    id: 'core-xray',
    title: 'Core X-ray',
    plain: 'What each worker is doing right now',
    blurb: 'Every core on this Mac, live: load, clock speed, idle states, and the busiest threads with their priorities.',
    plainBlurb: 'Look at each worker in the chip, live, and see what it is busy with.',
    group: 'Processor',
    minutes: 8,
    live: true,
    Lab: lazy(() => import('./CoreXray.tsx')),
  },
  {
    id: 'gpu-parallel',
    title: 'How a GPU thinks',
    plain: 'Thousands of simple helpers',
    blurb: 'Why a GPU runs thousands of threads in lockstep groups, how it draws a frame, and why that suits graphics and AI.',
    plainBlurb: 'A few clever workers against thousands of simple helpers, racing to paint a picture.',
    group: 'Processor',
    minutes: 10,
    live: true,
    Lab: lazy(() => import('./GpuParallel.tsx')),
  },
  {
    id: 'app-launch',
    title: 'What happens when you open an app',
    plain: 'Opening an app, step by step',
    blurb: 'From a click in the Dock to the first frame: launchd, code signing, dyld, page faults and the window server.',
    plainBlurb: 'Everything the Mac does in the second after you click an app.',
    group: 'Apps and storage',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./AppLaunch.tsx')),
  },
  {
    id: 'ssd-flash',
    title: 'How an SSD stores data',
    plain: 'Inside the storage chip',
    blurb: 'Flash cells, pages and blocks, erase before write, the flash translation layer, wear levelling, TRIM and encryption.',
    plainBlurb: 'How the Mac keeps your files in tiny cells that hold an electric charge.',
    group: 'Apps and storage',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./Flash.tsx')),
  },
  {
    id: 'packets',
    title: 'A web page, packet by packet',
    plain: 'How the internet reaches your Mac',
    blurb: 'DNS, TCP, TLS and HTTP: what happens between typing an address and seeing a page, down to the Wi-Fi radio.',
    plainBlurb: 'How a web page travels to your Mac in thousands of small parcels.',
    group: 'Talking to the world',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./Packets.tsx')),
  },
  {
    id: 'bits-bytes',
    title: 'Bits, bytes and text',
    plain: 'How a computer stores anything',
    blurb: 'Binary and hex, how integers and decimals are stored, byte order, and how UTF-8 turns letters and emoji into bytes.',
    plainBlurb: 'Everything in a computer is ones and zeros. See how a number, a letter or a picture becomes them.',
    group: 'Foundations',
    minutes: 12,
    live: true,
    Lab: lazy(() => import('./Bits.tsx')),
  },
]

export const LABS = [...ALL].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))

export const labAt = (hash: string): LabMeta | null => {
  const m = /^#?labs\/([\w-]+)$/.exec(hash)
  return (m && LABS.find((l) => l.id === m[1])) || null
}

/** The labs that animate what each course lesson explains, by lesson number. */
export const LESSON_LABS: Record<number, string[]> = {
  1: ['unified-memory', 'bits-bytes'],
  2: ['cpu-pipeline', 'core-xray', 'caches'],
  3: ['scheduler', 'core-xray'],
  4: ['core-xray'],
  6: ['gpu-parallel'],
  7: ['gpu-parallel'],
  8: ['virtual-memory', 'compress-swap', 'unified-memory'],
  9: ['caches', 'unified-memory'],
  10: ['unified-memory'],
  11: ['ssd-flash', 'app-launch'],
  13: ['packets'],
  15: ['app-launch'],
}

/** The first lesson that lists a lab, so a lab page can point back into the course. */
export function labLesson(id: string): number | null {
  const n = Object.keys(LESSON_LABS)
    .map(Number)
    .sort((a, b) => a - b)
    .find((k) => LESSON_LABS[k].includes(id))
  return n ?? null
}
