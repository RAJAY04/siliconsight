import { frontMatter, inline, parse, sections, type Block, type Inline } from './md.ts'
import type { PartKey } from './parts.ts'

/** The `focus` values the lessons use, from docs/learn/README.md. */
export type Focus = 'chip' | 'cpu' | 'memory' | 'gpu' | 'ane' | 'ssd' | 'battery' | 'wifi' | 'power' | 'thermal' | 'sensors' | 'overview'

/** The part the camera flies to for each focus; the overview is the whole Mac. */
export const FOCUS_PART: Record<Focus, PartKey | null> = {
  chip: 'soc',
  cpu: 'soc',
  gpu: 'soc',
  ane: 'soc',
  thermal: 'soc',
  memory: 'memory',
  ssd: 'ssd',
  battery: 'battery',
  wifi: 'wifi',
  power: 'power',
  sensors: 'display',
  overview: null,
}
/** The reading in the right-hand rail that goes with each focus, by its info topic. */
export const FOCUS_READING: Record<Focus, string | null> = {
  chip: 'cpu-usage',
  cpu: 'cpu-usage',
  gpu: 'gpu',
  ane: 'power',
  thermal: 'power',
  memory: 'memory-kinds',
  ssd: 'ssd',
  battery: 'battery',
  wifi: 'network-rates',
  power: 'power',
  sensors: null,
  overview: null,
}

/** Topic explainers (learn.ts) that go with each lesson, so neither repeats the other. */
export const LESSON_TOPICS: Record<number, string[]> = {
  1: ['soc', 'unified-memory', 'layout', 'reader'],
  2: ['p-cores', 'e-cores', 'cpu-usage', 'system-cache'],
  3: ['scheduling', 'processes'],
  4: ['dvfs', 'power', 'power-delivery', 'ioreport'],
  5: ['temperatures', 'thermal-state', 'cooling', 'smc'],
  6: ['gpu', 'display-engine', 'media-engine', 'video-codecs', 'display-brightness'],
  7: ['neural-engine'],
  8: ['memory-kinds', 'memory-pressure', 'compression', 'swap', 'sysctl'],
  9: ['memory-interface'],
  10: ['llm-bandwidth'],
  11: ['ssd', 'secure-enclave', 'swap'],
  12: ['battery', 'battery-health', 'cycles', 'charge-held', 'battery-flow', 'adapter'],
  13: ['wifi', 'network-rates', 'io-block', 'iokit'],
  14: ['sensors', 'lid-angle', 'camera-mic', 'camera-path', 'audio-path', 'keyboard-light', 'trackpad'],
  15: ['story', 'trackpad', 'display-engine'],
  16: [],
}
/** The lessons that cover a topic, in course order. */
export const topicLessons = (topic: string) =>
  Object.entries(LESSON_TOPICS)
    .filter(([, ids]) => ids.includes(topic))
    .map(([n]) => +n)

/** "Covered in lesson 2" or "Covered in lessons 8 and 11", or null for a topic no lesson covers. */
export function coveredIn(topic: string): string | null {
  const ns = topicLessons(topic)
  if (!ns.length) return null
  return ns.length === 1 ? `Covered in lesson ${ns[0]}` : `Covered in lessons ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`
}

export type Question = { q: Inline[]; a: Inline[] }
export type Section = { title: string; blocks: Block[] }
export type Lesson = {
  n: number
  id: string
  title: string
  minutes: number
  focus: Focus
  live: string[]
  sections: Section[]
  quiz: Question[]
}
export type GlossaryEntry = { term: string; def: Inline[]; text: string; lessons: number[] }
export type Course = { lessons: Lesson[]; glossary: GlossaryEntry[]; readme: Section[]; sources: Section[] }

/** "Q:" and "A:" lines. An answer can run over several lines; a question without one is dropped. */
export function quiz(body: string): Question[] {
  const out: { q: string; a: string }[] = []
  let cur: 'q' | 'a' | null = null
  for (const line of body.split('\n')) {
    const m = /^([QA]):\s*(.*)$/.exec(line)
    if (m?.[1] === 'Q') {
      out.push({ q: m[2], a: '' })
      cur = 'q'
    } else if (m?.[1] === 'A' && out.length) {
      out[out.length - 1].a = m[2]
      cur = 'a'
    } else if (line.trim() && cur && out.length) out[out.length - 1][cur] += ' ' + line.trim()
    else cur = null
  }
  return out.filter((x) => x.a).map((x) => ({ q: inline(x.q), a: inline(x.a) }))
}

