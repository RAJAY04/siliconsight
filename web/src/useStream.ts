import { useEffect, useRef, useState } from 'react'
import type { Fast, Finger, Hardware, Message, Sample } from './types.ts'
import { startDemo } from './demo.ts'
import { sensorsOf } from './story.ts'

export type Mode = 'connecting' | 'live' | 'demo' | 'reconnecting' | 'mismatch'

/** 10 minutes at one sample per second. */
const HISTORY = 600

const isObj = (o: unknown) => typeof o === 'object' && o !== null
const isObjList = (a: unknown) => Array.isArray(a) && a.every(isObj)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Drops anything that would crash the view: a sample missing one of the objects every view reads, or a list holding a non-object. */
export function isSample(m: unknown): m is Sample {
  const s = m as Partial<Sample> | null
  return (
    s?.type === 'sample' &&
    [s.memory, s.power, s.disk, s.net, s.thermal, s.gpu].every(isObj) &&
    [s.cpu?.cores, s.topCpu, s.topMem, s.fans].every(isObjList) &&
    (s.llm == null || isObjList(s.llm.models)) &&
    // Older readers send no sensors; a malformed field inside is read as null by sensorsOf().
    (s.sensors == null || isObj(s.sensors))
  )
}

/** A fast message the scene can draw: every finger has numeric coordinates, the lid angle is a number or null. */
export function isFast(m: unknown): m is Fast {
  const f = m as Partial<Fast> | null
  return (
    f?.type === 'fast' &&
    isNum(f.t) &&
    (f.lidAngleDeg == null || isNum(f.lidAngleDeg)) &&
    (f.fingers == null || (Array.isArray(f.fingers) && f.fingers.every((p: Finger) => isObj(p) && [p.id, p.x, p.y, p.size].every(isNum))))
  )
}

/**
 * The fast channel's latest state, kept out of React so 30 messages a second never re-render the page.
 * `lid` also follows each sample. `onChange` is the scene's wake-up call.
 */
export type Live = { lid: number | null; fingers: Finger[] | null; at: number; onChange: () => void }

const wsUrl = () => (import.meta.env.DEV ? 'ws://127.0.0.1:7878/ws' : `ws://${location.host}/ws`)

export function useStream() {
  const history = useRef<Sample[]>([])
  const [hw, setHw] = useState<Hardware | null>(null)
  const [mode, setMode] = useState<Mode>('connecting')
  const [, setTick] = useState(0)
  const live = useRef<Live>({ lid: null, fingers: null, at: 0, onChange: () => {} }).current

  useEffect(() => {
    const forced = new URLSearchParams(location.search).has('demo')
    let stopDemo: (() => void) | null = null
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    let isLive = false
    let closed = false

    // ponytail: shift() on a 600-item array once a second is cheap; swap for a true ring buffer if the rate goes up.
    const push = (s: Sample) => {
      const h = history.current
      h.push(s)
      if (h.length > HISTORY) h.shift()
      const lid = sensorsOf(s).lidAngleDeg
      if (lid !== live.lid) {
        live.lid = lid
        live.onChange()
      }
      setTick((n) => n + 1)
    }
    const fast = (f: Fast) => {
      if (f.lidAngleDeg != null) live.lid = f.lidAngleDeg
      live.fingers = f.fingers ?? null
      live.at = performance.now()
      live.onChange()
    }

    const demo = () => {
      if (stopDemo) return
      setMode('demo')
      stopDemo = startDemo((m) => setHw(m.hardware), push, fast)
    }

    const connect = () => {
      if (closed) return
      ws = new WebSocket(wsUrl())
      ws.onmessage = (ev) => {
        let msg: Message
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return // A garbled frame; the next sample arrives in a second.
        }
        if (msg?.type === 'hello') {
          if (msg.version !== 1 || typeof msg.hardware !== 'object' || msg.hardware === null) {
            // A reader speaking another protocol version; show that instead of guessing at its fields.
            clearTimeout(fallback)
            stopDemo?.()
            stopDemo = null
            setMode('mismatch')
            return
          }
          isLive = true
          clearTimeout(fallback)
          // Leaving demo data drops its history; a reconnect to the reader keeps the real history, so the scene stays up.
          if (stopDemo) {
            stopDemo()
            stopDemo = null
            history.current = []
            live.lid = null
            live.fingers = null
          }
          setHw(msg.hardware)
          setMode('live')
        } else if (isLive && isSample(msg)) {
          push(msg)
        } else if (isLive && isFast(msg)) {
          fast(msg)
        }
      }
      ws.onclose = () => {
        if (closed) return
        if (isLive) setMode('reconnecting')
        // Keep probing so starting the reader later switches the page from demo to live.
        retry = setTimeout(connect, isLive ? 2000 : 5000)
      }
    }

    if (forced) demo()
    else {
      connect()
      fallback = setTimeout(() => !isLive && demo(), 3000)
    }

    return () => {
      closed = true
      clearTimeout(retry)
      clearTimeout(fallback)
      ws?.close()
      stopDemo?.()
    }
  }, [live])

  const h = history.current
  return { hw, mode, history: h, latest: h[h.length - 1] ?? null, live }
}
