import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSimple } from './simple.ts'
import { D, W, lidTilt } from './layout.ts'
import { PARTS, pickPart, type PartKey } from './parts.ts'
import {
  DEFAULT_EXPLODE,
  FOCUS_ZOOM_MAX,
  ZOOM_MAX,
  camCss,
  clampTilt,
  clampZoom,
  coast,
  easeInOut,
  fillZoom,
  flipped,
  focusCam,
  home,
  isUnder,
  layerZ,
  lidPoint,
  midZ,
  mixCam,
  nearestSpin,
  type Cam,
} from './orbit.ts'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Pixels of pointer travel before a press counts as a drag rather than a click. */
const SLOP = 5
/** Corners the assembly guides run up through, inset past the case's rounded corners. */
const GUIDES: [number, number][] = [
  [22, 22],
  [W - 22, 22],
  [22, D - 22],
  [W - 22, D - 22],
]

export type OrbitEls = {
  stage: React.RefObject<HTMLDivElement | null>
  iso: React.RefObject<HTMLDivElement | null>
  /** Layer wrappers, bottom case first. */
  layers: React.RefObject<(HTMLDivElement | null)[]>
  guides: React.RefObject<(HTMLDivElement | null)[]>
}

type Tween = { from: Cam; to: Cam; t0: number; dur: number }

/**
 * Drag to turn, wheel or pinch to zoom, the explode slider and the fly-to-part camera, all written straight to
 * the DOM from one requestAnimationFrame loop that runs only while something moves. At rest it costs nothing.
 * `onFrame` runs after every written frame so the callouts can follow; `onRest` runs once when it stops.
 */
