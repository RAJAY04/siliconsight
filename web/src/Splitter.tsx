import { useRef, useState } from 'react'

export type Pane = { w: number; collapsed: boolean }

/** A side column's width and collapsed state, kept in localStorage. Storage can throw (private windows); then it just isn't kept. */
export function usePane(key: string, def: number, min: number, max: number) {
  const fit = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const [pane, set] = useState<Pane>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(key) ?? 'null') as Pane | null
      if (p && Number.isFinite(p.w)) return { w: fit(p.w), collapsed: !!p.collapsed }
    } catch {
      // Unreadable or blocked storage: start from the default.
    }
    return { w: def, collapsed: false }
  })
  const save = (p: Pane) => {
    set(p)
    try {
      localStorage.setItem(key, JSON.stringify(p))
    } catch {
      // Not kept; the width still applies for this visit.
    }
  }
  return {
    pane,
    resize: (w: number) => save({ w: fit(w), collapsed: false }),
    reset: () => save({ w: def, collapsed: false }),
    toggle: () => save({ ...pane, collapsed: !pane.collapsed }),
    min,
    max,
  }
}

/**
 * A drag handle between a side column and the scene. `edge` says which side the column is on, so dragging toward
 * the scene widens it. Arrow keys resize (Shift for bigger steps), Enter collapses, double-click resets.
 */
export function Splitter({ edge, label, ctl, className = '' }: { edge: 'left' | 'right'; label: string; ctl: ReturnType<typeof usePane>; className?: string }) {
  const { pane, resize, reset, toggle, min, max } = ctl
  const drag = useRef<{ x: number; w: number } | null>(null)
  const dir = edge === 'left' ? 1 : -1
  // The chevron points the way the column will move.
  const pointsRight = pane.collapsed ? edge === 'left' : edge === 'right'
  return (
    <div className={`splitter splitter-${edge} ${pane.collapsed ? 'collapsed' : ''} ${className}`}>
      {!pane.collapsed && (
        <div
          className="splitter-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={pane.w}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, w: pane.w }
          }}
          onPointerMove={(e) => drag.current && resize(drag.current.w + dir * (e.clientX - drag.current.x))}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={reset}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 48 : 16
            const d = { ArrowLeft: -step, ArrowRight: step }[e.key]
            if (d) resize(pane.w + dir * d)
            else if (e.key === 'Home') resize(min)
            else if (e.key === 'End') resize(max)
            else if (e.key === 'Enter') toggle()
            else return
            e.preventDefault()
          }}
        />
      )}
      <button type="button" className="splitter-toggle" aria-expanded={!pane.collapsed} aria-label={`${pane.collapsed ? 'Show' : 'Hide'} ${label}`} title={`${pane.collapsed ? 'Show' : 'Hide'} ${label}`} onClick={toggle}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
          <path d={pointsRight ? 'M6 3 L11 8 L6 13' : 'M10 3 L5 8 L10 13'} />
        </svg>
      </button>
    </div>
  )
}
