import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { GROUPS, TOPICS, topicsIn, type Para } from './learn.ts'
import type { Hardware, Sample } from './types.ts'
import { SimpleContext } from './simple.ts'
import { coveredIn, lessonHash, topicLessons } from './course.ts'

/** Opens the explainer for a topic. `from` gets focus back when it closes. */
export const LearnContext = createContext<(id: string, from: HTMLElement) => void>(() => {})

/** The small circled "i" next to anything with an explainer. Static DOM: it never changes between samples. */
export function InfoButton({ topic, className = '' }: { topic: string; className?: string }) {
  const learn = useContext(LearnContext)
  return (
    <button type="button" className={`info ${className}`} aria-label={`Learn about ${TOPICS[topic].title}`} title={`Learn about ${TOPICS[topic].title}`} onClick={(e) => learn(topic, e.currentTarget)}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle cx="8" cy="8" r="6.6" />
        <path d="M8 7.2 V11.4 M8 4.7 V4.8" />
      </svg>
    </button>
  )
}

/** Text with `backtick` spans shown as code. */
function rich(t: string) {
  return t.split('`').map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x))
}
function Paragraph({ p }: { p: Para }) {
  if (typeof p === 'string') return <p>{rich(p)}</p>
  if (Array.isArray(p))
    return (
      <ul>
        {p.map((x) => (
          <li key={x}>{rich(x)}</li>
        ))}
      </ul>
    )
  return (
    <ol>
      {p.steps.map((x) => (
        <li key={x}>{rich(x)}</li>
      ))}
    </ol>
  )
}

type ExplainerProps = { id: string; hw: Hardware; s: Sample; history: Sample[]; onTopic: (id: string) => void; onClose: () => void }

/**
 * One explainer at a time, as a modal dialog: a side sheet on wide screens, a bottom drawer on narrow ones.
 * The browser handles Esc and keeps focus inside; onClose runs however it closes.
 */
export function Explainer({ id, hw, s, history, onTopic, onClose }: ExplainerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const head = useRef<HTMLHeadingElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  // Opening, or following a related link, starts at the top with focus on the title.
  useEffect(() => {
    body.current?.scrollTo(0, 0)
    head.current?.focus()
  }, [id])
  // Starts in the variant the header toggle picked; the switch below changes only this sheet.
  const simple = useContext(SimpleContext)
  const [plain, setPlain] = useState(simple)
  useEffect(() => setPlain(simple), [simple])
  const t = TOPICS[id]
  const text = plain && t.plain ? t.plain : t
  const now = (plain && t.plain?.now ? t.plain.now : t.now)?.({ hw, s, history }) ?? null
  const close = () => ref.current?.close()
  return (
    // A click on the backdrop lands on the dialog itself; clicks inside land on its content.
    <dialog ref={ref} className="explainer" aria-labelledby="ex-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="ex-inner">
        <div className="ex-head">
          <div>
            <div className="story-kicker">{t.group}</div>
            <h2 id="ex-title" ref={head} tabIndex={-1}>
              {t.title}
            </h2>
          </div>
          <button type="button" className="back" onClick={close} aria-label="Close (Esc)">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Close
            <kbd>Esc</kbd>
          </button>
        </div>
        <div className="ex-variant" role="group" aria-label="Explanation style">
          <button type="button" aria-pressed={plain} onClick={() => setPlain(true)}>
            Everyday words
          </button>
          <button type="button" aria-pressed={!plain} onClick={() => setPlain(false)}>
            Technical
          </button>
        </div>
        <div className="ex-body" ref={body}>
          <p className="lede">{text.summary}</p>
          {now && (
            <p className="ex-now">
              <span className="story-kicker">Right now</span>
              {now}
            </p>
          )}
          {text.sections.map((sec) => (
            <section key={sec.h}>
              <h3>{sec.h}</h3>
              {sec.p.map((p, i) => (
                <Paragraph key={i} p={p} />
              ))}
            </section>
          ))}
          {!plain && (
            <section>
              <h3>How this app reads it</h3>
              <p>{rich(t.source)}</p>
            </section>
          )}
          <section>
            <h3>Sources</h3>
            <ul className="ex-sources">
              {t.sources.map((src) => (
                <li key={src.url + src.note}>
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.title}
                  </a>
                  <span className="ex-src-note">{src.note}</span>
                </li>
              ))}
            </ul>
          </section>
          {topicLessons(id).length > 0 && (
            <section>
              <h3>Covered in the course</h3>
              <ul className="ex-related">
                {topicLessons(id).map((n) => (
                  <li key={n}>
                    {/* Closing first lets the hash change take focus to the lesson heading. */}
                    <a className="ex-link" href={`#${lessonHash(n)}`} onClick={close}>
                      Lesson {n}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3>Related</h3>
            <ul className="ex-related">
              {t.related.map((r) => (
                <li key={r}>
                  <button type="button" className="ex-link" onClick={() => onTopic(r)}>
                    {TOPICS[r].title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </dialog>
  )
}

/** The #learn page: every topic, grouped. Each opens its explainer. */
export function LearnIndex() {
  const learn = useContext(LearnContext)
  const simple = useContext(SimpleContext)
  return (
    <div className="learn-index">
      <p className="lede">
        How each part of your Mac works, from what you see on screen down to the counters the reader uses. Every explainer ties back to the live readings. The circled i buttons across the app open the same pages.
      </p>
      {GROUPS.map((g) => (
        <section key={g} className="card">
          <h3>{g}</h3>
          <ul className="learn-list">
            {topicsIn(g).map((id) => (
              <li key={id}>
                <button type="button" className="learn-item" onClick={(e) => learn(id, e.currentTarget)}>
                  <span className="learn-title">{TOPICS[id].title}</span>
                  <span className="learn-sum">{(simple && TOPICS[id].plain?.summary) || TOPICS[id].summary}</span>
                  {coveredIn(id) && <span className="learn-lessons">{coveredIn(id)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
