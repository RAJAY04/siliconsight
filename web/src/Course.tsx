import { memo, useContext, useEffect, useRef, useState } from 'react'
import { linkTarget, type Block, type Inline } from './md.ts'
import { EMPTY, FOCUS_PART, LESSON_TOPICS, PLAIN_SECTIONS, buildCourse, lessonHash, lessonNo, nextLesson, readProgress, type Lesson, type Progress, type Question } from './course.ts'
import { LearnContext, LearnIndex } from './Learn.tsx'
import { TOPICS } from './learn.ts'
import { PARTS } from './parts.ts'
import { useSimple } from './simple.ts'
import { LABS, LESSON_LABS } from './labs/index.ts'

/** The course, read from docs/learn at build time. */
const COURSE = buildCourse(import.meta.glob<string>('../../docs/learn/*.md', { query: '?raw', import: 'default', eager: true }))
export const LESSONS = COURSE.lessons
export const lessonAt = (hash: string): Lesson | null => LESSONS.find((l) => l.n === lessonNo(hash)) ?? null

/** Labels in technical and everyday words. */
const WORDS = {
  of: ['Lesson {n} of {total}', 'Lesson {n} of {total}'],
  track: ['Lesson style', 'How to read it'],
  plain: ['In plain words', 'In plain words'],
  tech: ['Technical', 'All the detail'],
  topics: ['Explainers for this lesson', 'Short explainers'],
  labs: ['Animated labs for this lesson', 'Watch it happen'],
  done: ['Mark lesson done', 'I finished this lesson'],
  isDone: ['Lesson done', 'Finished'],
  prev: ['Previous', 'Back one'],
  next: ['Next', 'Next one'],
  answer: ['Show answer', 'Show the answer'],
  got: ['Understood', 'I get it'],
  gotN: ['{n} of {total} understood', '{n} of {total} make sense'],
  copy: ['Copy', 'Copy'],
  copied: ['Copied', 'Copied'],
  copyFail: ['Copy failed: select the text', 'Could not copy: select the text'],
  part: ['Part', 'Look at'],
  whole: ['Whole Mac', 'Whole Mac'],
  start: ['Start lesson 1', 'Start the first lesson'],
  cont: ['Continue: lesson {n}', 'Carry on: lesson {n}'],
  reset: ['Reset progress', 'Start over'],
  resetAsk: ['Clear every lesson mark and quiz answer?', 'Forget which lessons you finished?'],
  map: ['Course map', 'All the lessons'],
  day: ['One-day schedule', 'A plan for the day'],
  glossary: ['Glossary', 'Word list'],
  find: ['Search the glossary', 'Look up a word'],
  sources: ['Sources', 'Where the facts come from'],
  allSources: ['Every source, by topic', 'Show every source'],
  explainers: ['Topic explainers', 'Short explainers'],
} as const
type Word = keyof typeof WORDS
function useWords() {
  const simple = useSimple()
  return (k: Word, vars: Record<string, string | number> = {}) => WORDS[k][simple ? 1 : 0].replace(/\{(\w+)\}/g, (_, v) => String(vars[v]))
}

const KEY = 'macviz.course'
/** Storage can throw (private windows, blocked site data); then progress lasts for this visit only. */
function useProgress() {
  const [p, setP] = useState<Progress>(() => {
    try {
      return readProgress(localStorage.getItem(KEY))
    } catch {
      return EMPTY
    }
  })
  const save = (next: Progress) => {
    setP(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Not saved; it still counts until the page reloads.
    }
  }
  return [p, save] as const
}
const toggle = (xs: number[], x: number) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x].sort((a, b) => a - b))

function Spans({ c }: { c: Inline[] }) {
  return c.map((x, i) => {
    if (x.t === 'text') return x.v
    if (x.t === 'code') return <code key={i}>{x.v}</code>
    if (x.t === 'strong')
      return (
        <strong key={i}>
          <Spans c={x.c} />
        </strong>
      )
    const to = linkTarget(x.href)
    const kids = <Spans c={x.c} />
    if (!to) return <span key={i}>{kids}</span>
    if (to.kind === 'web')
      return (
        <a key={i} href={to.href} target="_blank" rel="noopener noreferrer">
          {kids}
        </a>
      )
    return (
      <a key={i} href={`#${to.kind === 'lesson' ? lessonHash(to.n) : 'learn'}`}>
        {kids}
      </a>
    )
  })
}

