import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Sample } from './types.ts'
import { NA, memGB, num, rate } from './format.ts'
import { sensorsOf } from './story.ts'
import { useCanvasLoop } from './loop.ts'
import { InfoButton } from './Learn.tsx'
import { useSimple } from './simple.ts'
import { FRAME_SIZE, GOP, busy, frameRefs, mediaOf, motionField } from './inside.ts'

/** False while the element is scrolled out of view, so its canvas loop can stop. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return on
}

/** CSS colour tokens for a canvas, re-read every couple of seconds so a theme switch follows. */
export function useTokens<K extends string>(names: readonly K[]) {
  const cache = useRef({ at: -1e9, c: {} as Record<K, string> })
  return (el: Element, t: number, force = false): Record<K, string> => {
    if (force || t - cache.current.at > 2) {
      const cs = getComputedStyle(el)
      cache.current = { at: t, c: Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()])) as Record<K, string> }
    }
    return cache.current.c
  }
}

export type Stage = { label: string; plain?: string; sub?: string }
/** How the signal looks between stages: sound, light, picture frames or a compressed bitstream. */
export type Flow = 'wave' | 'frames' | 'bits' | 'light'

const W = 400
const TOKENS = ['accent', 'accent-alt', 'cam', 'mic', 'line-strong', 'muted'] as const

/**
 * A row of stages with the signal moving through the gaps between them, drawn on one small canvas behind the
 * stage chips. It runs only while `live`; idle or unknown draws one dim still line and the loop sleeps.
 */
