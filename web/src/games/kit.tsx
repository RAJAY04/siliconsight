import { useEffect, useRef } from 'react'

// Helpers shared by every sensor game.

/** Storage can throw (private windows, blocked site data); a failure means no best score yet. */
export function readBest(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key))
    return v > 0 ? v : null
  } catch {
    return null
  }
}
export function saveBest(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    // Not saved; the best still shows for this visit.
  }
}

/**
 * Calls tick about 30 times a second while `on`, matching the fast channel's rate. The games poll `live` rather
 * than take `live.onChange`: that is a single slot the scene's fast layer owns, and a poll that only runs while a
 * round is live stops with it, with nothing to restore.
 */
export function usePoll(on: boolean, tick: (dt: number) => void) {
  const ref = useRef(tick)
  ref.current = tick
  useEffect(() => {
    if (!on) return
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      ref.current(Math.min(0.1, (now - last) / 1000))
      last = now
    }, 33)
    return () => clearInterval(id)
  }, [on])
}

export function Unavailable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card game-na">
      <h3>{title}</h3>
      <p>{children}</p>
      <p className="fine">
        Add <code>?demo</code> to the address to play with simulated input.
      </p>
    </section>
  )
}

export const OLD_READER = 'This reader is older than the sensors update, so it sends no live sensor data. Pull the repo and run ./run.sh again to update it.'


/** The numbered how-to-play list every game shows before the first round. */
export function HowTo({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="game-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  )
}