function Code({ v }: { v: string }) {
  const say = useWords()
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const id = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(id)
  }, [state])
  const copy = () => {
    if (!navigator.clipboard) return setState('fail')
    navigator.clipboard.writeText(v).then(
      () => setState('ok'),
      () => setState('fail'),
    )
  }
  return (
    <div className="md-code">
      <pre tabIndex={0}>
        <code>{v}</code>
      </pre>
      <button type="button" className="md-copy" onClick={copy}>
        {say(state === 'ok' ? 'copied' : state === 'fail' ? 'copyFail' : 'copy')}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'ok' ? say('copied') : state === 'fail' ? say('copyFail') : ''}
      </span>
    </div>
  )
}

/** Renders parsed Markdown. `shift` moves headings down a level to fit the page they sit in. */
export function Md({ blocks, shift = 0 }: { blocks: Block[]; shift?: number }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'h': {
        const H = `h${Math.min(6, b.level + shift)}` as 'h3'
        return (
          <H key={i}>
            <Spans c={b.c} />
          </H>
        )
      }
      case 'p':
        return (
          <p key={i}>
            <Spans c={b.c} />
          </p>
        )
      case 'ul':
      case 'ol': {
        const L = b.t
        return (
          <L key={i} start={b.t === 'ol' && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Spans c={it} />
              </li>
            ))}
          </L>
        )
      }
      case 'code':
        return <Code key={i} v={b.v} />
      case 'quote':
        return (
          <blockquote key={i}>
            <Md blocks={b.c} shift={shift} />
          </blockquote>
        )
      case 'table':
        return (
          <div key={i} className="md-table" tabIndex={0} role="region" aria-label="Table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} scope="col">
                      <Spans c={c} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>
                        <Spans c={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  })
}

function Quiz({ quiz, got, onGot }: { quiz: Question[]; got: number[]; onGot: (i: number) => void }) {
  const say = useWords()
  return (
    <>
      <ol className="quiz">
        {quiz.map((q, i) => (
          <li key={i}>
            <p className="quiz-q">
              <Spans c={q.q} />
            </p>
            <details>
              <summary>{say('answer')}</summary>
              <p>
                <Spans c={q.a} />
              </p>
            </details>
            <label className="quiz-got">
              <input type="checkbox" checked={got.includes(i)} onChange={() => onGot(i)} />
              {say('got')}
            </label>
          </li>
        ))}
      </ol>
      <p className="quiz-sum" aria-live="polite">
        {say('gotN', { n: got.length, total: quiz.length })}
      </p>
    </>
  )
}

const partName = (l: Lesson, simple: boolean) => {
  const k = FOCUS_PART[l.focus]
  return k ? (simple ? PARTS[k].plain : PARTS[k].title) : null
}

