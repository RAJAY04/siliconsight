import { Suspense } from 'react'
import { GROUPS, LABS, labAt, labLesson } from './labs/index.ts'
import { LESSONS } from './Course.tsx'
import { lessonHash } from './course.ts'
import type { LabProps } from './labs/kit.tsx'
import { useSimple } from './simple.ts'

/** The labs index at #labs, or one lab at #labs/<id>. */
export function Labs(p: LabProps) {
  const simple = useSimple()
  const lab = labAt(location.hash)
  if (lab) {
    const n = LABS.indexOf(lab)
    const prev = LABS[n - 1]
    const next = LABS[n + 1]
    const lesson = LESSONS.find((l) => l.n === labLesson(lab.id))
    return (
      <div className="lab">
        {lesson && (
          <a className="lab-lesson" href={`#${lessonHash(lesson.n)}`}>
            Goes with lesson {lesson.n}: {lesson.title}
          </a>
        )}
        <p className="lede lab-lede">{simple ? lab.plainBlurb : lab.blurb}</p>
        <Suspense fallback={<p className="fine">Loading the lab…</p>}>
          <lab.Lab {...p} />
        </Suspense>
        <nav className="lab-pager" aria-label="Other labs">
          {prev ? (
            <a href={`#labs/${prev.id}`} className="lab-pager-prev">
              <span className="fine">Previous lab</span>
              {simple ? prev.plain : prev.title}
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a href={`#labs/${next.id}`} className="lab-pager-next">
              <span className="fine">Next lab</span>
              {simple ? next.plain : next.title}
            </a>
          )}
        </nav>
      </div>
    )
  }
  return (
    <div className="labs">
      <p className="lede">
        {simple
          ? 'Short animated stories about how a computer really works, told on this Mac. They run in course order, so start at the top and step through at your own pace. Where you see "live", the animation follows what this Mac is doing right now.'
          : 'Computer science fundamentals as animated, step-through explainers, each tied to the hardware and the live counters of this Mac. They run in course order, from bits up to the network, and each one names the lesson it goes with and the sources its facts come from.'}
      </p>
      {GROUPS.map((g) => {
        const list = LABS.filter((l) => l.group === g)
        if (!list.length) return null
        return (
          <section key={g} className="labs-group" aria-labelledby={`labs-${g}`}>
            <h2 id={`labs-${g}`}>{g}</h2>
            <div className="labs-grid">
              {list.map((l) => (
                <a key={l.id} className="lab-card" href={`#labs/${l.id}`}>
                  <span className="lab-card-title">{simple ? l.plain : l.title}</span>
                  <span className="lab-card-blurb">{simple ? l.plainBlurb : l.blurb}</span>
                  <span className="lab-card-meta">
                    <span className="num">{l.minutes} min</span>
                    {labLesson(l.id) != null && <span>lesson {labLesson(l.id)}</span>}
                    {l.live && <span className="lab-card-live">live</span>}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