export function useOrbit(els: OrbitEls, opts: { lid: () => number | null; screen: () => { x: number; y: number; room: number }; onFrame: () => void; onRest: () => void }) {
  const o = useRef(opts)
  o.current = opts
  const [focus, setFocusState] = useState<PartKey | null>(null)
  const [under, setUnder] = useState(false)
  const S = useRef({
    cam: home(0),
    before: null as Cam | null,
    focus: null as PartKey | null,
    tween: null as Tween | null,
    vSpin: 0,
    vTilt: 0,
    zoomGoal: null as number | null,
    explode: 0,
    explodeGoal: 0,
    par: { x: 0, y: 0, gx: 0, gy: 0 },
    raf: 0,
    last: 0,
    dragging: false,
    under: false,
  }).current

  /** Where the focused part sits right now: its layer height follows the slider, a lid part follows the hinge. */
  const target = (k: PartKey) => {
    const p = PARTS[k]
    const x = p.r.x + p.r.w / 2
    let y = p.r.y + p.r.h / 2
    let z = layerZ(p.layer, S.explode)
    if (p.layer === 3) {
      const l = lidPoint(y, lidTilt(o.current.lid() ?? 180))
      y = l.y
      z += l.z
    }
    const sc = o.current.screen()
    return focusCam(S.cam, { x, y, z, zoom: fillZoom(p.r, p.fill, sc.room) }, sc.x, sc.y)
  }

  const write = () => {
    const iso = els.iso.current
    if (!iso) return
    const c = S.cam
    iso.style.transform = camCss({ ...c, spin: c.spin + S.par.x, tilt: clampTilt(c.tilt + S.par.y) })
    const zs = els.layers.current.map((el, i) => {
      const z = layerZ(i, S.explode)
      if (el) el.style.transform = `translateZ(${z}px)`
      return z
    })
    // The guides stand up from the bottom case to the lid and turn to face the camera, so they never go edge-on.
    const top = zs[zs.length - 1]
    for (const [i, el] of els.guides.current.entries()) {
      if (!el) continue
      el.style.height = `${top}px`
      el.style.transform = `translate3d(${GUIDES[i][0]}px, ${GUIDES[i][1]}px, 0) rotateZ(${-c.spin}deg) rotateX(90deg)`
    }
    iso.dataset.shut = S.explode < 0.03 ? '1' : ''
    // Below this the layer names and guides would sit on top of each other.
    iso.dataset.tight = S.explode < 0.35 ? '1' : ''
    const u = isUnder(c)
    if (u !== S.under) {
      S.under = u
      setUnder(u)
      els.stage.current?.toggleAttribute('data-under', u)
    }
    o.current.onFrame()
  }

  const frame = (now: number) => {
    S.raf = 0
    const dt = S.last ? Math.min(64, now - S.last) : 16
    S.last = now
    let busy = S.dragging
    if (S.tween) {
      const t = Math.min(1, (now - S.tween.t0) / S.tween.dur)
      S.cam = mixCam(S.tween.from, S.tween.to, easeInOut(t))
      if (t >= 1) S.tween = null
      busy = true
    } else if (!S.dragging && (Math.abs(S.vSpin) > 0.002 || Math.abs(S.vTilt) > 0.002)) {
      S.cam.spin += S.vSpin * dt
      S.cam.tilt = clampTilt(S.cam.tilt + S.vTilt * dt)
      S.vSpin = coast(S.vSpin, dt)
      S.vTilt = coast(S.vTilt, dt)
      busy = true
    }
    if (S.zoomGoal != null) {
      S.cam.zoom += (S.zoomGoal - S.cam.zoom) * (1 - Math.exp(-dt / 90))
      if (Math.abs(S.zoomGoal - S.cam.zoom) < 0.002) {
        S.cam.zoom = S.zoomGoal
        S.zoomGoal = null
      }
      busy = true
    }
    if (S.explode !== S.explodeGoal) {
      S.explode += (S.explodeGoal - S.explode) * (1 - Math.exp(-dt / 200))
      if (Math.abs(S.explodeGoal - S.explode) < 0.002) S.explode = S.explodeGoal
      busy = true
    }
    const p = S.par
    if (p.x !== p.gx || p.y !== p.gy) {
      p.x += (p.gx - p.x) * (1 - Math.exp(-dt / 140))
      p.y += (p.gy - p.y) * (1 - Math.exp(-dt / 140))
      if (Math.abs(p.gx - p.x) + Math.abs(p.gy - p.y) < 0.01) [p.x, p.y] = [p.gx, p.gy]
      busy = true
    }
    // Outside a fly, the pivot rides with the slider: the stack's middle, or the focused part's layer.
    if (!S.tween) S.cam.fz = S.focus ? target(S.focus).fz : midZ(S.explode)
    write()
    // Layer names show while the stack moves (styles.css fades them out after).
    els.stage.current?.toggleAttribute('data-moving', busy)
    if (busy) kick()
    else {
      S.last = 0
      o.current.onRest()
    }
  }
  const kick = () => {
    if (!S.raf) S.raf = requestAnimationFrame(frame)
  }
  const fly = (to: Cam, dur = 1000) => {
    S.vSpin = S.vTilt = 0
    S.zoomGoal = null
    to = { ...to, spin: nearestSpin(S.cam.spin, to.spin) }
    if (reduced()) {
      S.cam = to
      S.tween = null
    } else S.tween = { from: { ...S.cam }, to, t0: performance.now(), dur }
    kick()
  }

  const api = useRef({
    setFocus(k: PartKey | null) {
      if (k === S.focus && k) return fly(target(k), 600)
      if (k && !S.focus) S.before = { ...S.cam }
      S.par.gx = S.par.gy = 0
      S.focus = k
      setFocusState(k)
      if (k) fly(target(k), 1100)
      else {
        const b = S.before ?? home(S.explode)
        S.before = null
        fly({ ...b, fz: midZ(S.explode) }, 900)
      }
    },
    /** Refits the close-up after the stage changes size or a panel docks beside it. */
    refocus() {
      if (S.focus) fly(target(S.focus), 500)
    },
    flip() {
      if (S.focus) {
        S.focus = null
        setFocusState(null)
      }
      S.before = null
      const f = flipped(S.cam)
      fly({ ...home(S.explode), spin: S.cam.spin, zoom: Math.min(S.cam.zoom, ZOOM_MAX), tilt: f.tilt }, 1200)
    },
    reset() {
      S.focus = null
      setFocusState(null)
      S.before = null
      S.explodeGoal = DEFAULT_EXPLODE
      if (reduced()) S.explode = DEFAULT_EXPLODE
      fly(home(DEFAULT_EXPLODE), 1000)
    },
    zoomBy(f: number) {
      const z = clampZoom((S.zoomGoal ?? S.cam.zoom) * f, S.focus ? FOCUS_ZOOM_MAX : ZOOM_MAX)
      if (S.tween) S.tween.to.zoom = z
      else if (reduced()) S.cam.zoom = z
      else S.zoomGoal = z
      kick()
    },
    turn(dSpin: number, dTilt: number) {
      const to = { ...(S.tween?.to ?? S.cam) }
      to.spin += dSpin
      to.tilt = clampTilt(to.tilt + dTilt)
      fly(to, 260)
    },
    setExplode(e: number, animate: boolean) {
      S.explodeGoal = e
      if (!animate || reduced()) S.explode = e
      kick()
    },
    get explode() {
      return S.explodeGoal
    },
    /** Pointer position over the stage, -1..1 each way; a close-up leans toward it a few degrees. */
    lean(nx: number, ny: number) {
      if (!S.focus || S.dragging || reduced()) return
      S.par.gx = nx * 5
      S.par.gy = ny * 3
      kick()
    },
    drag(dx: number, dy: number, dt: number) {
      S.tween = null
      S.zoomGoal = null
      // Seen from below, the near edge is the hinge, so sideways drags turn the other way to keep it under the finger.
      const ds = (isUnder(S.cam) ? 1 : -1) * dx * 0.4
      const dtl = -dy * 0.3
      S.cam.spin += ds
      S.cam.tilt = clampTilt(S.cam.tilt + dtl)
      if (dt > 0) {
        S.vSpin = 0.7 * S.vSpin + 0.3 * (ds / dt)
        S.vTilt = 0.7 * S.vTilt + 0.3 * (dtl / dt)
      }
      kick()
    },
    pinch(z: number) {
      S.tween = null
      S.zoomGoal = null
      S.cam.zoom = clampZoom(z, S.focus ? FOCUS_ZOOM_MAX : ZOOM_MAX)
      kick()
    },
    zoom: () => S.cam.zoom,
    dragging(on: boolean) {
      S.dragging = on
      // Reduced motion: a release stops dead, no coasting.
      if (!on && reduced()) S.vSpin = S.vTilt = 0
      if (on) S.par.gx = S.par.gy = S.par.x = S.par.y = 0
      kick()
    },
    /** A pause between the last move and the release means the hand had stopped: no coasting then. */
    still() {
      S.vSpin = S.vTilt = 0
    },
    focus: () => S.focus,
    kick,
  }).current

  // Draw the collapsed stack before the first paint, so the layers never flash at z 0 with no camera.
  useLayoutEffect(() => {
    S.cam = home(0)
    write()
    return () => {
      cancelAnimationFrame(S.raf)
      S.raf = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { api, focus, under }
}

/** Keeps the pointer handlers in one place: a press either becomes a drag (past SLOP) or a click on a part. */
export function useOrbitInput(stage: React.RefObject<HTMLDivElement | null>, api: ReturnType<typeof useOrbit>['api'], onPick: (k: PartKey | null, x: number, y: number, open: boolean) => void) {
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    const el = stage.current!
    const pts = new Map<number, { x: number; y: number; t: number }>()
    let start: { x: number; y: number } | null = null
    let moved = false
    let pinch: { d: number; z: number } | null = null
    let hover: PartKey | null = null
    // Hover follows the same smallest-part rule as a click; CSS :hover would light the topmost layer instead.
    const setHover = (k: PartKey | null) => {
      if (k === hover) return
      for (const h of el.querySelectorAll('.hit.hover')) h.classList.remove('hover')
      if (k) for (const h of el.querySelectorAll(`[data-part="${k}"]`)) h.classList.add('hover')
      hover = k
      el.toggleAttribute('data-hover', !!k)
    }
    const dist = () => {
      const [a, b] = [...pts.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const ui = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, input, select, a, .orbit-ui, .focus-card, .callout-wrap, .lid-row')
    const down = (e: PointerEvent) => {
      if (ui(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY }
        moved = false
      } else if (pts.size === 2) {
        pinch = { d: dist(), z: api.zoom() }
        moved = true
      }
    }
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) {
        if (e.pointerType === 'mouse') {
          setHover(ui(e.target) ? null : partAt(e.clientX, e.clientY))
          const r = el.getBoundingClientRect()
          if (!ui(e.target)) api.lean(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
        }
        return
      }
      const dt = e.timeStamp - p.t
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      if (pinch && pts.size === 2) return api.pinch((pinch.z * dist()) / Math.max(1, pinch.d))
      if (!moved && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP) return
      if (!moved) {
        moved = true
        setHover(null)
        // Captured only once it is a drag; capturing on press would retarget the click away from the part.
        el.setPointerCapture(e.pointerId)
        api.dragging(true)
      }
      // The stage is touch-action: pan-y, so a vertical swipe scrolls the page and touch only turns the view sideways.
      api.drag(dx, e.pointerType === 'touch' ? 0 : dy, dt)
    }
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      pts.delete(e.pointerId)
      if (pts.size === 1) {
        // Back to one finger after a pinch: carry on dragging from where it is, without a jump.
        pinch = null
        return
      }
      if (pts.size) return
      if (moved) {
        if (e.timeStamp - p.t > 80) api.still()
        api.dragging(false)
      } else if (e.type === 'pointerup') {
        pick.current(partAt(e.clientX, e.clientY), e.clientX, e.clientY, false)
      }
      pinch = null
      start = null
    }
    const dbl = (e: MouseEvent) => {
      if (ui(e.target)) return
      const k = partAt(e.clientX, e.clientY)
      if (k) pick.current(k, e.clientX, e.clientY, true)
    }
    const wheel = (e: WheelEvent) => {
      if (ui(e.target)) return
      e.preventDefault()
      // A trackpad pinch arrives as a wheel event with ctrlKey and small deltas.
      api.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    const leave = () => {
      setHover(null)
      api.lean(0, 0)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('dblclick', dbl)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('dblclick', dbl)
      el.removeEventListener('wheel', wheel)
    }
  }, [stage, api])
}

/** Every part under the point, in any layer; pickPart chooses the one aimed at. */
const partAt = (x: number, y: number) =>
  pickPart(
    document
      .elementsFromPoint(x, y)
      .map((el) => (el.closest('[data-part]') as HTMLElement | null)?.dataset.part)
      .filter((k): k is PartKey => !!k && k in PARTS),
  )

export const PART_ORDER: PartKey[] = ['soc', 'memory', 'ssd', 'wifi', 'power', 'speakers', 'battery', 'trackpad', 'display', 'camera']

/** Zoom, flip, reset, the part list and the explode slider. Real buttons, so the keyboard reaches all of it. */
export function OrbitControls({ api, under, hasBattery, onPart }: { api: ReturnType<typeof useOrbit>['api']; under: boolean; hasBattery: boolean; onPart: (k: PartKey) => void }) {
  const simple = useSimple()
  const slider = useRef<HTMLInputElement>(null)
  return (
    <>
      <div className="orbit-ui orbit-tools" role="toolbar" aria-label="3D view">
        <button type="button" className="orbit-btn icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => api.zoomBy(1 / 1.3)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3.5 8 H12.5" />
          </svg>
        </button>
        <button type="button" className="orbit-btn icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => api.zoomBy(1.3)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3.5 8 H12.5 M8 3.5 V12.5" />
          </svg>
        </button>
        <button type="button" className="orbit-btn" aria-pressed={under} title="Turn it over to see the bottom case (F)" onClick={() => api.flip()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3 6 A5 5 0 0 1 12.5 5 M12.5 2 V5 H9.5 M13 10 A5 5 0 0 1 3.5 11 M3.5 14 V11 H6.5" />
          </svg>
          {under ? (simple ? 'Turn back' : 'Flip back') : simple ? 'Turn over' : 'Flip'}
        </button>
        <button
          type="button"
          className="orbit-btn"
          title="Back to the starting view (0)"
          onClick={() => {
            api.reset()
            if (slider.current) slider.current.value = String(DEFAULT_EXPLODE)
          }}
        >
          Reset
        </button>
        <select
          className="orbit-select"
          aria-label={simple ? 'Fly to a part' : 'Zoom to a part'}
          value=""
          onChange={(e) => {
            if (e.target.value) onPart(e.target.value as PartKey)
          }}
        >
          <option value="">{simple ? 'Fly to…' : 'Parts…'}</option>
          {PART_ORDER.filter((k) => k !== 'battery' || hasBattery).map((k) => (
            <option key={k} value={k}>
              {simple ? PARTS[k].plain : PARTS[k].title}
            </option>
          ))}
        </select>
      </div>
      <label className="orbit-ui orbit-explode">
        <span className="orbit-explode-label">{simple ? 'Pull apart' : 'Explode'}</span>
        <span className="orbit-end" aria-hidden>
          {simple ? 'Together' : 'Closed'}
        </span>
        <input
          ref={slider}
          type="range"
          min="0"
          max="1"
          step="0.01"
          defaultValue={DEFAULT_EXPLODE}
          onInput={(e) => api.setExplode(+e.currentTarget.value, false)}
        />
        <span className="orbit-end" aria-hidden>
          {simple ? 'Apart' : 'Wide'}
        </span>
      </label>
    </>
  )
}

/** The close-up's caption: what the part is, a live reading, the way into its panel and the way back. */
export function FocusCard({ k, value, chip, onDetails, onBack }: { k: PartKey; value: string | null; chip: string; onDetails: (el: Element) => void; onBack: () => void }) {
  const simple = useSimple()
  const p = PARTS[k]
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    head.current?.focus({ preventScroll: true })
  }, [k])
  const title = k === 'soc' && !simple ? chip : simple ? p.plain : p.title
  return (
    <section className="orbit-ui focus-card" aria-labelledby="focus-title" key={k}>
      <span className="story-kicker">{simple ? 'Up close' : 'Close-up'}</span>
      <h2 id="focus-title" ref={head} tabIndex={-1}>
        {title}
      </h2>
      {value && <p className="focus-value num">{value}</p>}
      <p className="focus-text">{simple ? p.plainText : p.text}</p>
      <div className="focus-actions">
        <button type="button" className="focus-open" onClick={(e) => onDetails(e.currentTarget)}>
          {simple ? 'Show more' : 'Open details'}
        </button>
        <button type="button" className="back" onClick={onBack} aria-label="Back to the whole Mac (Esc)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
          Back
          <kbd>Esc</kbd>
        </button>
      </div>
    </section>
  )
}
