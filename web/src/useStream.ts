import { useEffect, useRef, useState } from 'react'
import type { Hardware, Message, Sample } from './types.ts'
import { startDemo } from './demo.ts'

export type Mode = 'connecting' | 'live' | 'demo' | 'reconnecting' | 'mismatch'

/** 10 minutes at one sample per second. */
const HISTORY = 600

const isObj = (o: unknown) => typeof o === 'object' && o !== null
const isObjList = (a: unknown) => Array.isArray(a) && a.every(isObj)

/** Drops anything that would crash the view: a sample missing one of the objects every view reads, or a list holding a non-object. */
export function isSample(m: unknown): m is Sample {
  const s = m as Partial<Sample> | null
  return (
    s?.type === 'sample' &&
    [s.memory, s.power, s.disk, s.net, s.thermal, s.gpu].every(isObj) &&
    [s.cpu?.cores, s.topCpu, s.topMem, s.fans].every(isObjList) &&
    (s.llm == null || isObjList(s.llm.models))
  )
}

const wsUrl = () => (import.meta.env.DEV ? 'ws://127.0.0.1:7878/ws' : `ws://${location.host}/ws`)

export function useStream() {
  const history = useRef<Sample[]>([])
  const [hw, setHw] = useState<Hardware | null>(null)
  const [mode, setMode] = useState<Mode>('connecting')
  const [, setTick] = useState(0)

  useEffect(() => {
    const forced = new URLSearchParams(location.search).has('demo')
    let stopDemo: (() => void) | null = null
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    let live = false
    let closed = false

    // ponytail: shift() on a 600-item array once a second is cheap; swap for a true ring buffer if the rate goes up.
    const push = (s: Sample) => {
      const h = history.current
      h.push(s)
      if (h.length > HISTORY) h.shift()
      setTick((n) => n + 1)
    }

    const demo = () => {
      if (stopDemo) return
      setMode('demo')
      stopDemo = startDemo((m) => setHw(m.hardware), push)
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
          live = true
          clearTimeout(fallback)
          // Leaving demo data drops its history; a reconnect to the reader keeps the real history, so the scene stays up.
          if (stopDemo) {
            stopDemo()
            stopDemo = null
            history.current = []
          }
          setHw(msg.hardware)
          setMode('live')
        } else if (live && isSample(msg)) {
          push(msg)
        }
      }
      ws.onclose = () => {
        if (closed) return
        if (live) setMode('reconnecting')
        // Keep probing so starting the reader later switches the page from demo to live.
        retry = setTimeout(connect, live ? 2000 : 5000)
      }
    }

    if (forced) demo()
    else {
      connect()
      fallback = setTimeout(() => !live && demo(), 3000)
    }

    return () => {
      closed = true
      clearTimeout(retry)
      clearTimeout(fallback)
      ws?.close()
      stopDemo?.()
    }
  }, [])

  const h = history.current
  return { hw, mode, history: h, latest: h[h.length - 1] ?? null }
}