export function SignalPath({ stages, live, flow, level = 0.7, color = 'accent', label }: { stages: Stage[]; live: boolean | null; flow: Flow; level?: number; color?: (typeof TOKENS)[number]; label: string }) {
  const simple = useSimple()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const onScreen = useOnScreen(wrap)
  const tokens = useTokens(TOKENS)
  const state = useRef({ live, level })
  state.current = { live, level }
  const wake = useCanvasLoop(
    canvas,
    W,
    (ctx, t, _dt, still) => {
      const c = tokens(ctx.canvas, t, still)
      const h = (ctx.canvas.clientHeight * W) / Math.max(1, ctx.canvas.clientWidth)
      const y = h / 2
      ctx.clearRect(0, 0, W, h)
      const { live, level } = state.current
      if (!live) {
        ctx.strokeStyle = c['line-strong']
        ctx.setLineDash([3, 5])
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
        ctx.setLineDash([])
        return 'sleep'
      }
      const hue = c[color]
      const k = 0.5 + level
      ctx.strokeStyle = hue
      ctx.fillStyle = hue
      if (flow === 'wave') {
        // A travelling sound wave whose loudness swells and fades along the path.
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let x = 0; x <= W; x += 3) {
          const env = 0.45 + 0.55 * Math.sin(x * 0.019 - t * 0.8 * k) ** 2
          const yy = y + Math.sin(x * 0.21 - t * 4 * k) * env * h * 0.3 + Math.sin(x * 0.53 - t * 6) * h * 0.04
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      } else if (flow === 'frames') {
        // Picture frames sliding along, each a little grid of pixels.
        const gap = 34
        const off = (t * 46 * k) % gap
        for (let x = -gap + off; x < W; x += gap) {
          ctx.globalAlpha = 0.85
          ctx.strokeRect(x, y - 8, 20, 16)
          ctx.globalAlpha = 0.35
          ctx.fillRect(x + 2, y - 6, 8, 6)
          ctx.fillRect(x + 10, y, 8, 4)
        }
      } else if (flow === 'bits') {
        // A dense compressed stream: short dashes of varying length, the size of each coded frame.
        const off = (t * 70 * k) % 18
        for (let x = -18 + off, i = Math.floor(t * 70 * k / 18); x < W; x += 18, i--) {
          const len = 3 + ((i * 7919) % 11)
          ctx.globalAlpha = 0.5 + 0.5 * (((i * 31) % 5) / 4)
          ctx.fillRect(x, y - 2, len, 4)
        }
      } else {
        // Rows of pixels flowing to the panel, brighter with the backlight.
        const off = (t * 40) % 12
        for (let x = -12 + off; x < W; x += 12)
          for (let r = -1; r <= 1; r++) {
            ctx.globalAlpha = (0.25 + 0.75 * level) * (r === 0 ? 1 : 0.45)
            ctx.fillRect(x, y + r * 6 - 2, 5, 4)
          }
      }
      ctx.globalAlpha = 1
      return false
    },
    !onScreen,
    Number(live) + level,
  )
  useEffect(wake, [live, wake])
  return (
    <div ref={wrap} className={`sp-track ${live ? 'live' : ''}`}>
      <canvas ref={canvas} className="sp-canvas" aria-hidden />
      <ol className="sp-stages" aria-label={label}>
        {stages.map((st) => (
          <li key={st.label} className="sp-stage">
            <span className="sp-name">{simple && st.plain ? st.plain : st.label}</span>
            {st.sub && <span className="sp-sub">{st.sub}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** "Live", "Idle" or "n/a", as a small badge next to a card title. */
export function LiveBadge({ live, on = 'Live', off = 'Idle' }: { live: boolean | null; on?: string; off?: string }) {
  return <span className={`sp-badge ${live ? 'on' : live == null ? 'na' : ''}`}>{live == null ? 'n/a' : live ? on : off}</span>
}

function PathCard({ title, topic, live, on, off, children, note, wide }: { title: string; topic: string; live: boolean | null; on?: string; off?: string; children: ReactNode; note: ReactNode; wide?: boolean }) {
  return (
    <div className={`card sp-card ${live ? 'is-live' : ''} ${wide ? 'span-2' : ''}`}>
      <h3>
        {title} <InfoButton topic={topic} />
        <LiveBadge live={live} on={on} off={off} />
      </h3>
      {children}
      <p className="fine">{note}</p>
    </div>
  )
}

const gbs = (v: number | null) => (v == null ? NA : `${num(v, v < 10 ? 1 : 0)} GB/s`)

/** The four signal paths of the Sensors panel: sound out, sound in, camera and display. */
export function SensorPaths({ s }: { s: Sample }) {
  const simple = useSimple()
  const x = sensorsOf(s)
  const m = mediaOf(s)
  const isp = busy(m.ispGBs)
  const bright = x.displayBrightness
  return (
    <>
      <PathCard
        title={simple ? 'Sound going out' : 'Audio out'}
        topic="audio-path"
        live={x.audioPlaying}
        on="Playing"
        off="Silent"
        note={x.audioPlaying == null ? 'The reader cannot tell whether the output device is running.' : simple ? 'Moving only while some app is playing sound. No sound is ever recorded or read.' : 'Runs while the default output device is running. The reader sees that state only, never the audio.'}
      >
        <SignalPath
          label="Audio output path"
          live={x.audioPlaying}
          flow="wave"
          stages={[
            { label: 'App', sub: 'samples' },
            { label: 'Core Audio', plain: 'Sound mixer', sub: 'mix, 48 kHz' },
            { label: 'DAC + amp', plain: 'Numbers to voltage', sub: 'smart amps' },
            { label: 'Speakers', sub: '2 woofers, 2 tweeters' },
          ]}
        />
      </PathCard>
      <PathCard
        title={simple ? 'Sound coming in' : 'Microphone in'}
        topic="audio-path"
        live={x.micInUse}
        note={x.micInUse == null ? 'The reader cannot tell whether the input device is running.' : simple ? 'Moving only while some app listens. The mics are cut off by hardware when the lid closes.' : 'Runs while the default input device is running. Apple cuts the built-in mics in hardware when the lid closes.'}
      >
        <SignalPath
          label="Microphone input path"
          live={x.micInUse}
          flow="wave"
          color="mic"
          stages={[
            { label: '3 mics', plain: 'Three mics', sub: 'left of the hinge' },
            { label: 'ADC', plain: 'Voltage to numbers', sub: 'digital mics' },
            { label: 'Beamforming', plain: 'Focus on your voice', sub: 'in software' },
            { label: 'App', sub: 'call, dictation' },
          ]}
        />
      </PathCard>
      <PathCard
        title="Camera"
        topic="camera-path"
        live={x.cameraInUse}
        note={
          x.cameraInUse == null
            ? 'The reader cannot tell whether the camera is running.'
            : `${simple ? 'The green light always comes on with the camera.' : 'Apple engineers the camera so it cannot run without the green light.'} ${m.ispGBs == null ? '' : isp ? `The image processor is moving ${gbs(m.ispGBs)} through memory.` : 'The image processor is idle.'}`
        }
      >
        <SignalPath
          label="Camera path"
          live={x.cameraInUse}
          flow="frames"
          color="cam"
          stages={[
            { label: 'Sensor', plain: 'Camera', sub: '12 MP, in the notch' },
            { label: 'ISP', plain: 'Photo cleanup', sub: m.ispGBs == null ? 'on the chip' : `on the chip, ${gbs(m.ispGBs)}` },
            { label: 'Frames in memory', plain: 'Desk Space', sub: 'unified' },
            { label: 'App', sub: 'green light on' },
          ]}
        />
      </PathCard>
      <PathCard
        title={simple ? 'Screen' : 'Display'}
        topic="display-engine"
        live={bright == null ? null : bright > 0}
        on={bright == null ? 'On' : `${Math.round(bright * 100)}%`}
        off="Off"
        note={bright == null ? 'No built-in display is online, so brightness is n/a.' : simple ? 'The picture is drawn, then sent to the screen many times a second. Brightness is the light behind it.' : 'Brightness sets the LED backlight, not the pixels, so the GPU does the same work at any level.'}
      >
        <SignalPath
          label="Display path"
          live={bright == null ? null : bright > 0}
          level={bright ?? 0}
          flow="light"
          stages={[
            { label: 'GPU', plain: 'Drawing pictures', sub: 'window buffers' },
            { label: 'Display engine', plain: 'Screen sender', sub: 'layers, scaling' },
            { label: 'Panel', plain: 'Screen', sub: '2560 x 1664' },
            { label: 'Backlight', plain: 'Light behind it', sub: bright == null ? NA : `${Math.round(bright * 100)}%` },
          ]}
        />
      </PathCard>
    </>
  )
}

/** The media engine card in the Chip panel: live decode and encode lanes, then the codec illustration. */
export function MediaEngineCard({ s }: { s: Sample }) {
  const simple = useSimple()
  const m = mediaOf(s)
  const dec = busy(m.decodeGBs)
  const enc = busy(m.encodeGBs)
  const known = m.decodeGBs != null || m.encodeGBs != null
  const level = (v: number | null) => Math.min(1, (v ?? 0) / 3)
  const line = (what: string, v: number | null, on: boolean | null) => (v == null ? `${what}: n/a.` : on ? `${what}: ${gbs(v)} through memory.` : `${what}: idle.`)
  return (
    <div className="card span-2 media-card">
      <h3>
        {simple ? 'Video helper' : 'Media engine'} <InfoButton topic="media-engine" />
        <LiveBadge live={known ? Boolean(dec || enc) : null} on={dec && enc ? 'Decoding + encoding' : dec ? 'Decoding' : 'Encoding'} />
      </h3>
      <p className="lede">
        {simple
          ? 'Video is stored squeezed. A special part of the chip unsqueezes it for playback and squeezes it again when you record or share your screen, so the Fast Workers can rest.'
          : 'Fixed-function hardware turns compressed video into frames and back. The lanes move only while the reader sees that block moving data through memory.'}
      </p>
      <div className="media-lane">
        <div className="media-lane-head">
          <span>{simple ? 'Playing video' : 'Decode'}</span>
          <InfoButton topic="video-codecs" />
          <LiveBadge live={dec} />
        </div>
        <SignalPath
          label="Decode path"
          live={dec}
          level={level(m.decodeGBs)}
          flow="bits"
          stages={[
            { label: 'Bitstream', plain: 'Squeezed video', sub: 'H.264 · HEVC · AV1' },
            { label: 'Decoder', plain: 'Unsqueeze', sub: m.decodeGBs == null ? 'media engine' : gbs(m.decodeGBs) },
            { label: 'Frames in memory', plain: 'Desk Space', sub: m.scalerGBs == null ? 'unified' : `scaler ${gbs(m.scalerGBs)}` },
            { label: 'Display engine', plain: 'Screen sender', sub: 'or the GPU' },
          ]}
        />
      </div>
      <div className="media-lane">
        <div className="media-lane-head">
          <span>{simple ? 'Recording or sharing' : 'Encode'}</span>
          <InfoButton topic="video-codecs" />
          <LiveBadge live={enc} />
        </div>
        <SignalPath
          label="Encode path"
          live={enc}
          level={level(m.encodeGBs)}
          flow="frames"
          color="accent-alt"
          stages={[
            { label: 'Camera or screen', plain: 'Camera or screen', sub: m.ispGBs != null && busy(m.ispGBs) ? `ISP ${gbs(m.ispGBs)}` : 'raw frames' },
            { label: 'Encoder', plain: 'Squeeze', sub: m.encodeGBs == null ? 'media engine' : gbs(m.encodeGBs) },
            { label: 'Bitstream', plain: 'Squeezed video', sub: 'HEVC · H.264 · ProRes' },
            { label: 'SSD or network', plain: 'Saved or sent', sub: 'file or call' },
          ]}
        />
      </div>
      <p className="fine">
        {known
          ? `${line(simple ? 'Unsqueezing' : 'Decoder (AVD)', m.decodeGBs, dec)} ${line(simple ? 'Squeezing' : 'Encoder (AVE)', m.encodeGBs, enc)}${simple ? '' : ' ProRes has its own engine and no counter.'}`
          : 'This reader does not report media engine traffic, so the lanes stay still. The illustration below still shows how it works.'}
      </p>
      <CodecIllustration />
    </div>
  )
}

const ILL_TOKENS = ['accent', 'accent-alt', 'accent-hi', 'line-strong', 'muted', 'text', 'warn'] as const

/** I, P and B frames and motion vectors, drawn as a labelled illustration: none of it is live data. */
function CodecIllustration() {
  const simple = useSimple()
  const wrap = useRef<HTMLDivElement>(null)
  const gop = useRef<HTMLCanvasElement>(null)
  const mb = useRef<HTMLCanvasElement>(null)
  const onScreen = useOnScreen(wrap)
  const tokens = useTokens(ILL_TOKENS)
  // The playhead steps one frame at a time, 9 frames a second when idle-paced: it reads as video frames.
  useCanvasLoop(
    gop,
    360,
    (ctx, t, _dt, still) => {
      const c = tokens(ctx.canvas, t, still)
      ctx.clearRect(0, 0, 360, 150)
      const n = GOP.length
      const cur = still ? 4 : Math.floor(t * 3) % n
      const fw = 360 / (n + 1)
      const base = 118
      const xOf = (i: number) => fw * (i + 0.5) + 4
      // Reference arcs into the current frame.
      ctx.lineWidth = 1.5
      for (const r of frameRefs(cur)) {
        const a = xOf(cur)
        const b = xOf(r)
        ctx.strokeStyle = r < cur ? c.accent : c['accent-alt']
        ctx.beginPath()
        ctx.moveTo(b, base - 64)
        ctx.quadraticCurveTo((a + b) / 2, base - 104, a, base - 64)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(a, base - 64, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      for (let i = 0; i <= n; i++) {
        const type = GOP[i] ?? 'I'
        const hgt = 58 * FRAME_SIZE[type]
        const x = xOf(i) - fw * 0.36
        ctx.globalAlpha = i === n ? 0.35 : i === cur ? 1 : 0.55
        ctx.fillStyle = type === 'I' ? c.accent : type === 'P' ? c['accent-alt'] : c.muted
        ctx.fillRect(x, base - hgt, fw * 0.72, hgt)
        ctx.fillStyle = i === cur ? c.text : c.muted
        ctx.font = `700 ${i === cur ? 21 : 17}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(type, xOf(i), base + 24)
      }
      ctx.globalAlpha = 1
      ctx.strokeStyle = c.text
      ctx.lineWidth = 2
      ctx.strokeRect(xOf(cur) - fw * 0.44, base - 62, fw * 0.88, 92)
      return false
    },
    !onScreen,
    0,
  )
  const COLS = 16
  const ROWS = 9
  useCanvasLoop(
    mb,
    320,
    (ctx, t, _dt, still) => {
      const c = tokens(ctx.canvas, t, still)
      const cell = 320 / COLS
      ctx.clearRect(0, 0, 320, cell * ROWS)
      const { ball, blocks } = motionField(still ? 2 : Math.floor(t * 9) / 9, COLS, ROWS)
      ctx.strokeStyle = c['line-strong']
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= COLS; i++) {
        ctx.moveTo(i * cell, 0)
        ctx.lineTo(i * cell, ROWS * cell)
      }
      for (let j = 0; j <= ROWS; j++) {
        ctx.moveTo(0, j * cell)
        ctx.lineTo(COLS * cell, j * cell)
      }
      ctx.stroke()
      ctx.fillStyle = c.warn
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(ball[0] * cell, ball[1] * cell, 1.3 * cell, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = c['accent-hi']
      ctx.fillStyle = c['accent-hi']
      ctx.lineWidth = 1.6
      for (const b of blocks) {
        const x = (b.col + 0.5) * cell
        const y = (b.row + 0.5) * cell
        ctx.globalAlpha = 0.25
        ctx.fillRect(b.col * cell, b.row * cell, cell, cell)
        ctx.globalAlpha = 1
        const ex = x + b.dx * cell
        const ey = y + b.dy * cell
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(ex, ey, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      return false
    },
    !onScreen,
    0,
  )
  return (
    <div ref={wrap} className="codec-ill" role="group" aria-label="Illustration: how video compression works">
      <div className="codec-ill-head">
        <span className="sp-badge ill">{simple ? 'How it works, a drawing' : 'How it works, illustration'}</span>
        <InfoButton topic="video-codecs" />
      </div>
      <div className="codec-ill-grid">
        <figure>
          <canvas ref={gop} className="ill-gop" role="img" aria-label="A group of pictures: one I frame, then P and B frames that borrow from it" />
          <figcaption>
            {simple
              ? 'I is a whole picture. P only stores what changed since an earlier picture. B borrows from pictures on both sides, so it is the smallest. Bar height is size.'
              : 'Group of pictures. I is coded alone; P predicts from the anchor before it; B from anchors on both sides. Bar height is typical coded size; arcs show the references of the frame being decoded.'}
          </figcaption>
        </figure>
        <figure>
          <canvas ref={mb} className="ill-mb" role="img" aria-label="Macroblocks: only the blocks the moving ball covers carry motion vectors" />
          <figcaption>
            {simple
              ? 'The picture is cut into small squares. Squares that did not change are copied. Squares the ball moved through just say where to copy from, the little arrows.'
              : 'Macroblocks. Unchanged blocks are skipped; blocks the object covers carry a motion vector to where that content was in the reference frame, plus a small correction.'}
          </figcaption>
        </figure>
      </div>
    </div>
  )
}

/** Busy enough to animate, on a log scale: 20 KB/s starts the flow, 20 MB/s runs it at full speed. */
const flowLevel = (bps: number) => Math.min(1, Math.max(0, Math.log10(Math.max(1, bps) / 2e4) / 3))

/** How a download reaches an app, and how a file reaches the flash, in the Storage and network panel. */
export function IoPaths({ s }: { s: Sample }) {
  const simple = useSimple()
  const net = s.net.rxBps + s.net.txBps
  const disk = s.disk.readBps + s.disk.writeBps
  const netLive = net > 2e4
  const diskLive = disk > 2e5
  return (
    <>
      <PathCard
        title={simple ? 'How the internet reaches an app' : 'Network path'}
        topic="wifi"
        live={netLive}
        on={rate(net)}
        note={simple ? 'Radio waves arrive at antennas by the hinge, a radio chip turns them into data, and macOS hands it to the app that asked. Uploads take the same road backwards.' : `Received data runs left to right; sent data takes the same path back. ${s.net.iface ?? 'No interface'} is the busiest interface; on an Air, en0 is Wi-Fi.`}
      >
        <SignalPath
          label="Network path"
          live={netLive}
          level={flowLevel(net)}
          flow="bits"
          stages={[
            { label: 'Router', plain: 'Your router', sub: 'radio waves' },
            { label: 'Antennas', plain: 'Antennas', sub: 'behind the hinge' },
            { label: 'Wi-Fi chip', plain: 'Radio chip', sub: 'N1, Wi-Fi 7' },
            { label: 'Kernel → app', plain: 'macOS → app', sub: `down ${rate(s.net.rxBps)}` },
          ]}
        />
      </PathCard>
      <PathCard
        title={simple ? 'How a file reaches storage' : 'Storage path'}
        topic="ssd"
        live={diskLive}
        on={rate(disk)}
        note={simple ? 'A file is scrambled with a secret key on its way out of the chip, so the storage chips only ever hold scrambled data.' : 'The SSD controller and an AES engine sit inside the chip, so data is encrypted on its way to the NAND. Writes run left to right, reads come back.'}
      >
        <SignalPath
          label="Storage path"
          live={diskLive}
          level={flowLevel(disk)}
          flow="bits"
          color="accent-alt"
          stages={[
            { label: 'App', sub: 'save, open' },
            { label: 'APFS', plain: 'File system', sub: 'files to blocks' },
            { label: 'Controller + AES', plain: 'Lock and sort', sub: 'inside the chip' },
            { label: 'NAND', plain: 'Storage chips', sub: `write ${rate(s.disk.writeBps)}` },
          ]}
        />
      </PathCard>
    </>
  )
}

/** Where memory goes when it runs short: squeezed in place first, then written out to the SSD. */
export function SwapPath({ s, history }: { s: Sample; history: Sample[] }) {
  const simple = useSimple()
  const m = s.memory
  const before = history.at(-6)?.memory.swapUsedBytes ?? m.swapUsedBytes
  const moving = Math.abs(m.swapUsedBytes - before) > 2 ** 20
  const live = moving || m.pressure !== 'normal'
  const verdict = moving ? (m.swapUsedBytes > before ? (simple ? 'Spilling over now.' : 'Swap grew in the last few seconds.') : simple ? 'Coming back from Overflow Storage now.' : 'Swap shrank in the last few seconds.') : simple ? 'Nothing is moving right now.' : 'Nothing moved in or out of swap in the last few seconds.'
  return (
    <PathCard
      wide
      title={simple ? 'When the Desk Space runs short' : 'When memory runs short'}
      topic="swap"
      live={live}
      on={moving ? 'Moving' : m.pressure === 'warn' ? 'Tight' : 'Full'}
      off="Calm"
      note={`${simple ? 'macOS squeezes pages it has not used for a while first, which is fast, and only writes to Overflow Storage when squeezing is not enough.' : 'macOS compresses idle pages in RAM first, then writes compressed segments to swap files on the SSD when that is not enough.'} ${verdict}`}
    >
      <SignalPath
        label="Memory to swap path"
        live={live}
        level={moving ? 0.8 : 0.3}
        flow="frames"
        color="accent-alt"
        stages={[
          { label: 'App pages', plain: 'Desk Space', sub: `${memGB(m.appBytes ?? m.activeBytes)} in use` },
          { label: 'Compressor', plain: 'Squeeze', sub: `${memGB(m.compressedBytes)} squeezed` },
          { label: 'Swap files', plain: 'Overflow Storage', sub: m.swapUsedBytes > 0 ? `${memGB(m.swapUsedBytes)} on SSD` : 'empty' },
          { label: 'Back in use', plain: 'Brought back', sub: 'when touched' },
        ]}
      />
    </PathCard>
  )
}