/** One lesson, as the docked panel beside the live scene. Nothing in it reads samples, so it renders once per lesson. */
const LessonPage = memo(function LessonPage({ lesson }: { lesson: Lesson }) {
  const say = useWords()
  const simple = useSimple()
  const learn = useContext(LearnContext)
  const [p, save] = useProgress()
  // Starts in the style the header toggle picked; the switch here changes only the lessons.
  const [plain, setPlain] = useState(simple)
  useEffect(() => setPlain(simple), [simple])
  const root = useRef<HTMLDivElement>(null)
  const { n } = lesson
  useEffect(() => {
    // The phone drawer keeps its scroll position between lessons; start each one at the top.
    root.current?.closest('.detail')?.scrollTo(0, 0)
    save({ ...p, last: n })
    // Only when the lesson changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])
  const done = p.done.includes(n)
  const got = p.quiz[n] ?? []
  const prev = LESSONS.find((l) => l.n === n - 1)
  const next = LESSONS.find((l) => l.n === n + 1)
  const shown = lesson.sections.filter((s) => !plain || PLAIN_SECTIONS.includes(s.title))
  const topics = LESSON_TOPICS[n] ?? []
  return (
    <div className="lesson" ref={root}>
      <p className="lesson-meta">
        <span>{say('of', { n, total: LESSONS.length })}</span>
        <span className="num">{lesson.minutes} min</span>
        <span>
          {say('part')}: {partName(lesson, simple) ?? say('whole')}
        </span>
        {done && <span className="lesson-done-tag">{say('isDone')}</span>}
      </p>
      <div className="ex-variant lesson-variant" role="group" aria-label={say('track')}>
        <button type="button" aria-pressed={plain} onClick={() => setPlain(true)}>
          {say('plain')}
        </button>
        <button type="button" aria-pressed={!plain} onClick={() => setPlain(false)}>
          {say('tech')}
        </button>
      </div>
      {topics.length > 0 && (
        <div className="lesson-topics">
          <span className="story-kicker">{say('topics')}</span>
          <ul className="ex-related">
            {topics.map((id) => (
              <li key={id}>
                <button type="button" className="ex-link" onClick={(e) => learn(id, e.currentTarget)}>
                  {TOPICS[id].title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(LESSON_LABS[n] ?? []).length > 0 && (
        <div className="lesson-topics">
          <span className="story-kicker">{say('labs')}</span>
          <ul className="ex-related">
            {LABS.filter((l) => LESSON_LABS[n].includes(l.id)).map((l) => (
              <li key={l.id}>
                <a className="ex-link" href={`#labs/${l.id}`}>
                  {simple ? l.plain : l.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="md">
        {shown.map((s) => (
          <section key={s.title} aria-labelledby={`ls-${n}-${s.title.replace(/\W+/g, '-')}`}>
            <h2 id={`ls-${n}-${s.title.replace(/\W+/g, '-')}`}>{s.title}</h2>
            {s.title === 'Check yourself' && lesson.quiz.length ? (
              <Quiz quiz={lesson.quiz} got={got} onGot={(i) => save({ ...p, quiz: { ...p.quiz, [n]: toggle(got, i) } })} />
            ) : (
              <Md blocks={s.blocks} />
            )}
          </section>
        ))}
      </div>
      <div className="lesson-foot">
        <button type="button" className="lesson-done" aria-pressed={done} onClick={() => save({ ...p, done: toggle(p.done, n) })}>
          <span className="lesson-check" aria-hidden />
          {done ? say('isDone') : say('done')}
        </button>
        <nav className="lesson-nav" aria-label="Lessons">
          {prev && (
            <a className="learn-link" href={`#${lessonHash(prev.n)}`} rel="prev">
              {say('prev')}: {prev.n}
              <span className="sr-only">, {prev.title}</span>
            </a>
          )}
          {next && (
            <a className="learn-link" href={`#${lessonHash(next.n)}`} rel="next">
              {say('next')}: {next.n}
              <span className="sr-only">, {next.title}</span>
            </a>
          )}
        </nav>
      </div>
    </div>
  )
})

/** The `#learn/NN` panel. App re-renders it on every hash change. */
export function LessonView() {
  const lesson = lessonAt(location.hash)
  return lesson ? <LessonPage key={lesson.n} lesson={lesson} /> : null
}

const Glossary = memo(function Glossary() {
  const say = useWords()
  const [q, setQ] = useState('')
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = COURSE.glossary.filter((g) => terms.every((t) => g.text.includes(t)))
  return (
    <>
      <input className="course-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={say('find')} placeholder={say('find')} />
      <p className="sr-only" aria-live="polite">
        {hits.length} terms
      </p>
      <dl className="glossary">
        {hits.map((g) => (
          <div key={g.term}>
            <dt>{g.term}</dt>
            <dd>
              <Spans c={g.def} />
              {g.lessons.map((n) => (
                <a key={n} className="glossary-lesson" href={`#${lessonHash(n)}`}>
                  Lesson {n}
                </a>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
})

const readme = (title: string) => COURSE.readme.find((s) => s.title === title)?.blocks ?? []
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)

/** The `#learn` page: the course, then the topic explainers. Reads no samples, so it renders only on its own changes. */
const Home = memo(function Home() {
  const say = useWords()
  const simple = useSimple()
  const [p, save] = useProgress()
  const go = nextLesson(p, LESSONS.length)
  const started = p.done.length > 0 || p.last != null
  const left = LESSONS.filter((l) => !p.done.includes(l.n)).reduce((m, l) => m + l.minutes, 0)
  return (
    <div className="course">
      <section className="card course-top" aria-label="Your progress">
        <p className="lede">
          {simple
            ? 'A one-day course on how your Mac works. Each lesson sits beside the live drawing and ends with something to try in Terminal.'
            : 'A self-paced course, about one day long, on how an Apple Silicon Mac works, from the chip up to macOS. Each lesson docks beside the live scene and ends with an experiment you run in Terminal.'}
        </p>
        <p className="course-progress">
          <span className="num">
            {p.done.length} / {LESSONS.length}
          </span>{' '}
          lessons done, <span className="num">{minutes(left)}</span> to go
        </p>
        <progress max={LESSONS.length} value={p.done.length} aria-label="Lessons done" />
        <div className="course-actions">
          <a className="focus-open" href={`#${lessonHash(go)}`}>
            {started ? say('cont', { n: go }) : say('start')}
          </a>
          {started && (
            <button type="button" className="back" onClick={() => confirm(say('resetAsk')) && save(EMPTY)}>
              {say('reset')}
            </button>
          )}
        </div>
      </section>

      <section className="card course-map-card" aria-labelledby="course-map">
        <h2 id="course-map">{say('map')}</h2>
        <ol className="course-map">
          {LESSONS.map((l) => {
            const done = p.done.includes(l.n)
            const got = p.quiz[l.n]?.length ?? 0
            return (
              <li key={l.n}>
                <a href={`#${lessonHash(l.n)}`} className={`course-row ${done ? 'is-done' : ''}`} aria-current={l.n === go ? 'step' : undefined}>
                  <span className="course-n num" aria-hidden>
                    {l.n}
                  </span>
                  <span className="course-title">
                    <span className="sr-only">Lesson {l.n}: </span>
                    {l.title}
                  </span>
                  <span className="course-sub">
                    <span className="num">{l.minutes} min</span>
                    <span>{partName(l, simple) ?? say('whole')}</span>
                    {got > 0 && <span className="num">{say('gotN', { n: got, total: l.quiz.length })}</span>}
                    {done && <span className="lesson-done-tag">{say('isDone')}</span>}
                  </span>
                </a>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="card md" aria-labelledby="course-day">
        <h2 id="course-day">{say('day')}</h2>
        <Md blocks={readme('A one-day schedule')} />
        {['What you need', 'Safety'].map((t) => (
          <details key={t}>
            <summary>{t}</summary>
            <Md blocks={readme(t)} />
          </details>
        ))}
      </section>

      <section className="card md" aria-labelledby="course-glossary">
        <h2 id="course-glossary">{say('glossary')}</h2>
        <Glossary />
      </section>

      <section className="card md" aria-labelledby="course-sources">
        <h2 id="course-sources">{say('sources')}</h2>
        {COURSE.sources[0]?.title === '' && <Md blocks={COURSE.sources[0].blocks.filter((b) => b.t !== 'h')} />}
        <details>
          <summary>{say('allSources')}</summary>
          {COURSE.sources
            .filter((s) => s.title)
            .map((s) => (
              <section key={s.title}>
                <h3>{s.title}</h3>
                <Md blocks={s.blocks} shift={1} />
              </section>
            ))}
        </details>
      </section>

      <section className="course-topics" aria-labelledby="course-explainers">
        <h2 id="course-explainers">{say('explainers')}</h2>
        <LearnIndex />
      </section>
    </div>
  )
})
export function CourseHome() {
  return <Home />
}
