import type { Hardware, Sample } from './types.ts'
import { bytes, gpuMhz, memGB, mhz, num, pct, rate, temp, watts } from './format.ts'
import { PLAIN, PLAIN_NOW } from './learn-plain.ts'
import { busy, mediaOf } from './inside.ts'
import { allCoreAvg, byApp, chipLine, clusterAvg, detectStory, largestModel, peakBandwidth, recentAvg, sensorsOf, socW, usedBytes } from './story.ts'

// Every explainer the info buttons open, keyed by topic id. Text in `backticks` renders as code.
// Rules for the copy: a plain summary first, then deeper sections; no invented numbers; estimates say so;
// nothing claims the reader measures what it does not; every topic lists where its facts come from.

export const GROUPS = ['Chip', 'Memory', 'Storage', 'Power and thermals', 'Battery', 'Network', 'Sensors', 'How the reader measures things'] as const
export type Group = (typeof GROUPS)[number]

/** A paragraph, a bulleted list, or numbered steps. */
export type Para = string | string[] | { steps: string[] }
export type Now = { hw: Hardware; s: Sample; history: Sample[] }
export type Source = { title: string; url: string; note: string }
/** The plain-language variant: the same shape as the technical body, without the API detail. */
export type Plain = { summary: string; sections: { h: string; p: Para[] }[]; now?: (x: Now) => string | null }
export type Topic = {
  title: string
  group: Group
  /** Plain words, two or three sentences. A beginner can stop here. */
  summary: string
  /** Ordered from basic to deep: how it works, then numbers, then gotchas. */
  sections: { h: string; p: Para[] }[]
  /** Which API or counter the reader uses, or that it has none. */
  source: string
  /** Where the facts come from. */
  sources: Source[]
  related: string[]
  /** For readers who want everyday words; the explainer falls back to the technical text without it. */
  plain?: Plain
  /** One or two sentences about the current reading. Null when there is nothing live to say. */
  now?: (x: Now) => string | null
}

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
/** Whole minutes of history, at least 1, for "in the last N minutes". */
const span = (h: Sample[]) => Math.max(1, Math.round(h.length / 60))

