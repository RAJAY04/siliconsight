import { useEffect, useRef } from 'react'

/**
 * One cheap animation loop per canvas, shared by the scene and the die map. Everything that moves every frame
 * (particles, core flicker, disk flashes) is drawn here instead of animating SVG, so the large SVG layers are
 * painted once per sample and the compositor has little to do between samples.
 *
 * - 18 fps while something is travelling (the draw callback returns true), 9 fps when only flicker is
 *   left; the backing store is capped at 1.5x device pixels.
 * - Stops while `paused` (a panel covers it) and while the tab is hidden.
 * - Reduced motion: no loop; one still frame each time `stamp` changes (once per sample).
 */
const FPS = 18
const IDLE_FPS = 9
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * One shared clock for every canvas. Loops that are due in the same frame draw together, so the scene and the
 * inset cost one composited frame instead of two. A timer paces it and requestAnimationFrame only draws:
 * requesting every vsync and skipping most would still keep the browser producing 60 frames a second.
 */
type Loop = { due: number; tick: (now: number) => number }
const loops = new Set<Loop>()
let timer: ReturnType<typeof setTimeout> | undefined
let raf = 0
function schedule() {
  clearTimeout(timer)
  cancelAnimationFrame(raf)
  if (!loops.size || document.hidden) return
  const next = Math.min(...[...loops].map((l) => l.due))
  timer = setTimeout(
    () =>
      (raf = requestAnimationFrame((now) => {
        // Due times sit on a shared grid (multiples of the interval; 9 fps is every second 18 fps frame),
        // so loops land in the same frame instead of drifting apart.
        for (const l of loops) {
          if (l.due > now + 8) continue
          const iv = l.tick(now)
          l.due = Math.ceil((now + iv / 2) / iv) * iv
        }
        schedule()
      })),
    Math.max(0, next - performance.now() - 4),
  )
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', schedule)

export function useCanvasLoop(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  logicalW: number,
  draw: (ctx: CanvasRenderingContext2D, t: number, dt: number, still: boolean) => boolean | void,
  paused: boolean,
  stamp: number,
) {
  const drawRef = useRef(draw)
  drawRef.current = draw
  const still = reduced()
  useEffect(() => {
    const c = canvas.current
    if (!c || paused) return
    const ctx = c.getContext('2d')!
    // Size the backing store to what is shown, so a small inset does not paint a large canvas.
    const fit = () => {
      const k = (Math.min(1.5, devicePixelRatio || 1) * c.clientWidth) / logicalW
      c.width = Math.max(1, Math.round(c.clientWidth * Math.min(1.5, devicePixelRatio || 1)))
      c.height = Math.max(1, Math.round(c.clientHeight * Math.min(1.5, devicePixelRatio || 1)))
      ctx.setTransform(k, 0, 0, k, 0, 0)
    }
    fit()
    // Resizing clears the canvas; a still frame has to be drawn again.
    const refit = () => {
      fit()
      if (still) drawRef.current(ctx, performance.now() / 1000, 0, true)
    }
    // Skip the notification observe() always sends: fit() has just run.
    let seen = false
    const ro = new ResizeObserver(() => (seen ? refit() : (seen = true)))
    ro.observe(c)
    // Moving the window between a Retina and a non-Retina display changes devicePixelRatio but not the CSS size,
    // so ResizeObserver stays quiet. A resolution query matches only the current ratio; re-arm it on each change.
    let dpr = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`)
    const onDpr = () => {
      dpr.removeEventListener('change', onDpr)
      dpr = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`)
      dpr.addEventListener('change', onDpr)
      refit()
    }
    dpr.addEventListener('change', onDpr)
    const stop = () => {
      ro.disconnect()
      dpr.removeEventListener('change', onDpr)
    }
    if (still) {
      drawRef.current(ctx, performance.now() / 1000, 0, true)
      return stop
    }
    let last = 0
    const loop: Loop = {
      due: 0,
      tick: (now) => {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / FPS
        last = now
        return 1000 / (drawRef.current(ctx, now / 1000, dt, false) ? FPS : IDLE_FPS)
      },
    }
    loops.add(loop)
    schedule()
    return () => {
      loops.delete(loop)
      schedule()
      stop()
    }
    // Under reduced motion `stamp` re-runs this once per sample to draw the new still frame.
  }, [canvas, logicalW, paused, still ? stamp : 0, still])
}

export type Tile = { x: number; y: number; w: number; h: number; r: number; u: number | null; color: string }

/**
 * Brightness of one core tile at time t: its load sets the level, and a flicker that gets faster and deeper
 * with load keeps it alive. Two incommensurate sines per tile, phase-shifted by index, so neighbours never sync.
 */
export function tileAlpha(u: number | null, i: number, t: number, still: boolean): number {
  if (u == null) return 0.06
  const base = 0.12 + 0.88 * Math.min(1, Math.max(0, u))
  if (still) return base
  const f = 0.6 + 2.6 * u
  const w = Math.sin(t * f * 6.283 + i * 2.39) * 0.6 + Math.sin(t * f * 10.7 + i * 1.13) * 0.4
  return base * (1 - (0.18 + 0.27 * u) * (0.5 + 0.5 * w))
}

export function drawTiles(ctx: CanvasRenderingContext2D, tiles: Tile[], t: number, still: boolean) {
  tiles.forEach((k, i) => {
    ctx.globalAlpha = tileAlpha(k.u, i, t, still)
    ctx.fillStyle = k.color
    ctx.beginPath()
    ctx.roundRect(k.x, k.y, k.w, k.h, k.r)
    ctx.fill()
  })
  ctx.globalAlpha = 1
}