/**
 * "Term. Definition. [2, 8]", one per line after the heading and the intro line. The term ends at the first
 * full stop followed by a space.
 */
export function glossary(md: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  for (const line of md.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(1)) {
    const m = /^(.+?)\.\s+(.+)$/.exec(line.trim())
    if (!m) continue
    const refs = /\s*\[([\d,\s]+)\]$/.exec(m[2])
    const def = refs ? m[2].slice(0, refs.index) : m[2]
    out.push({
      term: m[1],
      def: inline(def),
      text: `${m[1]} ${def}`.toLowerCase(),
      lessons: refs ? refs[1].split(',').map((x) => +x.trim()).filter(Boolean) : [],
    })
  }
  return out
}

const toSections = (md: string): Section[] => sections(md).map((s) => ({ title: s.title, blocks: parse(s.body) }))
const FOCI = Object.keys(FOCUS_PART)

/** Builds the course from docs/learn, keyed by file name. Throws on a lesson the app could not show properly. */
export function buildCourse(files: Record<string, string>): Course {
  const byName = Object.fromEntries(Object.entries(files).map(([path, src]) => [path.split('/').pop()!, src]))
  const lessons = Object.keys(byName)
    .filter((f) => /^\d\d-[\w-]+\.md$/.test(f))
    .sort()
    .map((f): Lesson => {
      const { data, body } = frontMatter(byName[f])
      const n = +f.slice(0, 2)
      const minutes = Number(data.minutes)
      const focus = String(data.focus) as Focus
      if (data.id !== f.replace(/\.md$/, '')) throw new Error(`${f}: id ${data.id} does not match the file name`)
      if (!data.title || !(minutes > 0)) throw new Error(`${f}: needs a title and minutes`)
      if (!FOCI.includes(focus)) throw new Error(`${f}: unknown focus ${focus}`)
      const secs = toSections(body)
      const check = sections(body).find((s) => s.title === 'Check yourself')
      return {
        n,
        id: String(data.id),
        title: String(data.title),
        minutes,
        focus,
        live: Array.isArray(data.live) ? data.live : [],
        sections: secs,
        quiz: check ? quiz(check.body) : [],
      }
    })
  return {
    lessons,
    glossary: glossary(byName['glossary.md'] ?? ''),
    readme: toSections(byName['README.md'] ?? ''),
    sources: toSections(byName['sources.md'] ?? ''),
  }
}

/** The lesson number in a `#learn/NN` hash, or null. */
export const lessonNo = (hash: string): number | null => {
  const m = /^#?learn\/(\d\d)$/.exec(hash)
  return m ? +m[1] : null
}
export const lessonHash = (n: number) => `learn/${String(n).padStart(2, '0')}`

/** The plain-words track is the plain section and the hands-on ones; the technical track is the whole lesson. */
export const PLAIN_SECTIONS = ['In plain words', 'Try it', 'Check yourself']

export type Progress = { done: number[]; quiz: Record<number, number[]>; last: number | null }
export const EMPTY: Progress = { done: [], quiz: {}, last: null }

/** Reads saved progress, keeping only well-formed parts of whatever was stored. */
export function readProgress(raw: string | null): Progress {
  try {
    const p = JSON.parse(raw ?? 'null')
    const nums = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is number => Number.isInteger(v)) : [])
    return {
      done: nums(p?.done),
      quiz: Object.fromEntries(Object.entries(p?.quiz ?? {}).map(([k, v]) => [+k, nums(v)])),
      last: Number.isInteger(p?.last) ? p.last : null,
    }
  } catch {
    return EMPTY
  }
}

/** Where "Continue" goes: the last lesson opened if it is not done, else the first one not done. */
export function nextLesson(p: Progress, count: number): number {
  if (p.last != null && p.last <= count && !p.done.includes(p.last)) return p.last
  for (let n = 1; n <= count; n++) if (!p.done.includes(n)) return n
  return p.last ?? 1
}