// Shared references. A topic cites one with the point it supports: cite(R.m5, 'what it backs up').
const R = {
  m1: { title: 'Apple Newsroom: Apple unleashes M1 (2020)', url: 'https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/' },
  m2: { title: 'Apple Newsroom: Apple unveils M2 (2022)', url: 'https://www.apple.com/newsroom/2022/06/apple-unveils-m2-with-breakthrough-performance-and-capabilities/' },
  m3: { title: 'Apple Newsroom: Apple unveils M3, M3 Pro and M3 Max (2023)', url: 'https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max-the-most-advanced-chips-for-a-personal-computer/' },
  m4: { title: 'Apple Newsroom: Apple introduces M4 chip (2024)', url: 'https://www.apple.com/newsroom/2024/05/apple-introduces-m4-chip/' },
  m5: { title: 'Apple Newsroom: Apple unleashes M5 (2025)', url: 'https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/' },
  airSpecs: { title: 'Apple: MacBook Air (13-inch, M5) tech specs', url: 'https://support.apple.com/126320' },
  wikiM1: { title: 'Wikipedia: Apple M1', url: 'https://en.wikipedia.org/wiki/Apple_M1' },
  firestorm: { title: 'Dougall Johnson: Firestorm microarchitecture notes', url: 'https://dougallj.github.io/applecpu/firestorm.html' },
  icestorm: { title: 'Dougall Johnson: Icestorm microarchitecture notes', url: 'https://dougallj.github.io/applecpu/icestorm.html' },
  qosTuning: { title: "Apple Developer: Tuning your code's performance for Apple silicon", url: 'https://developer.apple.com/documentation/apple-silicon/tuning-your-code-s-performance-for-apple-silicon' },
  qosGuide: { title: 'Apple Energy Efficiency Guide for Mac Apps: Prioritize work with quality of service classes', url: 'https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheTaskLevel.html' },
  eclM1: { title: 'The Eclectic Light Company: Scheduling of threads on M1 series chips', url: 'https://eclecticlight.co/2022/01/25/scheduling-of-threads-on-m1-series-chips-second-draft/' },
  eclM4: { title: 'The Eclectic Light Company: Inside M4 chips, CPU core management', url: 'https://eclecticlight.co/2024/12/05/inside-m4-chips-cpu-core-management/' },
  xnuEdge: { title: 'XNU source: Clutch and Edge scheduler design notes', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/doc/scheduler/sched_clutch_edge.md' },
  dvfsWiki: { title: 'Wikipedia: Dynamic voltage scaling', url: 'https://en.wikipedia.org/wiki/Dynamic_voltage_scaling' },
  macmon: { title: 'macmon by vladkens (MIT)', url: 'https://github.com/vladkens/macmon' },
  tbdr: { title: 'Apple Developer: Tailor your apps for Apple GPUs and tile-based deferred rendering', url: 'https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering' },
  storageModes: { title: 'Apple Developer: Choosing a resource storage mode for Apple GPUs', url: 'https://developer.apple.com/documentation/metal/choosing-a-resource-storage-mode-for-apple-gpus' },
  workingSet: { title: 'Apple Developer: MTLDevice recommendedMaxWorkingSetSize', url: 'https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize' },
  agx: { title: 'Asahi Linux: AGX GPU notes', url: 'https://asahilinux.org/docs/hw/soc/agx/' },
  accel: { title: 'Asahi Linux: Apple silicon accelerators', url: 'https://asahilinux.org/docs/hw/soc/accelerators/' },
  codenames: { title: 'Asahi Linux: SoC codenames', url: 'https://asahilinux.org/docs/hw/soc/soc-codenames/' },
  asahiSmc: { title: 'Asahi Linux: System Management Controller', url: 'https://asahilinux.org/docs/hw/soc/smc/' },
  asahiSep: { title: 'Asahi Linux: Secure Enclave Processor', url: 'https://asahilinux.org/docs/hw/soc/sep/' },
  asahiPd: { title: 'Asahi Linux: USB-PD', url: 'https://asahilinux.org/docs/hw/soc/usb-pd/' },
  smcPatch: { title: 'Linux kernel mailing list: Apple silicon SMC driver patch (2025)', url: 'https://lkml.iu.edu/hypermail/linux/kernel/2506.1/03210.html' },
  aneResearch: { title: 'Apple Machine Learning Research: Deploying Transformers on the Apple Neural Engine', url: 'https://machinelearning.apple.com/research/neural-engine-transformers' },
  computeUnits: { title: 'Apple Developer: MLComputeUnits', url: 'https://developer.apple.com/documentation/coreml/mlcomputeunits' },
  cnc: { title: "Chips and Cheese: A brief look at Apple's M2 Pro iGPU", url: 'https://chipsandcheese.com/2023/10/31/a-brief-look-at-apples-m2-pro-igpu/' },
  sep: { title: 'Apple Platform Security: Secure Enclave', url: 'https://support.apple.com/guide/security/secure-enclave-sec59b0b31ff/web' },
  fileVault: { title: 'Apple Platform Security: Volume encryption with FileVault in macOS', url: 'https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web' },
  touchId: { title: 'Apple Platform Security: Touch ID and Face ID security', url: 'https://support.apple.com/guide/security/touch-id-and-face-id-security-sec067eb0c9e/web' },
  footprint: { title: 'macOS footprint(1) manual page', url: 'https://leancrew.com/all-this/man/man1/footprint.html' },
  amMemory: { title: 'Apple: Activity Monitor User Guide, view memory usage', url: 'https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac' },
  amRam: { title: 'Apple: Activity Monitor User Guide, check if your Mac needs more RAM', url: 'https://support.apple.com/guide/activity-monitor/check-if-your-mac-needs-more-ram-actmntr34865/mac' },
  xnuCompressor: { title: 'XNU source: vm_compressor_algorithms.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_compressor_algorithms.c' },
  xnuPressure: { title: 'XNU source: event_private.h (memory pressure levels)', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event_private.h' },
  wiredLimit: { title: 'Devnote: override the macOS Metal VRAM cap', url: 'https://github.com/ivanopcode/devnote-override-macos-metal-vram-cap' },
  llamaBench: { title: 'llama.cpp discussion 4167: performance of llama.cpp on Apple silicon M-series', url: 'https://github.com/ggml-org/llama.cpp/discussions/4167' },
  ollamaApi: { title: 'Ollama API documentation', url: 'https://github.com/ollama/ollama/blob/main/docs/api.md' },
  lmStudioApi: { title: 'LM Studio: REST API endpoints', url: 'https://lmstudio.ai/docs/developer/rest/endpoints' },
  trim: { title: 'The Eclectic Light Company: Caring for SSDs, TRIM, wear levelling and APFS', url: 'https://eclecticlight.co/2019/08/26/caring-for-ssds-trim-wear-levelling-and-apfs/' },
  ifixitM2: { title: 'iFixit: M2 MacBook Air teardown', url: 'https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink' },
  ifixitChips: { title: 'iFixit: MacBook Air M2 logic board chip identification', url: 'https://www.ifixit.com/Teardown/Macbook+Air+(M2+2022)+Logic+Board+and+Chip+Identification/151816' },
  ifixitM5: { title: 'iFixit: MacBook Air 13-inch 2026 (M5) device page', url: 'https://www.ifixit.com/Device/MacBook_Air_13%22_2026_%28M5%29' },
  thermal: { title: 'Apple Developer: ProcessInfo.ThermalState', url: 'https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum' },
  cycles: { title: 'Apple: Determine battery cycle count for Mac laptops', url: 'https://support.apple.com/102888' },
  optimized: { title: 'Apple: About Optimized Battery Charging on your Mac', url: 'https://support.apple.com/102338' },
  wontCharge: { title: "Apple: Mac User Guide, if your battery won't charge completely", url: 'https://support.apple.com/guide/mac-help/mchlbfb7e12a/mac' },
  appleBatteries: { title: 'Apple: Batteries, maximizing performance', url: 'https://www.apple.com/batteries/maximizing-performance/' },
  bu808: { title: 'Battery University BU-808: How to prolong lithium-based batteries', url: 'https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries' },
  xnuRound: { title: 'XNU source: rtsock.c (byte counters rounded for non-platform processes)', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/net/rtsock.c' },
  xnuIfVar: { title: 'XNU source: if_var.h (struct if_data)', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/net/if_var.h' },
  hostInfo: { title: 'Apple Developer: host_processor_info', url: 'https://developer.apple.com/documentation/kernel/1502854-host_processor_info' },
  sysctl3: { title: 'Apple: sysctl(3) manual page', url: 'https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/sysctl.3.html' },
  iokit: { title: 'Apple Developer: IOKit', url: 'https://developer.apple.com/documentation/iokit' },
  audioRunning: { title: 'Apple Developer: kAudioDevicePropertyDeviceIsRunningSomewhere', url: 'https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertydeviceisrunningsomewhere' },
  cmioRunning: { title: 'Apple Developer: kCMIODevicePropertyDeviceIsRunningSomewhere', url: 'https://developer.apple.com/documentation/coremediaio/kcmiodevicepropertydeviceisrunningsomewhere' },
  indicators: { title: 'Apple: Mac User Guide, the recording indicator in the menu bar', url: 'https://support.apple.com/guide/mac-help/mchlp1446/mac' },
  keyboardLight: { title: 'Apple: Mac User Guide, turn keyboard backlighting on or off', url: 'https://support.apple.com/guide/mac-help/mchlp2265/mac' },
  lidSensor: { title: 'LidAngleSensor by Sam Henri Gold (Apache 2.0)', url: 'https://github.com/samhenrigold/LidAngleSensor' },
  lidEngadget: { title: 'Engadget: the 16-inch MacBook Pro has a lid angle sensor (2019)', url: 'https://www.engadget.com/2019/11/20/apple-16-inch-macbook-pro-lid-angle-sensor/' },
  lidRepair: { title: 'Apple: MacBook Pro (14-inch and 16-inch, 2024) lid angle sensor repair notes', url: 'https://support.apple.com/120761' },
  forceTouch: { title: 'iFixit: Force Touch trackpad teardown', url: 'https://www.ifixit.com/News/7084/force-touch-track-pad' },
  micDisconnect: { title: 'Apple Platform Security: Hardware microphone disconnect', url: 'https://support.apple.com/guide/security/hardware-microphone-disconnect-secbbd20b00b/web' },
  cameraCover: { title: "Apple: Don't close your MacBook with a cover over the camera", url: 'https://support.apple.com/102177' },
  triforce: { title: 'Triforce, the Asahi Linux microphone beamformer', url: 'https://github.com/chadmed/triforce' },
  tasAmp: { title: 'Linux kernel mailing list: TAS2764 and TAS2770 support for Apple speaker amp variants (2025)', url: 'https://lkml.iu.edu/2502.1/10763.html' },
  cs42l84: { title: 'Linux kernel mailing list: CS42L84 headphone codec binding (2024)', url: 'https://lkml.rescloud.iu.edu/2410.2/00642.html' },
  coreAudio: { title: 'Apple Developer: Core Audio', url: 'https://developer.apple.com/documentation/coreaudio' },
  videoToolbox: { title: 'Apple Developer: Video Toolbox', url: 'https://developer.apple.com/documentation/videotoolbox' },
  picTypes: { title: 'Wikipedia: Video compression picture types', url: 'https://en.wikipedia.org/wiki/Video_compression_picture_types' },
  macroblock: { title: 'Wikipedia: Macroblock', url: 'https://en.wikipedia.org/wiki/Macroblock' },
  motionComp: { title: 'Wikipedia: Motion compensation', url: 'https://en.wikipedia.org/wiki/Motion_compensation' },
  beamforming: { title: 'Wikipedia: Beamforming', url: 'https://en.wikipedia.org/wiki/Beamforming' },
} as const
const cite = (r: { title: string; url: string }, note: string): Source => ({ ...r, note })

export const TOPICS: Record<string, Topic> = {
  // Chip
  soc: {
    title: 'The chip',
    group: 'Chip',
    summary:
      'The CPU, GPU, Neural Engine, memory controllers, storage controller and a dozen smaller engines all sit on one piece of silicon, the die. The magnified view draws that die live, with the parts the reader can measure lit up.',
    sections: [
      {
        h: 'What you are looking at',
        p: [
          'The die is drawn as blocks: GPU cores on the left, the performance and efficiency CPU clusters along the top, the system level cache in the middle, the Neural Engine on the right, media, display and security blocks below, and the memory interfaces along the bottom edge, which faces the DRAM.',
          'Each core tile brightens with its load and flickers faster when it is busier. Blocks the reader has no counter for (cache, media, display, Secure Enclave, I/O) are drawn dim and still, so you never see a made-up reading.',
        ],
      },
      {
        h: 'Why one chip',
        p: [
          'Putting every block on one die keeps the wires between them short. A short wire costs less energy per bit and adds less delay, so the CPU and GPU can share data through the same cache and memory instead of copying it across a bus.',
          'The cost is that nothing can be upgraded later. CPU, GPU and memory are chosen together when the Mac is built.',
          'Apple calls this a system on a chip. Its M1 announcement in 2020 listed what went on the die besides the cores: a storage controller with AES encryption hardware, the Secure Enclave, an image signal processor for the camera and a Thunderbolt controller.',
        ],
      },
      {
        h: 'Numbers for the M5',
        p: [
          [
            'Process: what Apple calls third-generation 3-nanometer technology.',
            'CPU: up to 10 cores, four performance and six efficiency. On the M5 MacBook Air spec sheet Apple calls the fast ones super cores.',
            'GPU: 8 or 10 cores depending on the model, each with a Neural Accelerator.',
            'Neural Engine: 16 cores.',
            'Memory bandwidth: 153 GB/s.',
          ],
          'For comparison, the M1 in 2020 was built on a 5-nanometer process with 16 billion transistors and 68 GB/s of memory bandwidth.',
        ],
      },
      {
        h: 'The package',
        p: [
          'The die shares a small substrate with the DRAM packages, which sit right beside it. Every base M-series MacBook Air torn down so far has two DRAM packages next to the die. On the logic board the package sits under a thin metal shield near the hinge.',
        ],
      },
      {
        h: 'How accurate the drawing is',
        p: [
          "Apple has not published a labelled die shot of the base M5. The block plan follows Apple's labelled M3 and M4 renders, adjusted for the M5's block counts. Positions and sizes are estimates. The core counts come from your Mac.",
          'Internally the base M5 is the T8142, codename Hidra. You can see that name in the power controller driver the reader finds, `AppleT8142CLPC`.',
        ],
      },
    ],
    source:
      'The chip name is the `machdep.cpu.brand_string` sysctl. Core counts come from `hw.perflevel0.physicalcpu` and the slower perflevels, and the GPU core count from the `gpu-core-count` property of `AGXAccelerator` in the IOKit registry. macOS gives the reader no Neural Engine core count, so that block is drawn as one piece.',
    sources: [
      cite(R.m5, 'M5 process, core counts, Neural Accelerators, 16-core Neural Engine, 153 GB/s.'),
      cite(R.airSpecs, 'The M5 Air: 4 super cores and 6 efficiency cores, 8 or 10 GPU cores.'),
      cite(R.m1, 'What Apple put on the M1 die, 5 nm, 16 billion transistors.'),
      cite(R.wikiM1, 'M1 memory bandwidth of 68.25 GB/s on a 128-bit bus.'),
      cite(R.codenames, 'T8142 is the M5, codename Hidra.'),
    ],
    related: ['p-cores', 'e-cores', 'gpu', 'neural-engine', 'unified-memory', 'layout'],
    now: ({ hw, s }) => {
      const w = socW(s)
      const gpu = hw.gpuCores == null ? 'no GPU core count' : `${hw.gpuCores} GPU cores`
      return `This Mac reports an ${hw.chip} with ${hw.pCores} performance cores, ${hw.eCores} efficiency cores and ${gpu}. ${
        w == null ? 'The reader cannot read chip power here, so it shows n/a.' : `CPU, GPU and Neural Engine together draw ${watts(w)} right now.`
      }`
    },
  },
  'p-cores': {
    title: 'Performance cores',
    group: 'Chip',
    summary:
      'The big CPU cores. They run at higher clocks and get more done per clock than the efficiency cores, and they spend more energy on every instruction. macOS wakes them for work you are waiting on.',
    sections: [
      {
        h: 'What they are',
        p: [
          'A performance core is a wide out-of-order design. It decodes several instructions every cycle, keeps hundreds of them in flight while it waits on memory, and runs them in whatever order their inputs become ready. That is what makes one thread fast.',
          'The P-cores sit together in a cluster that shares a large L2 cache. The cluster runs at one clock, so its cores speed up and slow down together. A cluster with nothing to run drops to idle and can shut down.',
        ],
      },
      {
        h: 'How wide',
        p: [
          'Apple publishes nothing about its core designs. Outside measurements fill the gap. Dougall Johnson measured the M1 performance core (Firestorm) at eight instructions per cycle, with retire queues of roughly 330 and 620 entries, so several hundred instructions can be in flight at once. It has 14 execution units: 6 integer, 4 load and store, 4 floating point and vector.',
          'On the M1 the four P-cores shared a 12 MB L2 cache. Later chips changed sizes and Apple does not list them.',
        ],
      },
      {
        h: 'Why two kinds of core',
        p: [
          'Power rises much faster than speed. More single-thread speed takes a wider core and a higher voltage, and both cost energy on every instruction. Most of what a Mac does all day (mail sync, indexing, a page sitting open) does not need that speed. Running it on small cores and keeping the big ones asleep saves energy, which on an Air means battery life and less heat.',
        ],
      },
      {
        h: 'When they wake',
        p: [
          'macOS sends work here when it is urgent and heavy: the app you are using, a build you started, an export you are waiting on. When the work ends the cluster drops back to idle. That is why the P-cores jump to 100% for a moment and fall back to near zero.',
          'Howard Oakley at eclecticlight.co measured the M4 P-cluster: with one busy thread it ran at its top frequency of 4512 MHz, and as more cores in the cluster got busy it stepped down toward about 3852 MHz. On this M5 the reader has seen the P-cluster at 4464 MHz with four busy loops.',
        ],
      },
      {
        h: 'About the names',
        p: [
          'Apple has changed core names between generations, and the M5 MacBook Air spec sheet calls the fast cores super cores. Some chips add a middle tier. This app calls the fastest tier P and every slower tier E, using the cluster type macOS gives each CPU.',
        ],
      },
    ],
    source:
      'Per-core load comes from `host_processor_info` with `PROCESSOR_CPU_LOAD_INFO`, which counts user, system, nice and idle ticks for each CPU. Which CPU is a P-core comes from the `cluster-type` property of each CPU entry in the IOKit registry.',
    sources: [
      cite(R.firestorm, 'Firestorm width, retire queues and execution units, measured on the M1.'),
      cite(R.wikiM1, 'M1 cache sizes: 12 MB L2 shared by the P-cores.'),
      cite(R.eclM4, 'M4 P-cluster frequencies and how the cluster clock follows load.'),
      cite(R.airSpecs, 'Apple calls the M5 Air fast cores super cores.'),
    ],
    related: ['e-cores', 'scheduling', 'dvfs', 'cpu-usage'],
    now: ({ hw, s }) => {
      const p = clusterAvg(s, 'P')
      if (p == null) return 'The reader reports no performance cores on this Mac.'
      const read = p < 0.1 ? 'They are mostly parked, which is normal when nothing heavy runs.' : p > 0.7 ? 'They are carrying a heavy job.' : 'They are handling bursts of work.'
      return `Your ${hw.pCores} P-cores average ${pct(p)} busy, with the cluster at ${mhz(s.cpu.pFreqMHz)}. ${read}`
    },
  },
  'e-cores': {
    title: 'Efficiency cores',
    group: 'Chip',
    summary: 'The small CPU cores. They do most of the background work, at a fraction of the power of a performance core.',
    sections: [
      {
        h: 'What they are',
        p: [
          'An efficiency core is narrower. It handles fewer instructions per cycle, keeps fewer in flight and runs at lower clocks. It is also much smaller, so the die fits more of them in less space. The E-cores share their own L2 cache and their own clock.',
          'Dougall Johnson measured the M1 efficiency core (Icestorm) at four instructions retired per cycle, half the P-core, with a retire queue of about 60 entries. On the M1 the four E-cores shared a 4 MB L2.',
        ],
      },
      {
        h: 'What runs here',
        p: [
          'Work marked as background stays on the E-cores: Spotlight indexing, Time Machine backups, photo analysis and iCloud sync. Light threads of ordinary apps often run here too, and move to the P-cores when they need more speed.',
        ],
      },
      {
        h: 'Clocks',
        p: [
          'On the M4, eclecticlight.co measured E-cores at about 1020 MHz when they run only background threads, and at their maximum of 2592 MHz when they run higher priority work. Background work runs slow on purpose, because a low clock allows a low voltage.',
        ],
      },
      {
        h: 'Reading the percentage',
        p: [
          'An E-core at 100% does much less work than a P-core at 100%. The percentage is time busy, not work done. A busy E-cluster with idle P-cores is usually the cheapest way for the Mac to get background work done.',
        ],
      },
    ],
    source: "The same as the performance cores: `host_processor_info` ticks per CPU, split into P and E by each CPU's `cluster-type` in the IOKit registry.",
    sources: [
      cite(R.icestorm, 'Icestorm width and retire queue, measured on the M1.'),
      cite(R.wikiM1, 'M1 E-cluster: 4 MB shared L2.'),
      cite(R.eclM4, 'M4 E-core frequencies for background and higher priority threads.'),
      cite(R.eclM1, 'Background threads are confined to the E-cores.'),
    ],
    related: ['p-cores', 'scheduling', 'dvfs', 'cpu-usage'],
    now: ({ hw, s }) => {
      const e = clusterAvg(s, 'E')
      const p = clusterAvg(s, 'P') ?? 0
      if (e == null) return 'The reader reports no efficiency cores on this Mac.'
      const read = e > 0.3 && p < 0.15 ? ' That is background work kept off the performance cores.' : ''
      return `Your ${hw.eCores} E-cores average ${pct(e)} busy at ${mhz(s.cpu.eFreqMHz)}.${read}`
    },
  },
  scheduling: {
    title: 'How macOS decides where work runs',
    group: 'Chip',
    summary:
      'Every thread carries a quality of service class that says how much you are waiting on it. The kernel scheduler and a power controller called CLPC use it, along with how hard the thread works, to choose a core type and a clock.',
    sections: [
      {
        h: 'Quality of service',
        p: [
          'Apps label their work with a QoS class. From most to least urgent, with the examples Apple gives:',
          [
            'User interactive: the main thread, refreshing the interface, animations. Should be instant.',
            'User initiated: something you asked for and are waiting on, like opening a saved document. A few seconds or less.',
            'Default: work with no stated class, treated between the two above and utility.',
            'Utility: jobs with a progress bar, like downloading or importing data. Seconds to minutes.',
            'Background: work you did not ask for and will not see, like indexing, syncing and backups. Minutes to hours.',
          ],
          'Developers set it through Grand Central Dispatch queues, Swift concurrency task priorities, operation queues or pthread attributes. The class says how much the user is waiting, not how heavy the work is.',
        ],
      },
      {
        h: 'Where each class may run',
        p: [
          "Apple's developer documentation says only that on Apple silicon the system is more likely to run background tasks on the efficiency cores. Measurements go further. Howard Oakley found that threads at background QoS run only on the E-cores, even when every P-core is idle. That is why Spotlight or Time Machine never makes the Mac feel slow, and also why they take a while.",
          'Higher classes may run on either cluster. Demanding threads go to the P-cores first and spill onto the E-cores when every P-core is taken.',
        ],
      },
      {
        h: 'The scheduler and CLPC',
        p: [
          "Two parts of macOS share the decision. XNU, Apple's open source kernel, has a scheduler mode for chips with more than one kind of cluster, called the Edge scheduler. A separate performance controller, CLPC, watches groups of related threads (Apple calls them thread groups) and gives the scheduler a recommended cluster for each, down to each QoS level. CLPC also picks the cluster clocks.",
          'CLPC stands for Closed Loop Performance Controller. Closed loop means it measures the effect of each choice and corrects. Its driver is closed source; on this Mac it is `AppleT8142CLPC`.',
        ],
      },
      {
        h: 'Try it',
        p: [
          'Run a long job at background priority, for example `taskpolicy -c background swift build`, and watch the E-cores fill while the P-cores stay dark. The same command without it lights up the P-cores. The per-core strips in the Chip panel show it well.',
          'On this M5 the check was simple: three `taskpolicy -c background` busy loops kept cores 0 to 5 (the E-cores) busy at about 1.3 GHz, and four normal busy loops took cores 6 to 9 (the P-cores) to 100% at 4464 MHz.',
        ],
      },
      {
        h: 'Gotchas',
        p: [
          'Apps that set thread priorities by hand with older calls such as `setpriority` get less predictable placement. Apple asks developers to use QoS instead.',
          '`taskpolicy -c background` clamps every thread of a process to background, whatever QoS the app asked for. That is how the Try it above works.',
        ],
      },
    ],
    source:
      'The reader does not see QoS or thread placement directly. You see the effect: per-core busy time from `host_processor_info`, split into P and E by `cluster-type`. The reader does find the `AppleCLPC` driver, to read its energy counters.',
    sources: [
      cite(R.qosGuide, 'The QoS classes, their examples and how long each kind of work takes.'),
      cite(R.qosTuning, 'Apple: background tasks are more likely to run on lower performance cores; use QoS instead of setpriority.'),
      cite(R.eclM1, 'Background QoS threads never run on P-cores, even when they are idle.'),
      cite(R.xnuEdge, 'The Edge scheduler, thread groups and CLPC cluster recommendations.'),
    ],
    related: ['p-cores', 'e-cores', 'dvfs', 'processes'],
    now: ({ hw, s }) => `P-cluster ${pct(clusterAvg(s, 'P'))} busy, E-cluster ${pct(clusterAvg(s, 'E'))}. ${chipLine(s, hw)}`,
  },
  'cpu-usage': {
    title: 'CPU usage',
    group: 'Chip',
    summary: 'The share of the last second each core spent running something. The rail shows the average over every core.',
    sections: [
      {
        h: 'How it is counted',
        p: [
          'The kernel keeps four tick counters for each CPU: user, system, nice and idle. Once a second the reader takes the change since the last reading. Busy is user plus system plus nice, divided by all four.',
          "The rail's CPU figure is the plain mean over every core. On a 10-core Mac, two cores flat out and the rest idle reads 20%.",
        ],
      },
      {
        h: 'What it does not tell you',
        p: [
          'Busy time is not work done. A core at 100% at a low clock does less than a core at 50% at its top clock, and an E-core does less per cycle than a P-core. Read the cluster clocks and power next to the percentage to see how hard the chip is really working.',
        ],
      },
      {
        h: 'Process percentages',
        p: ['The process lists use another scale: 100% means one full core, so a process using four cores shows 400%. Activity Monitor and `top` count the same way.'],
      },
      {
        h: 'Gotchas',
        p: [
          'One second is a long time for a CPU. A core that ran fifty 10 ms bursts reads 50%, the same as one that ran half a second straight.',
        ],
      },
    ],
    source: '`host_processor_info(PROCESSOR_CPU_LOAD_INFO)`, a Mach call any process can make without special rights.',
    sources: [cite(R.hostInfo, 'The Mach call that returns per-processor tick counts.'), cite(R.eclM4, 'E-cores and P-cores run at very different clocks, so equal percentages are unequal work.')],
    related: ['p-cores', 'e-cores', 'processes', 'dvfs'],
    now: ({ s }) => `All ${s.cpu.cores.length} cores average ${pct(allCoreAvg(s))}: P-cores ${pct(clusterAvg(s, 'P'))}, E-cores ${pct(clusterAvg(s, 'E'))}.`,
  },
  dvfs: {
    title: 'Cluster clocks and DVFS',
    group: 'Chip',
    summary:
      'Each CPU cluster and the GPU change clock speed many times a second. A lower clock allows a lower voltage, and lower voltage saves far more power than the speed it gives up.',
    sections: [
      {
        h: 'Voltage and frequency',
        p: [
          "A chip's switching power is roughly capacitance times voltage squared times frequency. Running faster needs a higher voltage so the transistors switch in time, so power grows faster than speed. Near the top of the range a small gain in clock costs a large gain in watts.",
          'Dynamic voltage and frequency scaling (DVFS) means picking a voltage and clock pair from a fixed table, moment to moment, so the work gets done at the lowest energy.',
        ],
      },
      {
        h: 'The table',
        p: [
          'Your Mac stores those tables in the IOKit registry, on the power manager node `pmgr`, as pairs of frequency and voltage. A cluster can only run at those steps. The reader reads the tables once at start so it can turn time spent in each state into megahertz.',
        ],
      },
      {
        h: 'How the number is made',
        p: [
          "IOReport reports how long each core spent in each performance state during the last second. The reader weights each state's frequency by the time spent in it, across every core of the cluster, counting only active time.",
          'So the figure is the average clock while the cores were running, not an average that includes idle. An idle cluster shows its lowest table step.',
        ],
      },
      {
        h: 'Numbers',
        p: [
          'On the M4, eclecticlight.co measured E-cores from about 1020 MHz to 2592 MHz and P-cores up to 4512 MHz. On this M5 the reader has seen the P-cluster top step at 4464 MHz. On this Mac at idle the GPU sat near 340 MHz or switched off entirely, which the page shows as off.',
        ],
      },
      {
        h: 'Why the clock drops in long jobs',
        p: [
          'Under a long heavy load the Air cannot shed heat as fast as the chip makes it. The power controller then picks lower steps to stay within its limits. Watch the P-cluster clock during a long export: it starts high and settles lower.',
        ],
      },
    ],
    source:
      'IOReport group `CPU Stats`, subgroup `CPU Core Performance States`, for the CPU clusters, and `GPU Stats` channel `GPUPH` for the GPU. Frequency tables from the `voltage-states` properties on `pmgr` in the IOKit registry.',
    sources: [
      cite(R.dvfsWiki, 'Dynamic power scales with voltage squared times frequency.'),
      cite(R.eclM4, 'Measured M4 E-core and P-core frequency ranges.'),
      cite(R.macmon, 'Reading DVFS tables from pmgr and residencies from IOReport without root.'),
    ],
    related: ['p-cores', 'cooling', 'ioreport', 'power'],
    now: ({ s, history }) => {
      const pF = s.cpu.pFreqMHz
      if (pF == null && s.cpu.eFreqMHz == null) return 'The reader cannot read cluster clocks on this Mac, so they show n/a.'
      const top = Math.max(0, ...history.map((x) => x.cpu.pFreqMHz ?? 0))
      const peak = top > 0 ? ` The highest P-cluster clock in the last ${span(history)} min was ${mhz(top)}.` : ''
      return `P-cluster ${mhz(pF)}, E-cluster ${mhz(s.cpu.eFreqMHz)}, GPU ${gpuMhz(s.gpu.freqMHz)}.${peak}`
    },
  },
  gpu: {
    title: 'GPU',
    group: 'Chip',
    summary: 'The graphics processor draws the screen, runs games and Metal apps, and does most of the math for local AI models. It reads the same memory as the CPU.',
    sections: [
      {
        h: 'How it is built',
        p: [
          'The GPU is made of cores, and each core has many arithmetic units that run the same instruction on many pieces of data at once. That suits pixels, vertices and matrices, where the same step repeats over a lot of data.',
          'Apple sells some chips with a few GPU cores turned off. The M5 MacBook Air comes with 8 or 10 GPU cores. Your Mac reports how many it has enabled.',
          "The GPU runs its own firmware on a small control processor. Apple's driver talks to that firmware through shared memory, and the GPU uses the same page tables and 16 KB pages as the CPU. Asahi Linux documented this while writing a driver for it.",
        ],
      },
      {
        h: 'Tile-based deferred rendering',
        p: [
          'Apple GPUs split the frame into small tiles and give each tile to a core. For each tile the GPU first works out which triangles are visible, then shades only those, in fast on-chip tile memory, and writes the finished tile to main memory once. Apple says this saves time, energy and memory bandwidth compared with a GPU that shades every triangle as it arrives.',
        ],
      },
      {
        h: 'Unified memory',
        p: [
          "A discrete graphics card has its own memory and gets data over PCIe, so textures and buffers are copied across. Here the GPU reads the same DRAM as the CPU. A Metal buffer in shared storage, the default, is one block of memory both can use, with no copy.",
          "There is still a limit. Metal reports a recommended working set below total RAM (`recommendedMaxWorkingSetSize`), and llama.cpp prints it when it starts. Community guides put it at around 75% of RAM on larger Macs.",
        ],
      },
      {
        h: 'Neural Accelerators',
        p: [
          'Apple says each GPU core in the M5 includes a Neural Accelerator, hardware for the matrix math in machine learning. Developers can program them through the Tensor APIs in Metal 4, and apps using Core ML, Metal Performance Shaders or Metal 4 get them without changes.',
        ],
      },
      {
        h: 'What the usage figure means',
        p: [
          'GPU usage here is the share of the last second the GPU spent in an active power state. It is not how much of each core was used. A GPU that wakes for every frame of a light animation can show a high share at a low clock. Read it with the GPU clock and GPU power.',
        ],
      },
    ],
    source:
      'IOReport `GPU Stats`, channel `GPUPH`: time spent in each GPU performance state. Usage is time outside the off state, and the clock is the time-weighted average of the active states. A clock of 0 MHz shows as off. Core count from `gpu-core-count` on `AGXAccelerator`.',
    sources: [
      cite(R.tbdr, 'How tile-based deferred rendering works and what it saves.'),
      cite(R.storageModes, 'Shared storage is the default and both CPU and GPU can access it.'),
      cite(R.workingSet, "Metal's recommended GPU working set size."),
      cite(R.m5, 'A Neural Accelerator in each M5 GPU core; Tensor APIs in Metal 4.'),
      cite(R.agx, 'GPU firmware coprocessor, shared page tables, 16 KB pages.'),
      cite(R.airSpecs, 'The M5 Air comes with 8 or 10 GPU cores.'),
    ],
    related: ['unified-memory', 'llm-bandwidth', 'dvfs', 'system-cache'],
    now: ({ s }) =>
      s.gpu.usage == null
        ? 'The reader cannot read GPU usage on this Mac, so it shows n/a.'
        : `The GPU was active ${pct(s.gpu.usage)} of the last second at ${gpuMhz(s.gpu.freqMHz)}, drawing ${watts(s.power.gpuW)}.`,
  },
  'neural-engine': {
    title: 'Neural Engine',
    group: 'Chip',
    summary: 'A block built for one job: running trained neural networks at low power. macOS uses it for features like scene analysis in Photos and image captions for accessibility.',
    sections: [
      {
        h: 'What it does',
        p: [
          'Neural networks spend most of their time multiplying large arrays of small numbers. The Neural Engine is hardware that does exactly that at low precision, mainly 16-bit floating point, with local memory for parts of the model. It cannot run general code. For the work it fits, it uses much less energy than the GPU or CPU would.',
        ],
      },
      {
        h: 'How apps use it',
        p: [
          "Apps cannot program it directly. They go through Core ML, or Apple frameworks built on it such as Vision. With the default setting Core ML may split a model across the CPU, GPU and Neural Engine and picks the mix itself. An app can also restrict a model to the CPU, or to the CPU and GPU.",
          'Local chat models in Ollama or LM Studio run on the GPU through Metal (or MLX, which also uses the GPU), not on the Neural Engine. It stays near idle while they generate.',
        ],
      },
      {
        h: 'Numbers',
        p: [
          'Apple first shipped a Neural Engine in the iPhone A11 in 2017, at 0.6 trillion half-precision operations per second. The M4 is rated at 38 trillion operations per second. Every base M-series chip so far has a 16-core Neural Engine.',
        ],
      },
      {
        h: 'Gotchas',
        p: [
          "macOS gives the reader no core count and no usage counter, so the drawing shows it as one block and shades it by power.",
        ],
      },
    ],
    source:
      'Power only: the `ANE` energy channel in IOReport (the CLPC energy counters on macOS 27, the `Energy Model` group before that). There is no usage or clock counter the reader can read, so the drawing shades the block by its power.',
    sources: [
      cite(R.aneResearch, 'First Neural Engine in the A11 at 0.6 TFLOPS FP16; Core ML blends CPU, GPU and ANE.'),
      cite(R.computeUnits, 'How an app picks which processors a Core ML model may use.'),
      cite(R.m4, 'M4 Neural Engine: 38 trillion operations per second.'),
      cite(R.m5, 'M5: an improved 16-core Neural Engine.'),
    ],
    related: ['gpu', 'soc', 'ioreport', 'power'],
    now: ({ s }) => {
      const w = s.power.aneW
      if (w == null) return 'The reader cannot read Neural Engine power on this Mac, so it shows n/a.'
      return w < 0.05 ? `It draws ${watts(w)}, so it is idle or close to it.` : `It draws ${watts(w)}, so something is running a model on it.`
    },
  },
  'system-cache': {
    title: 'System level cache',
    group: 'Chip',
    summary: 'A cache shared by every block on the chip, sitting between them and DRAM. What one block writes, another can read without a trip to memory.',
    sections: [
      {
        h: 'Where it sits',
        p: [
          'Each core has its own L1 caches and each CPU cluster shares an L2. Behind those, the system level cache (SLC) serves the CPU clusters, the GPU and the other engines together. A request that misses the SLC goes out to DRAM.',
        ],
      },
      {
        h: 'Why it matters',
        p: [
          'A trip to DRAM costs far more time and energy than a hit in on-chip cache. The SLC catches data that blocks hand to each other, so it may never leave the chip, and it cuts DRAM traffic on a chip where every block shares the same memory bandwidth.',
        ],
      },
      {
        h: 'Numbers',
        p: [
          'Apple does not publish SLC sizes. Wikipedia lists 8 MB for the M1 from outside measurements. Chips and Cheese measured the M2 Pro GPU reaching its SLC in about 234 ns, much faster than DRAM.',
        ],
      },
    ],
    source: 'The reader has no SLC counter, so this block is drawn without a live value.',
    sources: [cite(R.wikiM1, 'M1 cache hierarchy, including an 8 MB system level cache.'), cite(R.cnc, 'Measured SLC latency from the GPU on the M2 Pro.')],
    related: ['unified-memory', 'memory-interface', 'gpu'],
  },
  'media-engine': {
    title: 'Media engines',
    group: 'Chip',
    summary: 'Fixed-function hardware that encodes and decodes video. Playing or exporting video this way costs far less power than doing it on the CPU.',
    sections: [
      {
        h: 'What it does',
        p: [
          'Video codecs repeat the same heavy steps for every frame, so a dedicated block does them in hardware. Apps reach it through VideoToolbox and AVFoundation. Asahi Linux lists separate blocks for video encode (AVE), video decode (AVD) and ProRes (APR).',
          'Decoding reads a compressed bitstream from the SSD or the network and writes finished frames into unified memory, where the display engine or the GPU picks them up without a copy. Encoding goes the other way: frames from the camera or the screen in, a bitstream out to a file or a call.',
        ],
      },
      {
        h: 'Which codecs',
        p: [
          [
            'M1: H.264 and HEVC encode and decode.',
            'M2: adds a ProRes engine.',
            'M3: adds AV1 decode, which Apple says saves power on streaming services.',
            'M5 MacBook Air: H.264, HEVC, ProRes and ProRes RAW, plus AV1 decode.',
          ],
        ],
      },
      {
        h: 'What the reader sees',
        p: [
          'The chip keeps a memory-traffic histogram for each block, including the decoder, the encoder, the scaler that frames pass through and the camera ISP. The reader turns those into GB/s every two seconds. That is memory traffic, not a percentage busy, but a block that is off reads about zero, so it shows clearly when video is being decoded or encoded.',
          'On the test M5, a hardware HEVC decode of a 4K file moved about 2.5 GB/s through the decoder while it idled near 0.002, and a video call kept the encoder and ISP busy while the camera was on.',
        ],
      },
      {
        h: 'Gotchas',
        p: [
          'Software decoders (some browsers for some codecs, or an app that does not ask VideoToolbox) leave the media engine idle and load the CPU instead. ProRes has its own engine, which has no traffic counter, so it does not show here.',
        ],
      },
    ],
    source:
      'IOReport group `PMP`, subgroup `DCS BW`, channels `AVD RD+WR` (decode), `AVE RD+WR` (encode), `MSR RD+WR` (scaler) and `ISP RD+WR` (camera). Each histogram counts only the windows a block was busy in, so the reader divides its bin-midpoint sum by the window count of the whole-DRAM channel `AMCC RD+WR`. No root needed.',
    sources: [
      cite(R.airSpecs, 'M5 Air media engine codecs.'),
      cite(R.m2, 'The ProRes video engine arrives in the base chip.'),
      cite(R.m3, 'AV1 decode in the media engine for the first time.'),
      cite(R.accel, 'Names of the video encode, decode and ProRes blocks.'),
      cite(R.wikiM1, 'M1 media engine: H.264 and HEVC.'),
      cite(R.videoToolbox, 'The framework apps use to reach the hardware codecs.'),
    ],
    related: ['video-codecs', 'display-engine', 'camera-path', 'gpu', 'soc'],
    now: ({ s }) => {
      const m = mediaOf(s)
      if (m.decodeGBs == null && m.encodeGBs == null) return 'This reader does not report media engine traffic, so it shows n/a.'
      const say = (what: string, v: number | null) => (v == null ? `${what} n/a` : busy(v) ? `${what} moving ${num(v, 1)} GB/s` : `${what} idle`)
      return `${say('Decoder', m.decodeGBs)}, ${say('encoder', m.encodeGBs)}.`
    },
  },
  'video-codecs': {
    title: 'How video compression works',
    group: 'Chip',
    summary: 'A video stores very few whole pictures. Most frames only describe what moved since another frame, which is how an hour of 4K fits in a few gigabytes.',
    sections: [
      {
        h: 'Three kinds of frame',
        p: [
          [
            'I frames (intra) are coded on their own, like a photo. They are the biggest, and a player can start decoding from any of them.',
            'P frames (predicted) store only the difference from an earlier I or P frame.',
            'B frames (bi-directional) predict from frames on both sides, one before and one after, and are usually the smallest.',
          ],
          'Because a B frame needs a later frame, the encoder sends frames out of display order, and the decoder holds a few back before showing them.',
        ],
      },
      {
        h: 'Blocks and motion vectors',
        p: [
          'Each frame is cut into blocks: 16 by 16 pixel macroblocks in H.264, larger and variable coding tree units up to 64 by 64 in HEVC and 128 by 128 in AV1. For each block the encoder searches the reference frame for the best match and stores a motion vector (where to copy from) plus a small residual (what still differs). A block that has not changed is skipped entirely.',
          'Searching for matches is the expensive part of encoding, which is why a hardware encoder saves so much power. Decoding just follows the vectors, so it is cheaper.',
        ],
      },
      {
        h: 'About the drawing',
        p: ['The animation in the media engine card is an illustration of these ideas, not live data. The live part is the decode and encode lanes above it.'],
      },
    ],
    source: 'Nothing is measured for the illustration. The decode and encode lanes next to it use the media engine traffic counters.',
    sources: [
      cite(R.picTypes, 'I, P and B frames and why B frames are sent out of order.'),
      cite(R.macroblock, 'Macroblock sizes in H.264, HEVC coding tree units.'),
      cite(R.motionComp, 'Motion vectors and residuals.'),
      cite(R.airSpecs, 'The codecs the M5 Air media engine handles.'),
    ],
    related: ['media-engine', 'display-engine', 'camera-path'],
  },
  'display-engine': {
    title: 'Display engine',
    group: 'Chip',
    summary: 'The block that reads finished frames from memory and sends them to the built-in panel and any external display, on time for every refresh.',
    sections: [
      {
        h: 'What it does',
        p: [
          'Apps and the window server draw into buffers in memory. The display engine fetches those buffers, combines layers, scales and colour-corrects them, and sends pixels to the panel on the schedule set by the refresh rate. Asahi Linux calls the controlling coprocessor DCP.',
        ],
      },
      {
        h: 'The panel',
        p: [
          'The 13-inch M5 Air has a 13.6-inch LED-backlit display, 2560 by 1664 pixels at 224 pixels per inch, rated at 500 nits. Brightness is the backlight level, not part of the image, so dimming the screen saves power without the GPU doing less work.',
        ],
      },
    ],
    source: 'No counter for the display engine. Brightness comes from `DisplayServicesGetBrightness` in the private DisplayServices framework.',
    sources: [cite(R.airSpecs, 'Panel size, resolution, LED backlight and 500 nits.'), cite(R.accel, 'DCP, the display coprocessor.')],
    related: ['media-engine', 'display-brightness', 'system-cache'],
    now: ({ s }) => {
      const b = sensorsOf(s).displayBrightness
      return b == null ? 'The reader cannot read built-in display brightness right now, so it shows n/a.' : `The built-in display backlight is at ${pct(b)}.`
    },
  },
  'secure-enclave': {
    title: 'Secure Enclave',
    group: 'Chip',
    summary: 'An isolated processor on the chip that holds encryption keys and checks Touch ID. The rest of the system never sees the keys it guards.',
    sections: [
      {
        h: 'What it is',
        p: [
          'The Secure Enclave has its own processor, used only by it, and its own boot ROM, which is the root of trust for everything it runs. Its memory is encrypted and authenticated by a Memory Protection Engine. macOS can ask it to do things (match a fingerprint, sign with a key, unwrap a file key) but cannot read the keys inside.',
          'Every Mac with Apple silicon has one, as did Intel Macs with the T2 chip.',
        ],
      },
      {
        h: 'Storage encryption',
        p: [
          'Every device with a Secure Enclave also has an AES-256 engine built into the DMA path, the route data takes between storage and memory. Data is encrypted as it is written and decrypted as it is read. Hardware keys derived from the Secure Enclave stay inside the AES engine.',
          'On an Apple silicon Mac the internal volume is always encrypted. With FileVault off, the volume key is protected only by a hardware key in the Secure Enclave. With FileVault on, it is also protected by your password, so the data is useless without both.',
        ],
      },
      {
        h: 'Touch ID',
        p: [
          'Fingerprint data from the sensor in the power key goes to the Secure Enclave over a link encrypted with a key paired to that sensor at the factory, and is matched there. macOS only learns whether it matched.',
        ],
      },
    ],
    source: 'No counter. The block is drawn without a live value.',
    sources: [
      cite(R.sep, 'Secure Enclave processor, boot ROM, Memory Protection Engine, AES engine in the DMA path.'),
      cite(R.fileVault, 'Internal storage is always encrypted; FileVault adds the password.'),
      cite(R.touchId, 'The encrypted sensor link and matching inside the Secure Enclave.'),
      cite(R.asahiSep, 'How an outside OS sees the Secure Enclave Processor.'),
    ],
    related: ['ssd', 'soc'],
  },
  'io-block': {
    title: 'Thunderbolt, USB and I/O',
    group: 'Chip',
    summary: 'The controllers for the USB-C ports, Thunderbolt and PCIe, and the internal links to chips like the Wi-Fi radio.',
    sections: [
      {
        h: 'On the 13-inch Air',
        p: [
          'The M5 Air has two Thunderbolt 4 (USB-C) ports at up to 40 Gb/s and a MagSafe 3 charging port. On the M2 Air design, which the M5 keeps, they sit on a small daughterboard screwed to the case, separate from the logic board.',
        ],
      },
      {
        h: 'Inside the chip',
        p: [
          'Apple moved the Thunderbolt controller onto the chip with the M1. The chip also has PCIe links to parts of the board such as the Wi-Fi and Bluetooth radio.',
          'Each USB-C port also has a USB Power Delivery controller on the board. On the M2 Air iFixit identified a Texas Instruments CD3217B13 for this.',
        ],
      },
    ],
    source: 'No counter for port traffic. Disk and network rates are read separately.',
    sources: [
      cite(R.airSpecs, 'Two Thunderbolt 4 ports, up to 40 Gb/s, and MagSafe 3.'),
      cite(R.m1, 'An Apple-designed Thunderbolt controller on the M1.'),
      cite(R.ifixitM2, 'All ports are modular, not glued down.'),
      cite(R.ifixitChips, 'The TI CD3217B13 USB-C power delivery controller.'),
    ],
    related: ['ssd', 'wifi', 'adapter'],
  },
  processes: {
    title: 'Top processes',
    group: 'Chip',
    summary: 'The apps and helpers using the most CPU and memory, refreshed every two seconds.',
    sections: [
      {
        h: 'How CPU is measured',
        p: [
          "Every two seconds the reader lists all processes and asks the kernel for each one's total CPU time, user plus system. The change over the interval, divided by the interval, is the process's share. 100% means one full core.",
        ],
      },
      {
        h: 'How memory is measured',
        p: [
          "Memory is the physical footprint. That is the figure in Activity Monitor's Memory column and in the MEM column of `top`; all of them read the same kernel ledger. It counts dirty memory, the pages the process has written, including what has been compressed or swapped out. Clean pages that could be read back from a file are left out.",
          'Run `footprint <app name>` in Terminal for a full breakdown of one process.',
        ],
      },
      {
        h: 'What is missing',
        p: [
          'The reader runs as you, so it can only inspect your own processes. System processes such as WindowServer and kernel_task belong to other users and do not appear.',
          'Processes with the same name, like the helpers of a browser, are merged into one row with a count.',
        ],
      },
    ],
    source: '`proc_listpids` and `proc_pid_rusage` with `RUSAGE_INFO_V4`: `ri_user_time`, `ri_system_time` and `ri_phys_footprint`.',
    sources: [cite(R.footprint, 'Defines footprint as dirty memory and says Activity Monitor and top read the same ledger.')],
    related: ['cpu-usage', 'memory-kinds', 'scheduling'],
    now: ({ s }) => {
      const c = byApp(s.topCpu, (p) => p.cpu)[0]
      const m = byApp(s.topMem, (p) => p.bytes)[0]
      if (!c && !m) return 'No process readings yet.'
      return [c && `${c.name} leads CPU at ${num(c.v)}% of one core.`, m && `${m.name} uses the most memory, ${memGB(m.v)}.`].filter(Boolean).join(' ')
    },
  },

  // Memory
  'unified-memory': {
    title: 'Unified memory',
    group: 'Memory',
    summary: 'One pool of DRAM shared by the CPU, GPU, Neural Engine and every other block. There is no separate graphics memory.',
    sections: [
      {
        h: 'What it is',
        p: [
          "The memory sits in packages right beside the die, on the same substrate, wired to the chip's memory controllers. Every block addresses the same physical memory. The drawing shows two DRAM packages, which is what teardowns of the M2 and M4 Air found.",
        ],
      },
      {
        h: 'Why it changes how the GPU works',
        p: [
          "On a PC with a graphics card, the CPU prepares data in system RAM and copies it over PCIe into the card's own memory, and results come back the same way. Here there is nothing to copy. A Metal buffer in shared storage is visible to both, so the CPU writes vertices or model weights and the GPU reads them in place.",
          'The limit on GPU memory is what macOS lets the GPU keep resident, not a fixed amount soldered to a graphics card.',
        ],
      },
      {
        h: 'Numbers',
        p: [
          [
            'M1: 68 GB/s, up to 16 GB.',
            'M2: 100 GB/s, 50% more than the M1.',
            'M4: 120 GB/s.',
            'M5: 153 GB/s, up to 32 GB.',
          ],
        ],
      },
      {
        h: 'The trade',
        p: [
          'Shared memory also means shared bandwidth. While the GPU streams a large model, the CPU competes for the same memory interface. And the amount is fixed when the Mac is built.',
        ],
      },
    ],
    source: 'Total from the `hw.memsize` sysctl. The breakdown from `host_statistics64` with `HOST_VM_INFO64`.',
    sources: [
      cite(R.m1, 'A unified memory architecture, one pool of memory.'),
      cite(R.wikiM1, 'M1: 68 GB/s and up to 16 GB.'),
      cite(R.m2, '100 GB/s, 50% more than M1.'),
      cite(R.m4, '120 GB/s.'),
      cite(R.m5, '153 GB/s and up to 32 GB.'),
      cite(R.storageModes, 'The CPU and GPU share system memory.'),
    ],
    related: ['memory-kinds', 'memory-pressure', 'memory-interface', 'gpu'],
    now: ({ s }) => `${memGB(usedBytes(s))} of ${memGB(s.memory.totalBytes, 0)} is in use, and memory pressure is ${s.memory.pressure}.`,
  },
  'memory-interface': {
    title: 'Memory bandwidth',
    group: 'Memory',
    summary: 'How many gigabytes per second move between the chip and its DRAM. For many heavy jobs this is the real speed limit.',
    sections: [
      {
        h: 'Peak and real',
        p: [
          'Apple publishes a peak unified memory bandwidth for each chip, for example 120 GB/s for the M4 and 153 GB/s for the M5. The peak is the width of the memory bus times its transfer rate. Real traffic stays below it, because no workload keeps every channel busy every cycle.',
        ],
      },
      {
        h: 'The interface',
        p: [
          "The memory interfaces along the die's bottom edge are the PHYs, circuits that drive signals to and from the DRAM packages. Apple does not publish the M5's bus width. 153 GB/s fits a 128-bit LPDDR5X bus at 9600 MT/s (16 bytes times 9.6 billion transfers is 153.6 GB/s), but that is arithmetic, not a published figure. The M1 used a 128-bit LPDDR4X bus for its 68 GB/s.",
        ],
      },
      {
        h: 'How the reader measures it',
        p: [
          'A coprocessor that Asahi Linux calls PMP, likely the power management processor, keeps a histogram of DRAM traffic: bins 4 GB/s wide that count how often reads plus writes fell in each band. Every two seconds the reader takes the change in that histogram and averages the bin midpoints.',
          'That makes it coarse. A single sample can be a couple of GB/s off, and a quiet machine reads a few GB/s rather than zero.',
        ],
      },
      {
        h: 'What uses it',
        p: ['Local language models above all, then GPU work, video editing and large builds. Ordinary desktop use moves a small fraction of the peak.'],
      },
    ],
    source: 'IOReport group `PMP`, subgroup `DCS BW`, channel `AMCC RD+WR`. Read every 2 s, because it is the most expensive counter the reader uses.',
    sources: [
      cite(R.m4, '120 GB/s for the M4.'),
      cite(R.m5, '153 GB/s for the M5.'),
      cite(R.wikiM1, 'The M1 used a 128-bit LPDDR4X bus.'),
      cite(R.accel, 'PMP, a power management coprocessor.'),
      cite(R.llamaBench, 'A second source for the same peak figures, M1 to M4.'),
    ],
    related: ['llm-bandwidth', 'unified-memory', 'ioreport', 'system-cache'],
    now: ({ hw, s }) => {
      const bw = s.memory.bandwidthGBs
      if (bw == null) return 'The reader could not read the DRAM bandwidth counters on this Mac, so they show n/a.'
      const peak = peakBandwidth(hw.chip)
      return `${num(bw)} GB/s right now${peak ? `, ${pct(bw / peak)} of the ${peak} GB/s Apple publishes for the ${hw.chip}` : ''}.`
    },
  },
  'memory-kinds': {
    title: 'Wired, app, compressed, cached and free',
    group: 'Memory',
    summary: 'macOS sorts every page of memory into a few kinds. Only some of them are really taken; the system can reclaim the rest quickly.',
    sections: [
      {
        h: 'The kinds',
        p: [
          'Wired. Memory that must stay in RAM: the kernel, drivers, and memory the GPU is using. It cannot be compressed or swapped. GPU allocations count here, which is why wired grows while a local model is loaded; the `iogpu.wired_limit_mb` sysctl that LLM guides tell you to raise is the cap on that.',
          'App memory. Anonymous pages that processes have written, like heaps and stacks, minus purgeable memory that apps marked as safe to throw away.',
          'Compressed. Physical memory holding compressed pages. The size is what the compressed data takes, not what it held before.',
          'Cached. Here, the inactive pages: memory not touched recently. Most of it is file contents kept in case they are read again, and clean pages can be dropped instantly.',
          'Free. Pages holding nothing. macOS keeps this small on purpose, since empty RAM does no work.',
        ],
      },
      {
        h: 'Versus Activity Monitor',
        p: [
          "Activity Monitor shows App Memory, Wired Memory, Compressed and Cached Files. Its Cached Files is file-backed memory, while this app's cached row is the inactive pages, which can include some idle app memory. So the two differ a little.",
          'This app counts used memory as total minus free minus inactive. Activity Monitor adds app, wired and compressed for Memory Used.',
        ],
      },
      {
        h: 'Pages',
        p: ['On Apple silicon a page is 16 KB (run `pagesize` in Terminal); Intel Macs use 4 KB. The kernel counts pages and the reader multiplies by the page size. `vm_stat` prints the same counters.'],
      },
    ],
    source:
      '`host_statistics64` with `HOST_VM_INFO64`: `wire_count`, `active_count`, `inactive_count`, `free_count`, `compressor_page_count`, `internal_page_count` and `purgeable_count`, times `vm_kernel_page_size`.',
    sources: [
      cite(R.amMemory, "Activity Monitor's definitions of app, wired, compressed and cached memory."),
      cite(R.wiredLimit, 'The iogpu.wired_limit_mb cap on GPU wired memory.'),
      cite(R.agx, 'The GPU uses 16 KB pages, like the CPU.'),
    ],
    related: ['memory-pressure', 'compression', 'swap', 'unified-memory'],
    now: ({ s }) => {
      const m = s.memory
      return `Wired ${memGB(m.wiredBytes)}, app ${memGB(m.appBytes)}, compressed ${memGB(m.compressedBytes)}, cached ${memGB(m.inactiveBytes)}, free ${memGB(m.freeBytes)}.`
    },
  },
  'memory-pressure': {
    title: 'Memory pressure',
    group: 'Memory',
    summary: 'How hard macOS is working to find free memory. It says more about trouble than how full memory looks.',
    sections: [
      {
        h: 'Full is normal',
        p: [
          'macOS fills RAM on purpose. File caches and idle app data stay in memory because using them later is cheaper than reading them again. A Mac at 90% used with normal pressure is healthy.',
        ],
      },
      {
        h: 'What happens when memory runs short',
        p: [
          'Roughly in this order, though in practice the steps overlap:',
          {
            steps: [
              'The kernel hands out free pages.',
              'It reclaims cached file pages. Clean ones are dropped; changed ones are written back first.',
              'It compresses app pages that have not been used for a while and keeps them in RAM, in the compressor.',
              'As pressure rises it notifies apps, which can drop their own caches.',
              'When the compressor itself gets too large, it writes compressed segments to swap files on the SSD.',
              'As a last resort macOS shows a dialog saying the system has run out of application memory and asks you to quit apps.',
            ],
          },
        ],
      },
      {
        h: 'The three levels',
        p: [
          [
            'Normal: memory is found without much effort.',
            'Warn: the kernel is compressing and reclaiming steadily and has told apps memory is short.',
            'Critical: memory is very short and the system may start asking apps to quit.',
          ],
          "Activity Monitor draws the same idea as a green, yellow and red graph. Apple's wording: green means the Mac is using its RAM efficiently, yellow that it might eventually need more RAM, red that it needs more RAM.",
        ],
      },
    ],
    source: 'The `kern.memorystatus_vm_pressure_level` sysctl: 1 is normal, 2 warn, 4 critical. Those values are the kernel\'s `NOTE_MEMORYSTATUS_PRESSURE_*` flags.',
    sources: [
      cite(R.xnuPressure, 'The pressure level values: normal 1, warn 2, critical 4.'),
      cite(R.amRam, 'What green, yellow and red memory pressure mean.'),
      cite(R.amMemory, 'The Memory Pressure graph in Activity Monitor.'),
    ],
    related: ['compression', 'swap', 'memory-kinds'],
    now: ({ s }) => {
      const m = s.memory
      return `Pressure is ${m.pressure}. ${memGB(m.compressedBytes)} holds compressed pages and ${m.swapUsedBytes > 0 ? `${memGB(m.swapUsedBytes)} is in swap.` : 'nothing is in swap.'}`
    },
  },
  compression: {
    title: 'Compressed memory',
    group: 'Memory',
    summary: 'Before it writes idle app memory to the SSD, macOS squeezes it and keeps it in RAM. Decompressing is much faster than reading from disk.',
    sections: [
      {
        h: 'How it works',
        p: [
          'When the kernel needs room, it picks app pages that have not been touched for a while, compresses them, and packs the results into segments the compressor owns. The original pages are freed.',
          'When a process touches a compressed page, the CPU raises a page fault, the kernel decompresses the page into a fresh frame, and the process carries on without knowing. Compressed memory arrived in OS X Mavericks in 2013.',
        ],
      },
      {
        h: 'The algorithms',
        p: [
          "XNU's compressor is hybrid: it uses WKdm, a compressor built for the patterns in memory pages, where that pays off, and a variant of LZ4 elsewhere.",
        ],
      },
      {
        h: 'Why it comes before swap',
        p: [
          'Compressing a page costs a little CPU time. Writing it to the SSD and reading it back costs far more time, and the writes wear the flash. Data with lots of zeros or repetition shrinks a lot; data that is already compressed, like photos or model weights, barely shrinks.',
        ],
      },
      {
        h: 'Reading the number',
        p: ['Compressed shows the physical memory the compressor uses, not how much data it holds. The kernel does count the uncompressed total, but the reader does not send it, so the page cannot show the ratio.'],
      },
    ],
    source: '`compressor_page_count` from `host_statistics64`.',
    sources: [cite(R.xnuCompressor, 'The hybrid WKdm and LZ4 scheme.'), cite(R.amMemory, "Activity Monitor's definition of Compressed.")],
    related: ['memory-pressure', 'swap', 'memory-kinds'],
    now: ({ s }) => (s.memory.compressedBytes > 0 ? `${memGB(s.memory.compressedBytes)} of RAM holds compressed pages right now.` : 'Nothing is compressed right now.'),
  },
  swap: {
    title: 'Swap',
    group: 'Memory',
    summary: 'When compression is not enough, macOS writes compressed memory to swap files on the SSD and reads it back when something needs it.',
    sections: [
      {
        h: 'How it works',
        p: [
          'Swap files live in `/System/Volumes/VM` as `swapfile0`, `swapfile1` and so on, 1 GB each on this Mac. macOS adds files as needed and removes them when it can. What goes out are compressed segments from the compressor, so swap moves less data than the pages it holds.',
          'Swap is encrypted. `sysctl vm.swapusage` in Terminal says so at the end of its line.',
        ],
      },
      {
        h: 'When swap is a problem',
        p: [
          'Some swap is normal and can stay for hours, because macOS reads a page back only when something touches it. Swap that keeps growing while you work, with warn or critical pressure, means the work needs more memory than the Mac has. Everything slows, because each swapped page that is touched costs an SSD read.',
        ],
      },
      {
        h: 'SSD wear',
        p: ['Swap writes count against the flash like any other write. Light swap does not matter. Constant heavy swapping writes a lot; the SSD panel shows the write rate so you can see it.'],
      },
    ],
    source: 'The `vm.swapusage` sysctl, field `xsu_used`.',
    sources: [cite(R.amMemory, "Activity Monitor's Swap Used: space on the startup disk used to swap memory."), cite(R.amRam, 'When swap and pressure mean you need more RAM.')],
    related: ['compression', 'memory-pressure', 'ssd'],
    now: ({ s, history }) => {
      const now = s.memory.swapUsedBytes
      if (now <= 0) return 'Nothing is in swap right now.'
      const then = history.at(-60)?.memory.swapUsedBytes
      const trend = then == null ? '' : now > then + 2 ** 20 ? ' It grew in the last minute.' : now < then - 2 ** 20 ? ' It shrank in the last minute.' : ' It has been steady for the last minute.'
      return `${memGB(now)} is in swap.${trend}`
    },
  },
  'llm-bandwidth': {
    title: 'Why LLM speed is bound by memory bandwidth',
    group: 'Memory',
    summary: 'To produce each new token, a language model reads all of its weights from memory once. So tokens per second cannot exceed memory bandwidth divided by model size.',
    sections: [
      {
        h: 'The formula',
        p: [
          'Generating one token runs the whole network once. In a dense model every weight is read from DRAM for every token, and the arithmetic per weight is small, so the GPU spends most of its time waiting for data.',
          'That gives a ceiling: tokens per second is at most peak bandwidth divided by the bytes of weights. A 4.7 GB model on a chip with 153 GB/s tops out near 33 tokens per second.',
        ],
      },
      {
        h: 'Measured numbers',
        p: [
          'The llama.cpp project keeps a table of Apple chips running the same 7B model at 4-bit (about 3.8 GB). Generation speed tracks bandwidth, not GPU cores:',
          [
            'M1, 68 GB/s, 7 GPU cores: 14.2 tokens per second. The ceiling is about 18, so it reaches about 80%.',
            'M2, 100 GB/s, 8 GPU cores: 21.7 tokens per second.',
            'M3, 100 GB/s, 10 GPU cores: 21.3 tokens per second. Two more GPU cores, same bandwidth, same speed.',
            'M4, 120 GB/s, 10 GPU cores: 24.1 tokens per second, about 77% of its ceiling of 31.',
            'M2 Max, 400 GB/s, 38 GPU cores: 66 tokens per second.',
          ],
        ],
      },
      {
        h: 'Why real speed is lower',
        p: [
          'Real traffic never reaches the published peak. Each token also reads the KV cache, the stored attention state for the conversation so far, which grows with context length. And there is overhead between steps. The table above lands at roughly 75 to 80% of the ceiling.',
        ],
      },
      {
        h: 'When the formula does not hold',
        p: [
          'Mixture-of-experts models read only the experts chosen for each token, so they can run faster than their total size suggests.',
          'Reading your prompt (prefill) processes many tokens at once and reuses each weight for all of them, so it is limited by compute, not bandwidth. In the same llama.cpp table the M4 reads a prompt at 221 tokens per second but generates at 24.',
        ],
      },
      {
        h: 'What follows',
        p: [
          'More GPU cores on the same memory bus do little for generation speed. A smaller model, or the same model quantised to fewer bits per weight, reads fewer bytes per token and runs faster roughly in proportion.',
          "When a local model is generating, the What's happening card shows this formula with your chip's peak and the size of the loaded model.",
        ],
      },
      {
        h: 'Gotchas',
        p: [
          "Ollama's `size` for a loaded model includes its KV cache and buffers, not only the weights, so the estimate comes out a little low.",
          'LM Studio does not report model size, so with LM Studio the card explains the idea but cannot do the sum.',
        ],
      },
    ],
    source:
      "The reader asks Ollama (`127.0.0.1:11434/api/ps`) and LM Studio (port 1234) which models are loaded and, for Ollama, how large they are. Neither reports a live token rate unless you send the request through it, so the reader never measures one; only demo data shows a measured rate. Peak bandwidth is Apple's published figure for your chip, from a table in this app.",
    sources: [
      cite(R.llamaBench, 'Prompt and generation speeds on M1 to M4 with the same model, and why generation is bandwidth-bound.'),
      cite(R.ollamaApi, 'The /api/ps fields size and size_vram; token counts come only in generate responses.'),
      cite(R.lmStudioApi, 'The LM Studio model list the reader reads.'),
      cite(R.m5, '153 GB/s for the M5.'),
    ],
    related: ['memory-interface', 'gpu', 'unified-memory', 'neural-engine'],
    now: ({ hw, s }) => {
      const peak = peakBandwidth(hw.chip)
      const m = largestModel(s)
      if (peak == null) return `This app has no published bandwidth figure for the ${hw.chip}, so it cannot work out the ceiling.`
      if (m?.bytes) {
        const gb = m.bytes / 1e9
        return `With ${m.name} (${bytes(m.bytes)}) loaded: ${peak} GB/s ÷ ${num(gb, 1)} GB ≈ ${num(peak / gb)} tokens per second at most on this ${hw.chip}.`
      }
      return `No model with a known size is loaded. As an example, your ${hw.chip} peaks at ${peak} GB/s, so a 4 GB model could reach at most about ${num(peak / 4)} tokens per second.`
    },
  },

  // Storage
  ssd: {
    title: 'SSD',
    group: 'Storage',
    summary: 'The flash chips on the board only store bits. The controller that runs them is a block inside the M-series chip.',
    sections: [
      {
        h: 'Controller in the chip',
        p: [
          'In most PCs an SSD is a module with its own controller chip. In an Apple silicon Mac the storage controller is part of the chip, with AES encryption hardware, and the NAND flash packages on the logic board connect to it directly. The controller does wear levelling, error correction and garbage collection.',
          'On the MacBook Air the NAND is soldered to the logic board. The M2 Air base model had a single 256 GB package.',
        ],
      },
      {
        h: 'What flash needs',
        p: [
          'Flash is written in pages but erased only in much larger blocks, and each cell survives a limited number of erase cycles. So the controller never overwrites in place. It writes new data to fresh pages, keeps a map from logical to physical addresses, and cleans up old blocks later.',
          'TRIM tells the controller which blocks no longer hold anything, so it can erase them ahead of time. APFS trims free space each time a volume mounts, and logs it as `spaceman_trim_free_blocks`.',
        ],
      },
      {
        h: 'What the rates include',
        p: [
          'Read and write rates are summed over every block storage device, so an external drive or a mounted disk image counts too.',
          'A file served from the memory cache never reaches the SSD and does not count. That is why opening the same large file twice reads much less the second time.',
        ],
      },
    ],
    source: 'The `Statistics` dictionary (`Bytes (Read)`, `Bytes (Write)`) of every `IOBlockStorageDriver` in the IOKit registry, compared once a second.',
    sources: [
      cite(R.m1, 'A storage controller with AES encryption hardware on the chip.'),
      cite(R.sep, 'The AES engine on the path between storage and memory.'),
      cite(R.ifixitM2, 'A single soldered 256 GB NAND package in the M2 Air.'),
      cite(R.trim, 'What TRIM does and when APFS issues it.'),
    ],
    related: ['secure-enclave', 'swap', 'memory-kinds', 'io-block'],
    now: ({ s }) => `Reading ${rate(s.disk.readBps)} and writing ${rate(s.disk.writeBps)} right now.`,
  },

  // Power and thermals
  power: {
    title: 'Where the watts go',
    group: 'Power and thermals',
    summary: 'The chip reports the energy its CPU, GPU and Neural Engine use. A sensor on the board reports what the whole Mac draws. The difference is everything else.',
    sections: [
      {
        h: 'Chip power',
        p: ['Chip power is CPU plus GPU plus Neural Engine. It swings widely: under a watt at idle, many watts in a build or an export.'],
      },
      {
        h: 'System power',
        p: [
          'System power is the total the Mac draws, from the SMC key `PSTR`, which Asahi Linux describes as the whole system power in watts. It includes the display backlight, the SSD, radios, memory and the losses in converting battery or adapter voltage down to the rails the chip needs.',
          'The Power panel shows the rest of the system as system power minus the parts the chip reports. When system power is not available that row is n/a, not a guess.',
        ],
      },
      {
        h: 'Energy, not power',
        p: ["The chip's counters count energy used. Power is the change in energy divided by the time between two readings, so each chip figure is an average over the last second. `PSTR` is an instant reading, so the page averages the last three."],
      },
      {
        h: 'Gotchas',
        p: [
          'On an idle Air the rest of the system is often bigger than the chip. Try dimming the screen and watch system power fall while chip power stays put.',
          'On macOS 27 memory power reads zero and shows n/a, so the memory share is part of the rest.',
        ],
      },
    ],
    source: 'CPU, GPU and Neural Engine power (and memory power on macOS before 27) from IOReport energy counters. System power from the SMC key `PSTR`.',
    sources: [cite(R.asahiSmc, 'PSTR is the whole system power in watts.'), cite(R.macmon, 'The CLPC energy counters for CPU, GPU and ANE on macOS 27.')],
    related: ['ioreport', 'smc', 'power-delivery', 'battery-flow', 'dvfs'],
    now: ({ s, history }) => {
      const chip = socW(s)
      const sys = recentAvg(history, (x) => x.power.systemW)
      if (chip == null && sys == null) return 'The reader cannot read any power counters on this Mac, so they show n/a.'
      if (chip == null) return `The whole Mac draws ${watts(sys)}. Chip power is n/a here.`
      return `CPU, GPU and Neural Engine draw ${watts(chip)}${sys == null ? '. System power is n/a here.' : ` of the ${watts(sys)} the whole Mac uses.`}`
    },
  },
  'power-delivery': {
    title: 'Power delivery',
    group: 'Power and thermals',
    summary: "Power management chips turn the battery's or adapter's voltage into the many low voltages the SoC, memory and other parts run on.",
    sections: [
      {
        h: 'Rails',
        p: [
          'The SoC does not run on one voltage. The CPU clusters, GPU, memory interface and always-on logic get separate supply rails, so each can run at the lowest voltage it needs. In DVFS designs generally, the voltage rises before a clock goes up and falls after it comes down, because a fast clock at a low voltage would fail.',
        ],
      },
      {
        h: 'On the board',
        p: [
          'On the M2 Air logic board, iFixit identified two Apple power management chips (APL109C and APL109D), a Renesas RAA489900 battery charger, an Analog Devices LT8642 10 A step-down converter and a TI TPS621371. A step-down (buck) converter switches at high frequency through a small inductor to lower voltage with little loss. The drawing places this area next to the SoC; positions are estimates from M2 and M4 teardowns.',
        ],
      },
      {
        h: 'Charging',
        p: ['The charger chip decides how much adapter power goes to the battery, and pauses or slows charging for optimised charging, a charge limit or heat.'],
      },
    ],
    source: 'No counter for rail voltages. The Power label on the overview shows total system power, and the adapter rating comes from the battery gauge.',
    sources: [cite(R.ifixitChips, 'The power management, charger and converter chips on the M2 Air board.'), cite(R.dvfsWiki, 'Voltage and frequency move together in DVFS.')],
    related: ['power', 'charge-held', 'adapter', 'dvfs'],
    now: ({ s, history }) => {
      const sys = recentAvg(history, (x) => x.power.systemW)
      const b = s.battery
      const ad = b?.acAttached ? ` A ${watts(b.adapterW)} adapter is connected.` : b ? ' It is running from the battery.' : ''
      return `The Mac draws ${watts(sys)} in total.${ad}`
    },
  },
  temperatures: {
    title: 'CPU and GPU temperature',
    group: 'Power and thermals',
    summary: "Averages of the chip's temperature sensors, read from the System Management Controller every two seconds.",
    sections: [
      {
        h: 'Where the sensors are',
        p: [
          'The die has many temperature sensors across the CPU clusters and the GPU. The SMC exposes them as four-character keys starting with T. At start the reader keeps every key beginning with Tp or Te (CPU) or Tg (GPU) that gives a value between 0 and 150 °C, and shows the average of each group.',
        ],
      },
      {
        h: 'Average, not hottest',
        p: ['An average hides hot spots. Thermal control works from the individual sensors, so the chip can slow down while the average still looks moderate.'],
      },
      {
        h: 'What is normal',
        p: [
          'Apple does not publish temperature limits for its chips. On a fanless Air the CPU climbs far above its idle reading under a long load. What matters is whether the thermal state leaves nominal and whether the clocks drop.',
        ],
      },
      {
        h: 'Key names are not documented',
        p: ['Apple does not document SMC keys. The prefixes the reader uses come from community research and may change with a new chip.'],
      },
    ],
    source: 'The AppleSMC user client, keys `Tp*`, `Te*` and `Tg*`, averaged and read every 2 s. Battery temperature comes from the battery gauge instead.',
    sources: [cite(R.asahiSmc, 'SMC keys starting with T are temperatures in Celsius, as floats.'), cite(R.macmon, 'Another tool that picks CPU sensors by the Tp and Te prefixes (plus Ts) and GPU sensors by Tg.')],
    related: ['thermal-state', 'cooling', 'smc'],
    now: ({ s }) => `CPU ${temp(s.thermal.cpuTempC)}, GPU ${temp(s.thermal.gpuTempC)}, thermal state ${s.thermal.state}.`,
  },
  'thermal-state': {
    title: 'Thermal state',
    group: 'Power and thermals',
    summary: "macOS's own summary of how hot the Mac is: nominal, fair, serious or critical.",
    sections: [
      {
        h: 'The four states',
        p: [
          "Apple's definitions:",
          [
            'Nominal: within normal limits.',
            'Fair: slightly elevated.',
            'Serious: high. The system takes moderate steps to cool down, which reduces performance.',
            'Critical: significantly affecting performance, and the device needs to cool down.',
          ],
        ],
      },
      {
        h: 'How apps use it',
        p: ["Apps can read this state and get notified when it changes. At serious, Apple asks apps to cut back: defer I/O and networking, use less CPU and GPU, and lower frame rates, for example from 60 to 30 frames a second. iPhone and iPad use the same signal."],
      },
      {
        h: 'On a fanless Mac',
        p: ["Apple's description of serious mentions fans at full speed. The Air has no fan to speed up, so lower clocks are its only tool. Fair during a long export is expected."],
      },
    ],
    source: '`ProcessInfo.processInfo.thermalState` in Foundation.',
    sources: [cite(R.thermal, 'The definitions of each state and what Apple asks apps to do at serious.')],
    related: ['cooling', 'temperatures', 'dvfs'],
    now: ({ s }) => `The thermal state is ${s.thermal.state} right now.`,
  },
  cooling: {
    title: 'Fanless cooling',
    group: 'Power and thermals',
    summary: 'The MacBook Air has no fan, heat pipe or heat sink. Heat spreads from the chip through a thin shield and the board into the aluminium case, and the case gives it to the room.',
    sections: [
      {
        h: 'The heat path',
        p: [
          {
            steps: [
              'Nearly all the power the SoC uses turns into heat, in a small area.',
              'A thin metal shield covers the logic board. iFixit found graphite tape on it, which spreads heat sideways, and no heat sink.',
              'The heat moves through the shield and the board into the aluminium case, which spreads it across a large area.',
              'The case loses it to the air around it, and to your lap or desk by contact.',
            ],
          },
        ],
      },
      {
        h: 'What this means for speed',
        p: [
          'The case can soak up a lot of heat before it gets warm, so short bursts run at full speed. In a long heavy job the case warms until it cannot shed heat as fast as the chip makes it. The power controller then lowers clocks until power matches what the case can get rid of.',
          'A MacBook Pro with the same chip has a fan, so it can hold its top clocks longer.',
        ],
      },
      {
        h: 'On the drawing',
        p: ['The warm glow on the case and board follows the CPU temperature from 45 °C (none) to 95 °C (full), or the thermal state when temperature is not available.'],
      },
    ],
    source: 'Fan count from the SMC key `FNum`, fan speeds from `F0Ac` and its siblings. Heat path from teardown notes on the M2 and M4 Air, which share the M5 chassis.',
    sources: [cite(R.ifixitM2, 'A thin shield with graphite tape and no heat sink.'), cite(R.asahiSmc, 'SMC keys starting with F hold fan information.'), cite(R.ifixitM5, 'The M5 Air device page; no teardown yet.')],
    related: ['thermal-state', 'temperatures', 'dvfs', 'layout'],
    now: ({ hw, s }) => {
      const fans = s.fans.length ? ` Fan speeds: ${s.fans.map((f) => `${num(f.rpm)} rpm`).join(', ')}.` : ''
      return `${hw.fanCount === 0 ? 'This Mac reports no fans.' : `This Mac reports ${hw.fanCount} fan${hw.fanCount > 1 ? 's' : ''}.`} CPU ${temp(s.thermal.cpuTempC)}, thermal state ${s.thermal.state}.${fans}`
    },
  },

  // Battery
  battery: {
    title: 'Battery',
    group: 'Battery',
    summary: 'A lithium-ion polymer pack around the trackpad, with a gauge chip that tracks charge, health and temperature.',
    sections: [
      {
        h: 'The pack',
        p: [
          "Apple rates the 13-inch M5 Air's battery at 53.8 Wh. In the M2 Air design that the M5 keeps, it is four cells in a horseshoe around the trackpad: two thick cells on the outside running to the front edge, and two thin ones between the logic board and the trackpad. iFixit found the two thin cells wired in parallel and the pair in series with the thick ones, so the pack behaves like a three-cell battery. The M2 pack weighed 251.5 g.",
        ],
      },
      {
        h: 'The gauge',
        p: [
          "A fuel gauge chip in the pack measures current, voltage and temperature and keeps a model of the cells. The percentage is its estimate of the charge left against the pack's present full capacity, not its capacity when new.",
        ],
      },
      {
        h: 'Time left',
        p: ["Time left is macOS's estimate from recent drain. It moves as your load changes, and macOS gives none while on the adapter."],
      },
      {
        h: 'Temperature',
        p: [
          'Lithium cells age faster when hot, especially when full. Apple says the ideal room temperature for its devices is 16 to 22 °C, and that above 35 °C battery capacity can be permanently damaged. Battery University measured cells stored a year at 40 °C: 85% capacity left when kept at 40% charge, 65% when kept full.',
        ],
      },
    ],
    source:
      'The `AppleSmartBattery` entry in the IOKit registry: `CurrentCapacity`, `IsCharging`, `ExternalConnected`, `TimeRemaining` and `Temperature` (hundredths of a degree). On macOS 27 some pack details moved to `AppleSmartBatteryPack`. Try `ioreg -rc AppleSmartBattery` in Terminal.',
    sources: [
      cite(R.airSpecs, '53.8 Wh lithium-polymer battery.'),
      cite(R.ifixitM2, 'The four-cell layout, the parallel pair and the pack mass.'),
      cite(R.appleBatteries, 'Ideal temperature range and damage above 35 °C.'),
      cite(R.bu808, 'Capacity left after a year at different temperatures and charge levels.'),
    ],
    related: ['battery-health', 'cycles', 'charge-held', 'battery-flow'],
    now: ({ s }) => {
      const b = s.battery
      if (!b) return 'The reader sees no battery on this Mac.'
      const state = b.chargeHeld ? 'held on the adapter' : b.charging ? 'charging' : b.acAttached ? 'on the adapter, not charging' : 'running on battery'
      return `${Math.round(b.percent)}%, ${state}. Battery temperature ${temp(s.thermal.batteryTempC)}.`
    },
  },
  'battery-health': {
    title: 'Battery health',
    group: 'Battery',
    summary: 'How much charge the pack can hold now, compared with what it was designed to hold.',
    sections: [
      {
        h: 'The number',
        p: [
          "The gauge keeps a nominal full charge capacity in milliamp-hours, a smoothed estimate of what the pack holds today. Health is that divided by the design capacity, the same sum System Settings uses for Maximum Capacity. A new pack can read a little over 100%, because cells leave the factory with some spread; like System Settings, the panel then shows 100%, with the raw figure beside it.",
        ],
      },
      {
        h: 'Why it drops',
        p: [
          'Every charge and discharge causes small, permanent chemical changes in the cells. Heat and long periods at full charge speed them up. Battery University found that even at 25 °C, a year at full charge left 80% capacity, against 96% for a year at 40% charge.',
        ],
      },
      {
        h: "Apple's figure",
        p: ['Apple says its Mac laptop batteries are designed to retain up to 80% of their original capacity at their maximum cycle count, which is 1000 for every Apple silicon MacBook Air.'],
      },
      {
        h: 'Why it can differ from System Settings',
        p: ['The gauge also keeps a raw maximum capacity (`AppleRawMaxCapacity`). It moves with temperature and charge level and often reads 3 to 6 points below the nominal figure, which is why tools such as coconutBattery can show 94% on a Mac whose System Settings says 99%. SiliconSight reads the nominal figure, so it should match System Settings to within rounding.'],
      },
    ],
    source: '`NominalChargeCapacity` divided by `DesignCapacity`, from `AppleSmartBattery` (falls back to `AppleRawMaxCapacity` on Macs that lack the nominal figure).',
    sources: [cite(R.cycles, '80% at the maximum cycle count, and 1000 cycles for Apple silicon Airs.'), cite(R.bu808, 'How heat and high charge age lithium cells.')],
    related: ['cycles', 'battery', 'charge-held'],
    now: ({ s }) => {
      const h = s.battery?.healthPct
      if (!s.battery) return 'The reader sees no battery on this Mac.'
      return h == null ? 'This Mac does not report maximum and design capacity, so health shows n/a.' : `Your pack holds ${pct(h, 1)} of its design capacity.`
    },
  },
  cycles: {
    title: 'Charge cycles',
    group: 'Battery',
    summary: "One cycle is using 100% of the battery's capacity, in any number of pieces.",
    sections: [
      {
        h: 'Counting',
        p: [
          "Apple's example: use half the battery one day and recharge it, then do the same the next day, and that counts as one cycle, not two. The gauge adds up discharge and counts a cycle each time the total reaches the pack capacity.",
        ],
      },
      {
        h: 'How many',
        p: [
          'Apple lists a maximum cycle count of 1000 for every Apple silicon MacBook Air, from the M1 to the M5. That is the count at which Apple expects the pack to still hold up to 80% of its original capacity, not a point where the battery stops working.',
        ],
      },
      {
        h: 'Small discharges are fine',
        p: ['Lithium-ion has no memory effect. Battery University says the smaller the discharge, the longer the battery lasts, so topping up often does no harm.'],
      },
      {
        h: 'On the adapter',
        p: ['While the Mac runs from the adapter and the charge is held, the battery is hardly used, so the count barely moves.'],
      },
    ],
    source: '`CycleCount` from `AppleSmartBattery`.',
    sources: [cite(R.cycles, 'What a cycle is and the maximum count per model.'), cite(R.bu808, 'Partial discharge is fine; no memory effect.')],
    related: ['battery-health', 'battery', 'charge-held'],
    now: ({ s }) => {
      const c = s.battery?.cycleCount
      if (!s.battery) return 'The reader sees no battery on this Mac.'
      return c == null ? 'This Mac does not report a cycle count, so it shows n/a.' : `${num(c)} cycles so far, out of the 1000 Apple rates the Air for.`
    },
  },
  'charge-held': {
    title: 'Charge held on the adapter',
    group: 'Battery',
    summary: 'The Mac is plugged in, not charging, and below 100%. Usually macOS has paused charging on purpose and the Mac runs from the adapter.',
    sections: [
      {
        h: 'Why macOS holds the charge',
        p: [
          [
            'Optimized Battery Charging: when macOS predicts the Mac will stay plugged in for a long time, it delays charging past 80%.',
            'Charge Limit: on macOS Tahoe 26.4 or later you can set a full-charge level between 80% and 100% for Macs with Apple silicon.',
            'Battery health management: charging can pause for a while, letting the battery drift down to around 90% before it resumes.',
            'Heat: if the battery is too warm, charging may stop at 80% until it cools.',
          ],
          'Both Optimized Battery Charging and Charge Limit sometimes charge to 100% anyway, to keep the battery estimate accurate.',
        ],
      },
      {
        h: 'Why it helps',
        p: ['Lithium cells age fastest when kept full and warm. Holding a lower charge while you work on the adapter cuts that time, and the battery is still there if you unplug.'],
      },
      {
        h: 'What this app can and cannot tell',
        p: [
          'The reader sees three facts: the adapter is connected, the battery is not charging, and the charge is below 100%. It cannot tell which reason caused it. The battery menu in the menu bar often says.',
          'One reason is not deliberate: an adapter too small for the load. Apple notes the Mac then says Not Charging while plugged in. You can tell from battery flow: a held charge sits near 0 W, a weak adapter shows the battery draining.',
        ],
      },
    ],
    source: 'Worked out by the reader from `ExternalConnected`, `IsCharging` and `CurrentCapacity` in `AppleSmartBattery`.',
    sources: [cite(R.optimized, 'Optimized Battery Charging, the 80% hold and Charge Limit on macOS Tahoe 26.4.'), cite(R.wontCharge, 'Pauses for battery health, heat, and Not Charging with a weak adapter.')],
    related: ['battery', 'battery-health', 'adapter', 'battery-flow'],
    now: ({ s }) => {
      const b = s.battery
      if (!b) return 'The reader sees no battery on this Mac.'
      if (b.chargeHeld) return `Charging is held at ${Math.round(b.percent)}% right now.`
      return b.acAttached ? `Not held right now: the battery is ${b.charging ? 'charging' : 'full or not reporting'}.` : 'Not held right now: the Mac is on battery.'
    },
  },
  'battery-flow': {
    title: 'Battery flow',
    group: 'Battery',
    summary: 'How many watts go into or come out of the battery right now.',
    sections: [
      {
        h: 'How it is computed',
        p: ['The gauge reports the current through the pack in milliamps and its voltage in millivolts. Multiplied, that is watts. Positive means charging; negative means the battery is powering the Mac.'],
      },
      {
        h: 'On the adapter',
        p: ['The adapter feeds the Mac first and the battery gets what is left. Under heavy load a small adapter may not cover both, so the battery charges slowly or even drains while plugged in.'],
      },
      {
        h: 'On battery',
        p: ["The drain is close to the Mac's system power. Watch it fall when you dim the screen, and rise when a build starts. Divide 53.8 Wh by the drain to estimate hours left from full."],
      },
    ],
    source: '`InstantAmperage` (or `Amperage`) times `Voltage`, from `AppleSmartBattery`.',
    sources: [cite(R.wontCharge, 'A small adapter under heavy load cannot charge the battery.'), cite(R.airSpecs, 'The 53.8 Wh capacity.')],
    related: ['adapter', 'power', 'charge-held', 'battery'],
    now: ({ s }) => {
      const w = s.battery?.watts
      if (!s.battery) return 'The reader sees no battery on this Mac.'
      if (!ok(w)) return 'The reader could not read battery current, so it shows n/a.'
      return w > 0.2 ? `${watts(w)} is going into the battery.` : w < -0.2 ? `The battery is supplying ${watts(-w)}.` : 'Almost nothing flows in or out of the battery.'
    },
  },
  adapter: {
    title: 'Power adapter',
    group: 'Battery',
    summary: "The charger's rating in watts, as agreed with the Mac when it was plugged in.",
    sections: [
      {
        h: 'Negotiation',
        p: [
          'USB-C chargers use USB Power Delivery. When you plug in, the charger lists the voltages and currents it can supply and the Mac picks one. A USB-C controller beside each port handles that conversation. The MagSafe 3 cable plugs into the same kind of USB-C adapter.',
          'The figure shown is that rating, not what the Mac draws right now.',
        ],
      },
      {
        h: 'What it limits',
        p: ['A small adapter covers light use and charging. Under heavy load the Mac can need more than it supplies, and the battery makes up the difference.'],
      },
    ],
    source: '`AdapterDetails`, field `Watts`, from `AppleSmartBattery`, read only while an adapter is connected.',
    sources: [
      cite(R.asahiPd, 'The USB-PD controllers in Apple silicon Macs.'),
      cite(R.ifixitChips, 'The TI USB Type-C controller with power delivery on the M2 Air.'),
      cite(R.wontCharge, 'An adapter too small for the load cannot charge the battery.'),
    ],
    related: ['battery-flow', 'charge-held', 'power-delivery'],
    now: ({ s }) => {
      const b = s.battery
      if (!b) return 'The reader sees no battery on this Mac.'
      return b.acAttached ? `A ${watts(b.adapterW)} adapter is connected.` : 'No adapter is connected.'
    },
  },

  // Network
  wifi: {
    title: 'Wi-Fi and Bluetooth',
    group: 'Network',
    summary: 'A separate radio chip on the logic board, with antennas near the hinge where the aluminium case does not block the signal.',
    sections: [
      {
        h: 'The radio',
        p: [
          "The M5 MacBook Air uses Apple's own N1 wireless chip for Wi-Fi 7 (802.11be) and Bluetooth 6. The M2 Air used a module from USI. The radio runs its own firmware and connects to the chip over PCIe; on Apple silicon the SMC even switches the radio's power line, which is how Asahi Linux found it.",
        ],
      },
      {
        h: 'Antennas',
        p: ['Aluminium blocks radio waves, so the antennas sit in the hinge area, where the signal can get out. The drawing routes network traffic toward the hinge for that reason; the exact antenna position is an estimate.'],
      },
      {
        h: 'What the rate covers',
        p: ['The network rate counts the busiest physical interface, Wi-Fi or wired. It does not see Bluetooth.'],
      },
    ],
    source: "Radio details from Apple's tech specs for the M5 MacBook Air. Traffic: see Network rates.",
    sources: [cite(R.airSpecs, 'The Apple N1 chip, Wi-Fi 7 and Bluetooth 6.'), cite(R.ifixitChips, 'The USI Wi-Fi and Bluetooth module in the M2 Air.'), cite(R.asahiSmc, 'An SMC GPIO powers the Wi-Fi and Bluetooth PCIe devices.')],
    related: ['network-rates', 'io-block'],
    now: ({ s }) => `The busiest interface is ${s.net.iface ?? 'n/a'}, moving ${rate(s.net.rxBps + s.net.txBps)}.`,
  },
  'network-rates': {
    title: 'Network rates',
    group: 'Network',
    summary: 'Bytes received and sent per second on the busiest physical network interface.',
    sections: [
      {
        h: 'Where the numbers come from',
        p: [
          'Every network interface keeps byte counters from the moment it comes up. Once a second the reader lists the interfaces, reads the counters and divides the change by the time since the last read.',
          'It shows the physical interface that moved the most data this second, usually `en0`, the Wi-Fi on a MacBook Air, and keeps showing it while the network is idle.',
        ],
      },
      {
        h: 'What is left out',
        p: [
          'Loopback (`lo0`) never leaves the Mac. VPN tunnels (`utun`) carry traffic that also crosses the physical interface, so counting both would double it. AWDL and LLW, the links AirDrop and other Apple peer to peer features use, and bridges are skipped too.',
        ],
      },
      {
        h: 'Precision',
        p: [
          'The counters are 32-bit, so they wrap every 4 GiB; the reader handles one wrap per second. For apps that are not part of macOS, the kernel rounds the byte counts, so very low rates move in steps of about 1 KB/s.',
          'Bytes are counted at the interface, so they include protocol headers, not only the file you download.',
        ],
      },
    ],
    source: '`getifaddrs`, link-level entries, `if_data.ifi_ibytes` and `ifi_obytes`.',
    sources: [cite(R.xnuIfVar, 'ifi_ibytes and ifi_obytes are 32-bit counters.'), cite(R.xnuRound, 'The kernel rounds byte counts for non-platform processes.')],
    related: ['wifi', 'reader'],
    now: ({ s }) => `${s.net.iface ?? 'No interface'}: ${rate(s.net.rxBps)} down, ${rate(s.net.txBps)} up.`,
  },

  // Sensors
  sensors: {
    title: 'Lid, camera, microphone and other sensors',
    group: 'Sensors',
    summary: 'The lid hinge angle, whether the camera or microphone is in use, whether audio plays, display brightness, keyboard light and trackpad touches.',
    sections: [
      {
        h: 'How each one is read',
        p: [
          [
            'Lid angle: a hinge sensor that appears as a HID device. The reader listens for its reports.',
            'Camera: CoreMediaIO says whether any app has the built-in camera running. No image is read.',
            'Microphone and audio output: Core Audio says whether the default input or output device is running. No audio is read.',
            'Display brightness: the private DisplayServices framework.',
            'Keyboard light: the private CoreBrightness framework.',
            'Trackpad fingers: the private MultitouchSupport framework. Positions only, never stored.',
          ],
        ],
      },
      {
        h: 'Permissions',
        p: ['None of these asks for permission. On the test machine, watching the privacy daemon `tccd` showed no prompt for the lid sensor or the trackpad, and the camera and microphone are never opened.'],
      },
      {
        h: 'Gotchas',
        p: ['Three of the six use private frameworks that a macOS update can change or remove. When one breaks, its value becomes n/a.'],
      },
    ],
    source: 'IOHID for the lid, CoreMediaIO and Core Audio "is running somewhere" properties, and the private frameworks named above.',
    sources: [cite(R.lidSensor, 'Which HID device holds the lid angle.'), cite(R.cmioRunning, 'The camera running-somewhere property.'), cite(R.audioRunning, 'The audio device running-somewhere property.')],
    related: ['lid-angle', 'camera-mic', 'audio-path', 'camera-path', 'display-brightness', 'keyboard-light', 'trackpad', 'reader'],
    now: ({ s }) => {
      const x = sensorsOf(s)
      const onOff = (v: boolean | null) => (v == null ? 'n/a' : v ? 'in use' : 'off')
      return `Lid ${x.lidAngleDeg == null ? 'n/a' : `${Math.round(x.lidAngleDeg)}°`}, camera ${onOff(x.cameraInUse)}, microphone ${onOff(x.micInUse)}.`
    },
  },
  'lid-angle': {
    title: 'Lid angle sensor',
    group: 'Sensors',
    summary: 'A sensor in the hinge reports how far the lid is open, in degrees. The display in the drawing tilts to match it.',
    sections: [
      {
        h: 'What it is',
        p: [
          'Older MacBooks knew only open or closed, from a magnet and a Hall effect sensor. Starting with the 16-inch MacBook Pro in 2019, iFixit found a sensor at the hinge that measures the angle itself. Apple lists it as a separate repair part on recent MacBook Pros and asks for Repair Assistant to be run after replacing it.',
          'iFixit suggested it replaces the Hall effect sensor that older models used. There is no public API for the angle.',
        ],
      },
      {
        h: 'How the reader gets it',
        p: [
          'The sensor shows up as a HID device from Apple (vendor 0x05AC, product 0x8104). Sam Henri Gold worked out that report 1 holds the angle in whole degrees, and published LidAngleSensor, an app that shows it.',
          'The reader listens for the sensor\'s own reports, about one a second at rest and more while the hinge moves, and sends the angle on the fast channel up to 30 times a second.',
        ],
      },
      {
        h: 'Gotchas',
        p: ['The report layout is undocumented, so a macOS update could break it. Desktops and older laptops have no sensor and show n/a. With the lid closed on an external display it reads 0.'],
      },
    ],
    source: 'The "las" HID sensor, report 1, a 9-bit angle in degrees, read from its input reports.',
    sources: [cite(R.lidSensor, 'The HID device and the report layout.'), cite(R.lidEngadget, 'iFixit found the sensor in the 2019 16-inch MacBook Pro.'), cite(R.lidRepair, 'Apple treats it as a repair part that needs Repair Assistant.')],
    related: ['sensors', 'layout', 'trackpad'],
    now: ({ s }) => {
      const a = sensorsOf(s).lidAngleDeg
      return a == null ? 'This Mac reports no lid angle, so it shows n/a.' : `The lid is open ${Math.round(a)}°.`
    },
  },
  'camera-mic': {
    title: 'Camera, microphone and audio in use',
    group: 'Sensors',
    summary: 'Whether some app has the built-in camera or the microphone running, and whether sound is playing. The reader asks macOS; it never opens either device.',
    sections: [
      {
        h: 'How it is read',
        p: [
          'Core Audio and CoreMediaIO give every device a property called "is running somewhere": true when any process on the Mac is using it. The reader reads that property for the built-in cameras, the default input (the microphone) and the default output (the speakers or headphones).',
          'That is a yes or no only. No image or sound passes through the reader.',
        ],
      },
      {
        h: "macOS's own indicators",
        p: [
          'macOS shows a dot next to Control Center in the menu bar: orange while the microphone is in use, green while a camera is in use, purple while system audio is being recorded. Only one dot shows at a time, so with both camera and microphone on you see green. Open Control Center to see which apps are using them.',
          "The What's happening card shows the same facts, so you notice a call or a recording without looking at the menu bar.",
        ],
      },
      {
        h: 'Gotchas',
        p: [
          'Only built-in cameras are watched, and only those present when the reader started. An external camera is not counted.',
          'Audio output reads as playing whenever an app holds the output device open, which some apps do even while silent.',
        ],
      },
    ],
    source: '`kCMIODevicePropertyDeviceIsRunningSomewhere` on each built-in camera, and `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default input and output devices.',
    sources: [cite(R.cmioRunning, 'The CoreMediaIO property for cameras.'), cite(R.audioRunning, 'The Core Audio property for input and output devices.'), cite(R.indicators, 'The orange, green and purple menu bar dots.')],
    related: ['sensors', 'story'],
    now: ({ s }) => {
      const x = sensorsOf(s)
      const on = (v: boolean | null, y: string, n: string) => (v == null ? 'n/a' : v ? y : n)
      return `Camera ${on(x.cameraInUse, 'in use', 'off')}, microphone ${on(x.micInUse, 'in use', 'off')}, audio ${on(x.audioPlaying, 'playing', 'silent')}.`
    },
  },
  'display-brightness': {
    title: 'Display brightness',
    group: 'Sensors',
    summary: 'The built-in display backlight level, from 0 to 100%. It is one of the biggest power draws on an idle laptop.',
    sections: [
      {
        h: 'What it is',
        p: [
          'The Air has an LED-backlit LCD, rated at 500 nits. Brightness sets the backlight, not the pixels, so a dimmer screen saves power without the GPU doing any less. On an idle Air the backlight is often a bigger load than the whole chip; the Try it below shows how much on yours.',
          'Auto-brightness uses the ambient light sensor near the camera.',
        ],
      },
      {
        h: 'Try it',
        p: ['Open the Power panel, then press the brightness keys. System power steps with each press while chip power stays flat.'],
      },
      {
        h: 'Gotchas',
        p: ['The reader uses a private DisplayServices call, so a macOS update could break it. With the lid closed there is no built-in display online, so it reads n/a.'],
      },
    ],
    source: '`DisplayServicesGetBrightness` (private DisplayServices framework) on the display that `CGDisplayIsBuiltin` reports.',
    sources: [cite(R.airSpecs, 'LED-backlit display, 500 nits.'), cite(R.keyboardLight, 'The light sensor sits near the camera.')],
    related: ['display-engine', 'power', 'keyboard-light'],
    now: ({ s, history }) => {
      const b = sensorsOf(s).displayBrightness
      if (b == null) return 'The reader cannot read built-in display brightness right now, so it shows n/a.'
      const sys = recentAvg(history, (x) => x.power.systemW)
      return `The backlight is at ${pct(b)}${sys == null ? '' : `, with the whole Mac drawing ${watts(sys)}`}.`
    },
  },
  'keyboard-light': {
    title: 'Keyboard backlight',
    group: 'Sensors',
    summary: 'How bright the keyboard backlight is, from 0 to 100%.',
    sections: [
      {
        h: 'How it behaves',
        p: [
          'You set it with the brightness keys or in System Settings under Keyboard. macOS can also adjust it in low light, using the light sensor at the top of the display near the camera, and turn it off after a period of inactivity that you choose.',
          'With the lid closed on an external display, macOS turns it off, so it reads 0.',
        ],
      },
      {
        h: 'Gotchas',
        p: ['The reader uses the private CoreBrightness framework. If a macOS update changes it, the value shows n/a.'],
      },
    ],
    source: '`KeyboardBrightnessClient brightnessForKeyboard:` from the private CoreBrightness framework.',
    sources: [cite(R.keyboardLight, 'Keyboard brightness settings, low light adjustment and the inactivity timeout.')],
    related: ['display-brightness', 'sensors'],
    now: ({ s }) => {
      const k = sensorsOf(s).keyboardBacklight
      return k == null ? 'The reader cannot read the keyboard backlight here, so it shows n/a.' : k === 0 ? 'The keyboard backlight is off.' : `The keyboard backlight is at ${pct(k)}.`
    },
  },
  trackpad: {
    title: 'Trackpad',
    group: 'Sensors',
    summary: 'A glass surface that senses each finger by capacitance and senses pressure with force sensors. The overview draws your fingers on it live.',
    sections: [
      {
        h: 'How it senses',
        p: [
          'A grid under the glass senses each finger by the change in capacitance it causes, so the trackpad knows where every finger is and how much of it touches.',
          'Force Touch trackpads do not click mechanically. iFixit found strain gauges on flexing supports that measure how hard you press, and a Taptic Engine, electromagnets pulling against a metal rail, that makes the click you feel.',
        ],
      },
      {
        h: 'What the reader sees',
        p: [
          'The private MultitouchSupport framework gives each touching finger an id, a position from 0 to 1 across and front to back, and a size. The reader sends those on the fast channel up to 30 times a second while a finger is down, and nothing while none is.',
          'No clicks, gestures or keystrokes are read, and positions are never stored.',
        ],
      },
      {
        h: 'Gotchas',
        p: ['The layout of the per-finger data comes from public reverse engineering and could change with macOS. The reader has not been checked against real touches for every field.'],
      },
    ],
    source: '`MTDeviceCreateDefault`, `MTRegisterContactFrameCallback` and `MTDeviceStart` from the private MultitouchSupport framework.',
    sources: [cite(R.forceTouch, 'Strain gauges and the Taptic Engine in the Force Touch trackpad.')],
    related: ['sensors', 'lid-angle', 'layout'],
  },

  'audio-path': {
    title: 'Speakers, microphones and the sound path',
    group: 'Sensors',
    summary: 'Sound leaves as numbers from an app, is mixed by Core Audio, turned into voltage by small amplifier chips and played by four speakers along the hinge. Three microphones at the left end of the hinge do the reverse.',
    sections: [
      {
        h: 'Going out',
        p: [
          {
            steps: [
              'An app hands Core Audio buffers of samples, typically 48,000 a second per channel.',
              'Core Audio mixes every app together, applies volume and the speaker tuning, and sends the result to the output device.',
              'Smart amplifier chips, one per speaker group, turn the digital stream into voltage. Asahi Linux found Apple variants of the TI TAS2764 in recent laptops; the headphone jack has its own Cirrus Logic codec.',
              'Two woofers and two tweeters under the case, near the hinge, push the sound out through the gap between the case and the display. There are no grilles.',
            ],
          },
        ],
      },
      {
        h: 'Coming in',
        p: [
          'Apple specifies a three-mic array with directional beamforming. Each mic hears everything; software compares the tiny timing differences between them to favour sound from in front of the screen and suppress the rest. That is also what powers the Voice Isolation mic mode.',
          'The Asahi Linux project had to write its own beamformer, Triforce, because the raw array is too sensitive and hears in every direction. That shows the beamforming happens in software on the main chip, not in the mics.',
          'When the lid closes, Apple disconnects the built-in microphones in hardware, so no software can listen.',
        ],
      },
      {
        h: 'Where they are',
        p: [
          'iFixit found the speakers under the hinge cover in the M2 Air, the chassis the M5 still uses. Apple does not publish the mic positions; older Airs put the array at the left end, which is where the map draws it, so treat that one as an estimate.',
        ],
      },
      {
        h: 'What the reader sees',
        p: ['Only whether the default output and input devices are running. No audio, no level, nothing that needs the microphone permission.'],
      },
    ],
    source: '`kAudioDevicePropertyDeviceIsRunningSomewhere` on the default output and input devices. Placement from the iFixit teardown and Apple spec sheet.',
    sources: [
      cite(R.airSpecs, 'Four-speaker sound system, three-mic array with directional beamforming.'),
      cite(R.ifixitM2, 'Speakers under the hinge cover, sound out through the gap.'),
      cite(R.micDisconnect, 'Mics cut off in hardware when the lid closes.'),
      cite(R.triforce, 'The mic array needs software beamforming; mics in a line or triangle.'),
      cite(R.tasAmp, 'Apple variants of the TAS2764 speaker amplifier.'),
      cite(R.cs42l84, 'The CS42L84 headphone codec: stereo DAC, mono ADC.'),
      cite(R.coreAudio, 'The framework that mixes and routes sound.'),
      cite(R.beamforming, 'How an array of sensors favours one direction.'),
      cite(R.audioRunning, 'The running-somewhere property the reader reads.'),
    ],
    related: ['camera-mic', 'sensors', 'camera-path'],
    now: ({ s }) => {
      const x = sensorsOf(s)
      const on = (v: boolean | null, y: string, n: string) => (v == null ? 'n/a' : v ? y : n)
      return `Speakers ${on(x.audioPlaying, 'playing', 'silent')}, microphones ${on(x.micInUse, 'in use', 'off')}.`
    },
  },
  'camera-path': {
    title: 'Camera and its green light',
    group: 'Sensors',
    summary: 'The 12 MP camera in the notch sends raw sensor data to the image signal processor on the main chip, which turns it into clean frames in memory for the app. The green light beside it comes on whenever the camera runs.',
    sections: [
      {
        h: 'From light to frames',
        p: [
          {
            steps: [
              'Light passes the lens onto a 12 megapixel sensor, which records one colour per pixel through a mosaic filter.',
              'The raw readout travels down the display cable through the hinge to the ISP, the image signal processor on the main chip.',
              'The ISP fills in the missing colours, removes noise and sets exposure and white balance. Its traffic shows in the reader as ISP GB/s.',
              'Finished frames land in unified memory, where the app, the encoder for a call, or the GPU for effects can use them without copying.',
            ],
          },
        ],
      },
      {
        h: 'The green light',
        p: [
          'Apple says the camera is engineered so it cannot activate without the indicator light also turning on. It does not publish the circuit. On MacBook Neo Apple moved to an on-screen light driven by a protected part of the chip, and describes that design in its Platform Security guide.',
          'With the lid closed the camera is not disconnected, Apple says, because the closed lid blocks its view. The microphones are disconnected.',
        ],
      },
      {
        h: 'The light sensor next to it',
        p: ['The ambient light sensor sits by the camera in the notch. Apple warns that a camera cover can stop auto-brightness and True Tone working, because it covers that sensor too.'],
      },
      {
        h: 'What the reader sees',
        p: ['Whether any app has the built-in camera running, and the ISP memory traffic. No image ever reaches the reader.'],
      },
    ],
    source: '`kCMIODevicePropertyDeviceIsRunningSomewhere` on the built-in cameras, and the IOReport `PMP` `DCS BW` channel `ISP RD+WR` for the ISP.',
    sources: [
      cite(R.airSpecs, '12 MP Center Stage camera.'),
      cite(R.cameraCover, 'The camera cannot activate without its light; a cover blocks the light sensor.'),
      cite(R.micDisconnect, 'Why the camera is not disconnected when the lid closes.'),
      cite(R.accel, 'The ISP among the Apple silicon accelerators.'),
      cite(R.cmioRunning, 'The running-somewhere property the reader reads.'),
    ],
    related: ['camera-mic', 'media-engine', 'display-brightness', 'sensors'],
    now: ({ s }) => {
      const c = sensorsOf(s).cameraInUse
      const isp = mediaOf(s).ispGBs
      const cam = c == null ? 'The reader cannot tell whether the camera is on.' : c ? 'The camera is on, so its green light is on.' : 'The camera is off.'
      return isp == null ? cam : `${cam} The ISP is ${busy(isp) ? `moving ${num(isp, 1)} GB/s` : 'idle'}.`
    },
  },

  // How the reader measures things
  reader: {
    title: 'How the reader works',
    group: 'How the reader measures things',
    summary: "A small Swift program reads your Mac's counters once a second and streams them to this page over a local WebSocket.",
    sections: [
      {
        h: 'The loop',
        p: [
          'On connect the reader sends one hello with the hardware facts, then a sample every second. The slow reads (SMC temperatures, the process list, the battery and the bandwidth histogram) run every two seconds and are reused in between. Process CPU stays exact because it is a delta over that two second window.',
          'A separate fast channel sends the lid angle and trackpad fingers, up to 30 times a second, only while they move.',
        ],
      },
      {
        h: 'Local only',
        p: [
          'It listens on 127.0.0.1, so only programs on this Mac can connect, and it checks the Host and Origin of every request so other websites cannot read it. It needs no root and triggers no permission prompts. It never reads keystrokes, camera images or audio.',
          'It costs about 1% of one core while a page is connected.',
        ],
      },
      {
        h: 'Null, never zero',
        p: ['Any value the reader cannot read on this Mac is sent as null and shown as n/a. A made-up zero would look like a real reading.'],
      },
      {
        h: 'Private interfaces',
        p: ['Several readings use private, undocumented macOS interfaces: IOReport, the SMC and a few frameworks. Any macOS update can change them. When one breaks, the value becomes n/a rather than wrong.'],
      },
      {
        h: 'Demo data',
        p: ['When no reader answers, the page runs on synthetic data shaped like an M5 Air and says Demo data at the top. Every number is then made up.'],
      },
    ],
    source: '`reader/` in this repository. The message format is in `CONTRACT.md`.',
    sources: [cite(R.macmon, 'The open source tool whose counter IDs the reader uses on macOS 27.'), cite(R.iokit, 'The framework most hardware facts come through.')],
    related: ['ioreport', 'smc', 'sysctl', 'iokit', 'story'],
    now: ({ hw, history }) => `The page holds ${history.length} samples, about ${span(history)} min of history. The reader reports ${hw.model} on macOS ${hw.macosVersion}.`,
  },
  ioreport: {
    title: 'IOReport energy counters',
    group: 'How the reader measures things',
    summary: 'A private macOS interface drivers use to publish counters: energy used, time in each power state, memory traffic. The reader uses it for chip power, clocks, GPU use and bandwidth.',
    sections: [
      {
        h: 'What it is',
        p: [
          "IOReport is a reporting system inside macOS's driver framework. Drivers publish channels in groups such as `Energy Model`, `CPU Stats` and `GPU Stats`. A client subscribes to some channels, takes a sample, takes another later, and asks for the difference.",
          "Apple's `powermetrics` tool reports similar numbers but needs root. The reader reads the channels it uses without special rights, through `/usr/lib/libIOReport.dylib`, which it loads at run time. Open source tools such as macmon do the same.",
        ],
      },
      {
        h: 'Kinds of channel',
        p: [
          [
            'Simple: one number, such as energy in millijoules, microjoules or nanojoules.',
            'State: time spent in each state, such as each CPU frequency step.',
            'Histogram: how often a value fell in each band, such as DRAM bandwidth.',
          ],
        ],
      },
      {
        h: 'Why some values are null',
        p: [
          'IOReport is private and undocumented, and Apple changes it between releases. On macOS 27 the `Energy Model` channels for CPU, Neural Engine and memory read zero all the time, and the live counters moved to hidden channels of the CLPC driver. The reader names those by number, using ids the macmon project extracted from macOS 27. The M5 entry has been checked on real hardware; the others have not.',
          'A dead channel reports exact zeros, so showing 0 W would be false. The reader treats a source as live only when its CPU counter moves, and sends null otherwise. Memory power has no live channel on macOS 27, so it is n/a there.',
        ],
      },
      {
        h: 'Cost',
        p: ['Reading counters takes CPU time. In the reader\'s own measurements the bandwidth histogram costs about as much as everything else together, so it is read every two seconds.'],
      },
    ],
    source: '`IOReportCopyChannelsInGroup`, `IOReportCreateSubscription`, `IOReportCreateSamples` and `IOReportCreateSamplesDelta` from libIOReport.',
    sources: [cite(R.macmon, 'Reading IOReport without root, and the CLPC counter ids for macOS 27.'), cite(R.accel, 'PMP, the coprocessor behind the bandwidth histogram.')],
    related: ['power', 'dvfs', 'memory-interface', 'reader'],
    now: ({ s }) => {
      const p = s.power
      const all: [string, number | null][] = [
        ['CPU power', p.cpuW],
        ['GPU power', p.gpuW],
        ['Neural Engine power', p.aneW],
        ['memory power', p.dramW],
        ['memory bandwidth', s.memory.bandwidthGBs],
      ]
      const have = all.filter(([, v]) => v != null).map(([k]) => k)
      const miss = all.filter(([, v]) => v == null).map(([k]) => k)
      if (!have.length) return 'None of the IOReport values are readable on this Mac right now.'
      return `Readable now: ${have.join(', ')}.${miss.length ? ` n/a: ${miss.join(', ')}.` : ''}`
    },
  },
  smc: {
    title: 'The System Management Controller',
    group: 'How the reader measures things',
    summary: 'A small always-on controller for temperatures, fans, power readings, the battery, the backlight and the lid switch. The reader reads its sensors.',
    sections: [
      {
        h: 'What it does',
        p: [
          'The SMC handles temperature sensors, voltage and power meters, battery status, fans, the LCD backlight and the lid switch, and keeps running while the Mac sleeps. On Apple silicon it is a coprocessor inside the chip that macOS talks to through a shared mailbox, the same RTKit protocol as the other coprocessors.',
        ],
      },
      {
        h: 'Keys',
        p: [
          'Software reads it through four-character keys. Each key has a type, such as a 32-bit float (`flt`) or an unsigned integer (`ui8`, `ui32`). Asahi Linux counted about 1400 keys on a MacBook Pro. `#KEY` gives the number of keys, `FNum` the number of fans and `PSTR` system power in watts.',
          'Apple does not document the keys. Their meanings come from community research, mostly by guessing from the names.',
        ],
      },
      {
        h: 'Cost',
        p: ['Each key read is a call into the kernel, and the temperature keys alone are about forty calls. The reader reads temperatures every two seconds to stay light.'],
      },
    ],
    source: '`IOServiceOpen` on `AppleSMC`, then `IOConnectCallStructMethod` with the SMC parameter struct.',
    sources: [cite(R.asahiSmc, 'What the SMC handles, key types, about 1400 keys, PSTR.'), cite(R.smcPatch, 'The SMC is reached over the RTKit mailbox like other coprocessors.')],
    related: ['temperatures', 'power', 'cooling', 'reader'],
    now: ({ history }) => {
      const w = recentAvg(history, (x) => x.power.systemW)
      return w == null ? 'The reader cannot read PSTR on this Mac, so system power shows n/a.' : `PSTR reads ${watts(w)}, averaged over the last few seconds.`
    },
  },
  sysctl: {
    title: 'sysctl and Mach statistics',
    group: 'How the reader measures things',
    summary: "The kernel's own counters: hardware facts through sysctl, CPU ticks and memory pages through Mach host calls.",
    sections: [
      {
        h: 'sysctl',
        p: [
          'sysctl is a key-value interface to kernel state. The reader uses `hw.model`, `machdep.cpu.brand_string`, `hw.memsize`, `hw.perflevel0.physicalcpu` and its siblings for core counts, `vm.swapusage` for swap and `kern.memorystatus_vm_pressure_level` for memory pressure.',
          'You can read any of them in Terminal, for example `sysctl hw.perflevel0.physicalcpu`. On the M5, `sysctl hw.perflevel0.name` says Super.',
        ],
      },
      {
        h: 'Mach host calls',
        p: [
          "XNU's Mach layer keeps tick counts per CPU (`host_processor_info`) and virtual memory statistics (`host_statistics64`). The reader turns ticks into CPU percentages and page counts into bytes. `vm_stat` in Terminal prints the same memory counters.",
        ],
      },
      {
        h: 'Processes',
        p: ["`proc_listpids` and `proc_pid_rusage` give each process's CPU time and memory footprint, for processes you own."],
      },
    ],
    source: 'Public APIs in libSystem. None needs special rights.',
    sources: [cite(R.sysctl3, 'The sysctl interface.'), cite(R.hostInfo, 'host_processor_info.'), cite(R.footprint, 'Physical footprint, the per-process memory figure.')],
    related: ['cpu-usage', 'memory-kinds', 'memory-pressure', 'reader'],
    now: ({ hw }) => `hw.model is ${hw.model}, machdep.cpu.brand_string is ${hw.chip}, hw.memsize is ${memGB(hw.memBytes, 0)}, with ${hw.pCores} cores in perflevel0 and ${hw.eCores} in the slower levels.`,
  },
  iokit: {
    title: 'The IOKit registry',
    group: 'How the reader measures things',
    summary: 'A live tree of every device and driver in the Mac, each with properties. Many hardware facts are simply properties in it.',
    sections: [
      {
        h: 'What the reader reads',
        p: [
          [
            '`AppleSmartBattery`: charge, current, voltage, capacity, cycles and adapter.',
            '`IOBlockStorageDriver`: bytes read and written for each block device.',
            '`AGXAccelerator`: the GPU core count.',
            'The `cpuN` entries (class `IOPlatformDevice`): the cluster type of each CPU.',
            '`pmgr`: the DVFS frequency tables.',
            '`AppleCLPC`: which power controller driver this chip has, to find its energy counters.',
          ],
        ],
      },
      {
        h: 'Try it',
        p: ['`ioreg -l` prints the whole tree. `ioreg -rc AppleSmartBattery` shows the battery entry the reader uses.'],
      },
    ],
    source: '`IOServiceGetMatchingService`, `IOServiceGetMatchingServices` and `IORegistryEntryCreateCFProperty`.',
    sources: [cite(R.iokit, 'The IOKit framework and its registry.')],
    related: ['battery', 'ssd', 'dvfs', 'reader'],
    now: ({ hw, s }) =>
      `AGXAccelerator reports ${hw.gpuCores == null ? 'no GPU core count' : `${hw.gpuCores} GPU cores`}. ${
        s.battery ? `AppleSmartBattery reports ${Math.round(s.battery.percent)}% and ${num(s.battery.cycleCount)} cycles.` : 'There is no AppleSmartBattery entry.'
      }`,
  },
  story: {
    title: "How \"What's happening\" is decided",
    group: 'How the reader measures things',
    summary: 'A few rules over the last five seconds of readings guess what kind of work is running. It is a guess from the numbers, not knowledge of what an app does.',
    sections: [
      {
        h: 'The rules, in order',
        p: [
          [
            'Local LLM running: Ollama or LM Studio is up and either reports a token rate, has a model loaded while the GPU is over 50% busy, or the GPU is over 60% busy after app memory grew by more than 2 GB in 30 seconds.',
            'Heavy CPU work: the P-cores are over 60% busy, both over the window and right now.',
            'GPU busy, CPU calm: the GPU is over 50% busy while P and E together stay under 60%.',
            'Background work: E-cores over 30% with P-cores under 15%.',
            'Mostly idle: P under 12%, E under 30% and GPU under 20%.',
            'Mixed load: anything else.',
          ],
        ],
      },
      {
        h: 'Why a median',
        p: ['Each rule uses the median of the last five samples, so one spike does not flip the card back and forth.'],
      },
      {
        h: 'Naming the process',
        p: ['The process named in the card is the one with the most CPU summed over the same five seconds.'],
      },
      {
        h: 'Gotchas',
        p: ['These are rules of thumb, not a classifier. A game at low resolution can read as heavy CPU work, and a video call that uses the GPU lightly reads as mixed load.'],
      },
    ],
    source: '`web/src/story.ts` in this repository, with tests in `story.test.ts`.',
    sources: [cite(R.eclM1, 'Why background work shows up as busy E-cores with idle P-cores.'), cite(R.llamaBench, 'Why a generating LLM keeps the GPU busy.')],
    related: ['scheduling', 'llm-bandwidth', 'p-cores', 'e-cores'],
    now: ({ hw, history }) => `The card says: ${detectStory(history, hw.chip).title}.`,
  },
  layout: {
    title: 'How the drawing is made',
    group: 'How the reader measures things',
    summary: 'The exploded view is a line drawing of the 13-inch MacBook Air built from teardown photos, with each layer lifted apart.',
    sections: [
      {
        h: 'Where the positions come from',
        p: [
          "No public teardown of the M5 Air exists yet. It reuses the chassis Apple introduced with the M2 Air in 2022 (304.1 by 215 by 11.3 mm), so part positions come from iFixit's M2 Air teardown and chip identification, with the M4 teardown showing the layout did not change. Most positions are estimates.",
        ],
      },
      {
        h: 'Layers',
        p: [
          'From the bottom: the flat aluminium bottom case, the battery tray with four cells, the logic board with the SoC, memory, flash, radio and power chips, the top case with keyboard and trackpad, and the display. In the real Mac the battery and board sit side by side at the same height; the layers are a drawing order.',
        ],
      },
      {
        h: 'Scale',
        p: ['The SoC package is drawn 1.6 times its real size so the cores are visible. Everything else is in proportion to the 304 by 215 mm footprint.'],
      },
      {
        h: 'What moves',
        p: ['Particles on the board follow memory, disk and network traffic. The speakers pulse while audio plays, the display tilts with the real lid angle, and the trackpad shows your fingers.'],
      },
    ],
    source: '`docs/teardown-reference.md` and `web/src/layout.ts` in this repository. On a Mac without a battery the same Air is drawn, with a note saying so.',
    sources: [cite(R.ifixitM2, 'Internal layout of the M2 Air chassis.'), cite(R.ifixitChips, 'What sits where on the M2 Air logic board.'), cite(R.ifixitM5, 'The M5 Air device page, with no teardown yet.'), cite(R.airSpecs, 'Chassis size.')],
    related: ['soc', 'cooling', 'battery'],
    now: ({ hw }) =>
      hw.hasBattery && hw.fanCount === 0
        ? `This ${hw.model} reports a battery and no fans, like the Air the drawing shows.`
        : `This ${hw.model} reports ${hw.hasBattery ? 'a battery' : 'no battery'} and ${hw.fanCount} fan${hw.fanCount === 1 ? '' : 's'}, so its real layout differs from the Air drawn here.`,
  },
}

for (const [id, p] of Object.entries(PLAIN)) if (TOPICS[id]) TOPICS[id].plain = { ...p, now: PLAIN_NOW[id] }

/** Topics in index order, grouped. */
export const topicsIn = (g: Group) => Object.keys(TOPICS).filter((id) => TOPICS[id].group === g)
