import { useState } from 'react'
import { bytes, memGB, num, rate } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, lerp, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { watchLaunch, type Watch } from './launch.ts'
import './AppLaunch.css'

// A drawn desktop on top, and underneath it the seven programs that take part in opening an app, one lane each.
// The panel on the right shows what the current lane is doing. Coordinates are in the SVG's 960 x 600 viewBox.

type AppId = 'browser' | 'notes' | 'photos' | 'music' | 'terminal'
type Mode = 'first' | 'cold' | 'warm'
type App = { id: AppId; name: string; libs: number }

/** `libs` is what `otool -L` listed for the matching Apple app on the Mac this lab was checked on. */
const APPS: App[] = [
  { id: 'browser', name: 'Browser', libs: 2 },
  { id: 'notes', name: 'Notes', libs: 105 },
  { id: 'photos', name: 'Photos', libs: 136 },
  { id: 'music', name: 'Music', libs: 154 },
  { id: 'terminal', name: 'Terminal', libs: 38 },
]

const ICON = (i: number) => ({ x: 344 + i * 58, y: 187, s: 40 })
const WIN = { x: 250, y: 40, w: 460, h: 132 }
const LANE_Y = (i: number) => 258 + i * 46
const LANE_H = 38
const SPINE = 160
const P = { x: 572, y: 258, w: 372, h: 314 }

const LANES = [
  { tech: 'LaunchServices', plain: 'App finder' },
  { tech: 'launchd', plain: 'Process starter' },
  { tech: 'Kernel', plain: 'macOS core' },
  { tech: 'dyld', plain: 'Linker' },
  { tech: 'app', plain: 'app' },
  { tech: 'WindowServer', plain: 'Window manager' },
  { tech: 'GPU, display', plain: 'Screen' },
]
/** The lanes each step lights up. */
const STEP_LANES = [[0], [1], [2], [2], [3], [4], [2, 4], [5, 6]]

function Icon({ id, x, y, s }: { id: AppId; x: number; y: number; s: number }) {
  const X = (k: number) => x + k * s
  const Y = (k: number) => y + k * s
  return (
    <g className={`al-icon al-${id}`}>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.24} />
      {id === 'browser' && (
        <g className="al-glyph">
          <circle cx={X(0.5)} cy={Y(0.5)} r={s * 0.3} />
          <ellipse cx={X(0.5)} cy={Y(0.5)} rx={s * 0.13} ry={s * 0.3} />
          <line x1={X(0.2)} x2={X(0.8)} y1={Y(0.5)} y2={Y(0.5)} />
        </g>
      )}
      {id === 'notes' && (
        <g className="al-glyph">
          {[0.34, 0.5, 0.66].map((k) => (
            <line key={k} x1={X(0.24)} x2={X(k === 0.66 ? 0.6 : 0.76)} y1={Y(k)} y2={Y(k)} />
          ))}
        </g>
      )}
      {id === 'photos' && (
        <g className="al-glyph al-fill">
          {[0, 1, 2, 3].map((k) => (
            <circle key={k} cx={X(0.5 + 0.12 * Math.cos((k * Math.PI) / 2))} cy={Y(0.5 + 0.12 * Math.sin((k * Math.PI) / 2))} r={s * 0.15} opacity={0.55} />
          ))}
        </g>
      )}
      {id === 'music' && (
        <g className="al-glyph">
          <circle className="al-fill" cx={X(0.36)} cy={Y(0.7)} r={s * 0.09} />
          <circle className="al-fill" cx={X(0.66)} cy={Y(0.62)} r={s * 0.09} />
          <path d={`M ${X(0.44)} ${Y(0.7)} V ${Y(0.28)} L ${X(0.74)} ${Y(0.22)} V ${Y(0.62)}`} />
        </g>
      )}
      {id === 'terminal' && (
        <g className="al-glyph">
          <path d={`M ${X(0.24)} ${Y(0.36)} L ${X(0.4)} ${Y(0.5)} L ${X(0.24)} ${Y(0.64)}`} />
          <line x1={X(0.46)} x2={X(0.7)} y1={Y(0.66)} y2={Y(0.66)} />
        </g>
      )}
    </g>
  )
}

/** What each app's window shows once it's up, drawn inside the window's content area. */
function WindowBody({ id, x, y, w, h }: { id: AppId; x: number; y: number; w: number; h: number }) {
  switch (id) {
    case 'browser':
      return (
        <g className="al-wb">
          <rect x={x + 60} y={y + 8} width={w - 120} height={14} rx={7} className="al-wb-soft" />
          <rect x={x + 14} y={y + 32} width={w * 0.5} height={10} rx={3} />
          <rect x={x + 14} y={y + 50} width={w - 28} height={h - 62} rx={6} className="al-wb-soft" />
        </g>
      )
    case 'notes':
      return (
        <g className="al-wb">
          <rect x={x} y={y} width={w * 0.3} height={h} className="al-wb-soft" />
          {[0, 1, 2, 3, 4].map((k) => (
            <rect key={k} x={x + w * 0.34} y={y + 12 + k * 15} width={(w * 0.6 * (5 - (k % 3))) / 5} height={6} rx={3} />
          ))}
        </g>
      )
    case 'photos':
      return (
        <g className="al-wb">
          {Array.from({ length: 12 }, (_, k) => (
            <rect key={k} x={x + 12 + (k % 6) * ((w - 24) / 6)} y={y + 10 + Math.floor(k / 6) * 44} width={(w - 24) / 6 - 6} height={38} rx={4} className={k % 3 ? 'al-wb-soft' : ''} />
          ))}
        </g>
      )
    case 'music':
      return (
        <g className="al-wb">
          <rect x={x + 14} y={y + 10} width={80} height={80} rx={6} className="al-wb-soft" />
          <rect x={x + 108} y={y + 22} width={w * 0.4} height={8} rx={4} />
          <rect x={x + 108} y={y + 40} width={w * 0.25} height={6} rx={3} />
          <rect x={x + 108} y={y + 70} width={w - 130} height={4} rx={2} className="al-wb-soft" />
          <rect x={x + 108} y={y + 70} width={(w - 130) * 0.35} height={4} rx={2} />
        </g>
      )
    case 'terminal':
      return (
        <g className="al-wb-term">
          <rect x={x} y={y} width={w} height={h} />
          <text x={x + 12} y={y + 22}>
            ~ % ls
          </text>
          <text x={x + 12} y={y + 42}>
            Desktop Documents Downloads
          </text>
          <text x={x + 12} y={y + 62}>
            ~ % _
          </text>
        </g>
      )
  }
}

type Frame = { lit: number[]; done: number; token: [number, number] | null; open: number; bounce: number; running: boolean }

function frameAt(i: number, t: number, iconX: number): Frame {
  const lanes = STEP_LANES[i]
  const prev = i === 0 ? null : STEP_LANES[i - 1][STEP_LANES[i - 1].length - 1]
  const to: [number, number] = [SPINE, LANE_Y(lanes[0]) + LANE_H / 2]
  const from: [number, number] = prev == null ? [iconX + 20, 234] : [SPINE, LANE_Y(prev) + LANE_H / 2]
  const k = phase(t, 0.1, 1.1)
  return {
    lit: lanes,
    done: Math.max(...lanes) + (k >= 1 ? 1 : 0),
    token: k < 1 ? along(prev == null ? [from, [iconX + 20, 248], [SPINE, 248], to] : [from, to], k) : null,
    open: i === 7 ? phase(t, 3.2, 4.4) : 0,
    // The icon hops while the app is starting, and stops once its window is up.
    bounce: i < 7 || t < 3.2 ? Math.abs(Math.sin(t * 5 + i)) : 0,
    running: i >= 1,
  }
}

function Panel({ i, t, app, mode, simple }: { i: number; t: number; app: App; mode: Mode; simple: boolean }) {
  const x0 = P.x + 18
  const head = (tech: string, plain: string) => (
    <text className="al-p-head" x={x0} y={P.y + 26}>
      {simple ? plain : tech}
    </text>
  )
  const appear = (n: number, gap = 0.5, start = 0.6) => phase(t, start + n * gap, start + n * gap + 0.35)
  const line = (y: number, text: string, cls = 'al-small al-muted', o = 1) => (
    <text className={cls} x={x0} y={P.y + y} opacity={o}>
      {text}
    </text>
  )
  switch (i) {
    case 0: {
      const rows = simple
        ? [
            ['Name', app.name],
            ['File to run', app.name],
            ['Kind', 'application'],
          ]
        : [
            ['CFBundleIdentifier', `com.example.${app.id}`],
            ['CFBundleExecutable', app.name],
            ['CFBundlePackageType', 'APPL'],
          ]
      return (
        <g>
          {head('Info.plist, inside the app bundle', "The app's label")}
          <rect className="al-p-box" x={x0} y={P.y + 44} width={P.w - 36} height={112} rx={8} />
          {rows.map(([k, v], n) => (
            <g key={k} opacity={appear(n)}>
              <text className="al-mono al-muted" x={x0 + 12} y={P.y + 72 + n * 30}>
                {k}
              </text>
              <text className="al-mono" x={P.x + P.w - 30} y={P.y + 72 + n * 30} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {line(186, simple ? 'So the file to start is:' : 'So the executable is:', 'al-small al-muted', appear(3))}
          {line(208, `${app.name}.app/Contents/MacOS/${app.name}`, 'al-mono al-accent', appear(3))}
          {line(250, simple ? 'An app is a folder. A label inside says what to run.' : 'An .app is a folder; Info.plist names the binary.', 'al-small al-muted', appear(4))}
        </g>
      )
    }
    case 1: {
      const kids = ['Dock', 'Finder', app.name]
      const grow = phase(t, 0.8, 2.2)
      return (
        <g>
          {head('posix_spawn() from launchd', 'A new process is born')}
          <rect className="al-p-box" x={x0 + 106} y={P.y + 50} width={128} height={36} rx={8} />
          <text className="al-mono" x={x0 + 170} y={P.y + 73} textAnchor="middle">
            {simple ? 'starter, no. 1' : 'launchd, PID 1'}
          </text>
          {kids.map((k, n) => {
            const kx = x0 + 10 + n * 116
            const isNew = n === 2
            return (
              <g key={k} opacity={isNew ? Math.min(1, grow * 1.4) : 0.75}>
                <path className={`al-tree ${isNew ? 'new' : ''}`} d={`M ${x0 + 170} ${P.y + 86} V ${P.y + 112} H ${kx + 50} V ${lerp(P.y + 112, P.y + 136, isNew ? grow : 1)}`} />
                {(!isNew || grow > 0.9) && (
                  <>
                    <rect className={`al-p-box ${isNew ? 'al-new' : ''}`} x={kx} y={P.y + 136} width={100} height={36} rx={8} />
                    <text className="al-small" x={kx + 50} y={P.y + 159} textAnchor="middle">
                      {k}
                    </text>
                  </>
                )}
              </g>
            )
          })}
          {line(208, simple ? 'Every app you open is started by the same' : 'Apps you open are children of PID 1. Here,', 'al-small al-muted', appear(4))}
          {line(226, simple ? 'starter, which macOS runs first at boot.' : 'ps shows parent 1 for Dock, Finder and Chrome.', 'al-small al-muted', appear(4))}
          {line(262, simple ? 'It is empty: no app code has run yet.' : 'The process has a PID and nothing else yet.', 'al-small al-accent', appear(5))}
        </g>
      )
    }
    case 2: {
      const segs = ['__PAGEZERO', '__TEXT', '__DATA_CONST', '__DATA', '__LINKEDIT', 'dyld']
      const plainSegs = ['fenced-off area', 'app code', 'fixed data', 'changing data', 'linking notes', 'the linker']
      return (
        <g>
          {head('Mapping the Mach-O file', "Setting up the app's memory")}
          <text className="al-small al-muted" x={x0} y={P.y + 52}>
            {simple ? 'Memory map' : 'New address space'}
          </text>
          <text className="al-small al-muted" x={x0 + 206} y={P.y + 52}>
            {simple ? 'App file on the SSD' : 'Files on the SSD'}
          </text>
          {segs.map((sg, n) => {
            const y = P.y + 62 + n * 34
            const k = appear(n, 0.35, 0.5)
            return (
              <g key={sg} opacity={0.25 + 0.75 * k}>
                <rect className={`al-seg ${n === 0 ? 'zero' : ''}`} x={x0} y={y} width={150} height={28} rx={5} />
                <text className={simple ? 'al-small' : 'al-mono'} x={x0 + 8} y={y + 18}>
                  {simple ? plainSegs[n] : sg}
                </text>
                {n > 0 && (
                  <>
                    <rect className="al-file" x={x0 + 206} y={y} width={130} height={28} rx={5} />
                    <text className="al-small al-muted" x={x0 + 214} y={y + 18}>
                      {n === 5 ? '/usr/lib/dyld' : `${app.name}, part ${n}`}
                    </text>
                    <path className="al-map dashed" d={`M ${x0 + 206} ${y + 14} H ${x0 + 152}`} opacity={k} />
                  </>
                )}
              </g>
            )
          })}
          {line(284, simple ? 'Linked up, but nothing copied off the SSD yet.' : 'Mapped, not read: no page is in RAM yet.', 'al-small al-accent', appear(6))}
        </g>
      )
    }
    case 3: {
      const checked = Math.floor(phase(t, 0.6, 3) * 24)
      const gk = mode === 'first'
      const rows = simple ? ['Made by a known developer', 'Scanned by Apple for malware', 'You agreed to open it'] : ['Developer ID signature valid', 'Notarization ticket found', 'You approved the first open']
      return (
        <g>
          {head('Code signature, then Gatekeeper', 'Checking the seal')}
          {line(52, simple ? 'Each piece of code has a fingerprint to match' : 'One SHA-256 hash per code page')}
          {Array.from({ length: 24 }, (_, n) => (
            <rect key={n} className={`al-pg ${n < checked ? 'ok' : ''}`} x={x0 + (n % 12) * 28} y={P.y + 64 + Math.floor(n / 12) * 28} width={22} height={22} rx={4} />
          ))}
          <rect className={`al-p-box ${gk ? '' : 'al-dim'}`} x={x0} y={P.y + 136} width={P.w - 36} height={130} rx={8} />
          <text className="al-small al-bold" x={x0 + 12} y={P.y + 158}>
            {gk ? (simple ? 'First open of a downloaded app' : 'Gatekeeper, first launch only') : simple ? 'Opened before: no extra questions' : 'Gatekeeper: already approved'}
          </text>
          {rows.map((r, n) => {
            const k = gk ? appear(n, 0.7, 2.8) : 0
            return (
              <g key={r} opacity={gk ? 0.35 + 0.65 * k : 0.35}>
                <circle className={`al-chk ${k >= 1 ? 'ok' : ''}`} cx={x0 + 22} cy={P.y + 180 + n * 26} r={8} />
                {k >= 1 && <path className="al-tick" d={`M ${x0 + 18} ${P.y + 180 + n * 26} l 3 3 l 6 -6`} />}
                <text className="al-small" x={x0 + 38} y={P.y + 184 + n * 26}>
                  {r}
                </text>
              </g>
            )
          })}
          {line(292, simple ? 'A piece that fails its check never runs.' : 'A page whose hash fails never runs.')}
        </g>
      )
    }
    case 4: {
      const libs = [
        ['libSystem', true],
        ['Foundation', true],
        ['AppKit', true],
        ['CoreGraphics', true],
        [simple ? "the app's own parts" : `${app.name}Kit.framework`, false],
      ] as const
      const warm = mode === 'warm'
      return (
        <g>
          {head(`dyld: ${app.libs} direct dependencies`, `Connecting ${app.libs} building blocks`)}
          {libs.map(([l, cached], n) => {
            const y = P.y + 44 + n * 30
            return (
              <g key={l} opacity={0.3 + 0.7 * appear(n, 0.3, 0.4)}>
                <rect className={`al-lib ${cached ? 'cache' : ''}`} x={x0} y={y} width={176} height={24} rx={5} />
                <text className="al-small" x={x0 + 8} y={y + 16}>
                  {l}
                </text>
                <text className="al-small al-muted" x={x0 + 186} y={y + 16}>
                  {cached ? (simple ? 'shared, already there' : 'in the shared cache') : simple ? 'loaded and wired up' : 'mmap, then fixups'}
                </text>
              </g>
            )
          })}
          <g opacity={appear(0, 0, 2.2)}>
            <text className="al-small al-bold" x={x0} y={P.y + 214}>
              {simple ? 'Filling in addresses' : 'Fixups'}
            </text>
            <rect className="al-p-box" x={x0} y={P.y + 224} width={P.w - 36} height={50} rx={8} />
            <text className="al-mono" x={x0 + 10} y={P.y + 244}>
              {simple ? 'own spot + where it landed' : 'rebase: pointer + ASLR slide'}
            </text>
            <text className="al-mono" x={x0 + 10} y={P.y + 264} opacity={appear(0, 0, 3)}>
              {simple ? '"malloc" → its real address' : 'bind: "_malloc" → libSystem'}
            </text>
          </g>
          {line(
            298,
            warm ? (simple ? 'Opened recently: it reuses its earlier work.' : 'Warm: dyld reuses work saved from a past launch.') : simple ? 'Not opened lately: it works it all out.' : 'Cold: dyld resolves every dependency now.',
            `al-small ${warm ? 'al-ok' : 'al-muted'}`,
            appear(0, 0, 3.6),
          )}
        </g>
      )
    }
    case 5: {
      const calls = simple
        ? ['set-up code in each library', `${app.name}'s own start`, 'build the menu and window', 'wait for clicks and keys']
        : ['dyld runs initializers', 'main()', 'NSApplicationMain()', 'load menu and window', 'run loop waits for events']
      return (
        <g>
          {head('main() and AppKit', 'The app wakes up')}
          {calls.map((c, n) => (
            <g key={c} opacity={appear(n, 0.6, 0.4)}>
              <rect className={`al-call ${n === calls.length - 1 ? 'last' : ''}`} x={x0 + n * 14} y={P.y + 44 + n * 48} width={P.w - 36 - n * 14} height={36} rx={7} />
              <text className={simple ? 'al-small' : 'al-mono'} x={x0 + n * 14 + 12} y={P.y + 67 + n * 48}>
                {c}
              </text>
            </g>
          ))}
        </g>
      )
    }
    case 6: {
      const warm = mode === 'warm'
      const fx = (n: number) => x0 + 176 + (n % 4) * 42
      const fy = (n: number) => P.y + 54 + Math.floor(n / 4) * 40
      const want = [1, 2, 5, 6, 9, 10, 13, 14]
      const arrived = (n: number) => phase(t, 0.6 + n * 0.45, 1.3 + n * 0.45)
      return (
        <g>
          {head(warm ? 'Page faults, answered from RAM' : 'Page faults, answered from the SSD', warm ? 'Fetched from Desk Space' : 'Fetched from the SSD')}
          {line(64, simple ? 'Each first touch of' : 'Each first touch of a')}
          {line(84, simple ? 'a piece of code pauses' : 'code page faults, and')}
          {line(104, simple ? 'the app for a moment.' : 'the kernel fills it in.')}
          <text className="al-small al-muted" x={fx(0)} y={P.y + 46}>
            {simple ? 'Desk Space' : 'RAM'}
          </text>
          {Array.from({ length: 16 }, (_, n) => {
            const w = want.indexOf(n)
            const k = w < 0 ? 0 : arrived(w)
            const filled = w >= 0 && (warm || k >= 1)
            return <rect key={n} className={`al-fr ${filled ? 'in' : ''}`} x={fx(n)} y={fy(n)} width={34} height={34} rx={5} />
          })}
          <rect className="al-ssd" x={x0} y={P.y + 230} width={P.w - 36} height={46} rx={8} />
          <text className="al-small al-bold" x={x0 + 12} y={P.y + 258}>
            SSD
          </text>
          <text className="al-small al-muted" x={x0 + 52} y={P.y + 258}>
            {warm ? (simple ? 'not needed this time' : 'idle: the pages are still cached') : simple ? `${app.name}'s file` : `${app.name} executable and frameworks`}
          </text>
          {!warm &&
            want.map((n, w) => {
              const k = arrived(w)
              if (k <= 0 || k >= 1) return null
              const [x, y] = along([[x0 + 200 + w * 16, P.y + 230], [x0 + 200 + w * 16, P.y + 214], [fx(n) + 17, fy(n) + 17]], k)
              return <rect key={n} className="al-pkt" x={x - 7} y={y - 7} width={14} height={14} rx={3} />
            })}
          {warm &&
            want.map((n, w) => {
              const k = arrived(w)
              return k > 0 && k < 1 ? <rect key={n} className="al-flash" x={fx(n) - 3} y={fy(n) - 3} width={40} height={40} rx={7} /> : null
            })}
          {line(
            300,
            warm ? (simple ? 'Same pieces, no trip to the SSD.' : 'Same faults, no disk reads: cache hits.') : simple ? 'Each piece comes off the SSD once.' : 'Each fault here is a page-in, counted above.',
            `al-small ${warm ? 'al-ok' : 'al-accent'}`,
          )}
        </g>
      )
    }
    default: {
      const layers = simple ? ['Desktop picture', 'Other windows', `${app.name} window`] : ['Desktop', 'Other windows', `${app.name} window`]
      const merge = phase(t, 1.2, 2.6)
      return (
        <g>
          {head('Compositing the first frame', 'Putting the picture together')}
          {layers.map((l, n) => {
            const y = lerp(P.y + 46 + n * 50, P.y + 76 + n * 22, merge)
            const x = lerp(x0 + n * 22, x0 + n * 12, merge)
            return (
              <g key={l} opacity={appear(n, 0.3, 0.2)}>
                <rect className={`al-layer l${n}`} x={x} y={y} width={190} height={60} rx={7} />
                <text className="al-small" x={x + 10} y={y + 16}>
                  {l}
                </text>
              </g>
            )
          })}
          <path className="al-map" d={`M ${x0 + 220} ${P.y + 126} H ${x0 + 250}`} opacity={merge} />
          <g opacity={phase(t, 2.4, 3)}>
            <rect className="al-display" x={x0 + 254} y={P.y + 90} width={84} height={72} rx={6} />
            <text className="al-small" x={x0 + 296} y={P.y + 130} textAnchor="middle">
              {simple ? 'screen' : 'display'}
            </text>
          </g>
          {line(222, simple ? 'The app draws only its own window.' : 'The app renders only its own window.')}
          {line(242, simple ? 'The window manager and graphics chip' : 'WindowServer composites every window,')}
          {line(262, simple ? 'stack every window into one picture.' : 'with the GPU, into one frame.')}
          {line(296, simple ? 'The window appears. You can click it.' : 'First frame on screen: the launch is done.', 'al-small al-accent', phase(t, 3.2, 3.8))}
        </g>
      )
    }
  }
}

function Scene({ i, t, app, mode, opened, split }: { i: number; t: number; app: App; mode: Mode; opened: boolean; split: number }) {
  const simple = useSimple()
  const ai = APPS.indexOf(app)
  const ic = ICON(ai)
  const f = frameAt(i, t, ic.x)
  const warm = mode === 'warm'
  const laneText = (n: number): string => {
    const tech = [
      'finds the bundle, asks launchd to start it',
      'posix_spawn(): new process, parent PID 1',
      i >= 6 ? (warm ? 'page faults: pages already in RAM' : 'page faults: reads pages from the SSD') : i >= 3 ? 'maps the file, checks code signatures' : 'maps the executable, starts dyld',
      `loads ${app.libs} libraries, applies fixups`,
      'main() runs, AppKit builds the window',
      'composites every window into one frame',
      'GPU draws the frame, display shows it',
    ]
    const plain = [
      'finds the app and asks for it to start',
      'starts a new, empty process',
      i >= 6 ? (warm ? 'finds the code already in Desk Space' : 'copies code off the SSD as needed') : i >= 3 ? "sets up memory, checks the app's seal" : "sets up the app's memory",
      `connects ${app.libs} building blocks`,
      "the app's own code starts",
      'puts all the windows together',
      'paints the picture on the screen',
    ]
    return (simple ? plain : tech)[n]
  }
  const hood = opened ? split : 0
  const bounce = opened ? f.bounce * 8 * (1 - f.open) : 0
  const winK = opened ? f.open : 0
  const wx = lerp(ic.x, WIN.x, winK)
  const wy = lerp(ic.y, WIN.y, winK)
  const ww = lerp(ic.s, WIN.w, winK)
  const wh = lerp(ic.s, WIN.h, winK)
  const front = opened && i >= 5 ? app.name : 'Desktop'
  return (
    <svg className="al-scene" viewBox="0 0 960 600" role="img" aria-label={`A drawn desktop with a dock of five apps, and underneath it the programs that take part in opening ${app.name}, step ${i + 1}`}>
      <defs>
        <linearGradient id="al-wall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="al-wall-a" />
          <stop offset="1" className="al-wall-b" />
        </linearGradient>
      </defs>
      <g transform={`translate(0 ${-4 * hood})`}>
        <rect className="al-screen" x={16} y={8} width={928} height={232} rx={14} />
        <path className="al-menubar" d="M 16 30 V 22 Q 16 8 30 8 H 930 Q 944 8 944 22 V 30 Z" />
        <circle className="al-menu-dot" cx={34} cy={19} r={5} />
        <text className="al-menu al-bold" x={48} y={23}>
          {front}
        </text>
        {['File', 'Edit', 'View', 'Window'].map((m, n) => (
          <text key={m} className="al-menu" x={58 + front.length * 8 + n * 46} y={23}>
            {m}
          </text>
        ))}
        <rect className="al-dock" x={330} y={180} width={300} height={54} rx={16} />
        {APPS.map((a, n) => {
          const p = ICON(n)
          const me = n === ai && opened
          return (
            <g key={a.id} transform={me ? `translate(0 ${-bounce})` : undefined}>
              <Icon id={a.id} {...p} />
              {me && f.running && <circle className="al-run" cx={p.x + 20} cy={p.y + 44 + bounce} r={2.5} />}
            </g>
          )
        })}
        {winK > 0 && (
          <g opacity={Math.min(1, winK * 2)}>
            <rect className="al-win-frame" x={wx} y={wy} width={ww} height={wh} rx={10 * winK} />
            {winK > 0.95 && (
              <>
                <path className="al-win-bar" d={`M ${wx} ${wy + 22} V ${wy + 10} Q ${wx} ${wy} ${wx + 10} ${wy} H ${wx + ww - 10} Q ${wx + ww} ${wy} ${wx + ww} ${wy + 10} V ${wy + 22} Z`} />
                {[0, 1, 2].map((n) => (
                  <circle key={n} className="al-win-btn" cx={wx + 16 + n * 16} cy={wy + 11} r={4.5} />
                ))}
                <text className="al-small al-bold" x={wx + ww / 2} y={wy + 15} textAnchor="middle">
                  {app.name}
                </text>
                <WindowBody id={app.id} x={wx + 1} y={wy + 23} w={ww - 2} h={wh - 24} />
              </>
            )}
          </g>
        )}
        {!opened && (
          <g>
            <rect className="al-hint-bg" x={250} y={96} width={460} height={40} rx={20} />
            <text className="al-hint" x={480} y={121} textAnchor="middle">
              {simple ? 'Click an app in the Dock to open it' : 'Click an app in the Dock to open it and look underneath'}
            </text>
          </g>
        )}
      </g>

      <path className="al-seam" d="M 16 247 H 944" opacity={hood} />

      <g opacity={0.2 + 0.8 * hood} transform={`translate(0 ${12 * (1 - hood)})`}>
        <line className="al-spine" x1={SPINE} x2={SPINE} y1={LANE_Y(0) + LANE_H / 2} y2={LANE_Y(6) + LANE_H / 2} />
        {LANES.map((l, n) => {
          const lit = opened && f.lit.includes(n)
          const done = opened && n < f.done && !lit
          return (
            <g key={n} className={`al-lane ${lit ? 'lit' : done ? 'done' : ''}`}>
              <rect x={16} y={LANE_Y(n)} width={540} height={LANE_H} rx={8} />
              <text className="al-lane-name" x={30} y={LANE_Y(n) + 24}>
                {n === 4 ? app.name : simple ? l.plain : l.tech}
              </text>
              <circle className="al-node" cx={SPINE} cy={LANE_Y(n) + LANE_H / 2} r={5} />
              {(lit || done) && (
                <text className="al-lane-text" x={178} y={LANE_Y(n) + 24}>
                  {laneText(n)}
                </text>
              )}
            </g>
          )
        })}
        <rect className="al-panel" x={P.x} y={P.y} width={P.w} height={P.h} rx={12} />
        {opened ? (
          <Panel i={i} t={t} app={app} mode={mode} simple={simple} />
        ) : (
          <text className="al-small al-muted" x={P.x + P.w / 2} y={P.y + P.h / 2} textAnchor="middle">
            {simple ? 'What macOS does shows up here' : 'Each step of the launch shows up here'}
          </text>
        )}
        {f.token && opened && <circle className="al-token" cx={f.token[0]} cy={f.token[1]} r={8} />}
      </g>
    </svg>
  )
}

/** Start, open an app for real, and read what it cost this Mac. */
function Watcher({ s, history, demo }: { s: LabProps['s']; history: LabProps['history']; demo: boolean }) {
  const simple = useSimple()
  const [start, setStart] = useState<LabProps['s'] | null>(null)
  const [runs, setRuns] = useState<Watch[]>([])
  const w = start ? watchLaunch(start, history.filter((x) => x.t > start.t)) : null
  const stop = () => {
    if (w) setRuns((r) => [w, ...r].slice(0, 3))
    setStart(null)
  }
  const show = (x: Watch) => (
    <dl className="al-watch">
      <div>
        <dt>{simple ? 'Fetched from SSD' : 'Paged in from files'}</dt>
        <dd className="num">{x.pageinBytes == null ? 'n/a' : bytes(x.pageinBytes)}</dd>
      </div>
      <div>
        <dt>{simple ? 'Busiest second' : 'Peak page-ins'}</dt>
        <dd className="num">{x.peakPageins == null ? 'n/a' : `${num(x.peakPageins)}/s`}</dd>
      </div>
      <div>
        <dt>{simple ? 'Fastest SSD reading' : 'Peak disk reads'}</dt>
        <dd className="num">{rate(x.peakReadBps)}</dd>
      </div>
      <div>
        <dt>{simple ? 'New in the Desk Space list' : 'New in the top memory list'}</dt>
        <dd>{x.arrivals.length ? x.arrivals.slice(0, 3).map((a) => `${a.name} ${memGB(a.bytes)}`).join(', ') : 'none yet'}</dd>
      </div>
    </dl>
  )
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: open a real app and watch' : 'Try it: watch a real launch'}</h3>
      <p className="fine">
        {simple
          ? 'Pick a big app you have not opened since you last restarted the Mac. Press Start, open the app, wait until its window is up, then press Stop. Then quit the app, press Start again and reopen it. The second time is a warm launch, and far less should come off the SSD.'
          : "Pick a big app you haven't opened since boot. Press Start, open the app, wait for its first window, then Stop. Quit it and repeat for a warm launch: page-ins should drop sharply the second time, because the app's pages are still in the page cache."}
      </p>
      {s.paging == null && <p className="fine">This reader sends no paging counters, so only disk reads and new processes will show. Pull the repo and run ./run.sh again.</p>}
      {demo && <p className="fine">This is demo data, so these numbers are simulated, not this Mac.</p>}
      <div className="lab-try-row">
        {start ? (
          <button type="button" className="lab-btn lab-play" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="lab-btn lab-play" onClick={() => setStart(s)}>
            Start watching
          </button>
        )}
        <span className="fine" aria-live="polite">
          {start ? `Watching for ${w?.seconds ?? 0} s. Open the app now.` : runs.length ? 'Stopped. Start again to compare a warm launch.' : 'Not watching yet.'}
        </span>
      </div>
      {w && show(w)}
      {runs.map((r, n) => (
        <div key={runs.length - n} className="al-past">
          <h4>
            Run {runs.length - n}, {r.seconds} s
          </h4>
          {show(r)}
        </div>
      ))}
    </section>
  )
}

export default function AppLaunch({ s, history, demo }: LabProps) {
  const simple = useSimple()
  const [appId, setAppId] = useState<AppId>('notes')
  const [mode, setMode] = useState<Mode>('cold')
  const [picked, setPicked] = useState(false)
  const app = APPS.find((a) => a.id === appId)!
  const pg = s.paging ?? null
  const pageBytes = pg?.pageBytes ?? null
  const live = pg?.pageins == null ? '' : ` Right now this Mac is paging in ${num(pg.pageins)} pages a second.`
  const name = app.name
  const first = mode === 'first'
  const warm = mode === 'warm'
  const steps: Step[] = [
    {
      title: simple ? 'A click in the Dock' : 'The Dock asks LaunchServices',
      dur: 3.6,
      tech: (
        <p>
          The Dock doesn't start {name} itself. It asks LaunchServices, the part of macOS that knows where every app lives and which app opens which file. An app is a folder with a <code>.app</code> name, and the <code>Info.plist</code> inside it names the executable to run.
        </p>
      ),
      plain: <p>You click {name}. The Dock passes the request on to the part of macOS that keeps track of every app. An app is really a folder, and a label inside it says which file to start.</p>,
    },
    {
      title: simple ? 'A new process' : 'launchd spawns the process',
      dur: 3.4,
      tech: (
        <p>
          launchd is the first process macOS starts at boot, PID 1, and it starts the apps you open. It creates the new process with <code>posix_spawn()</code>, which makes a process and loads a program into it in one call. On this Mac, <code>nm -u /sbin/launchd</code> lists <code>posix_spawn</code> among its imports, and <code>ps</code> shows parent PID 1 for running apps.
        </p>
      ),
      plain: <p>macOS has one starter program that runs first when the Mac boots, and it starts every app you open. It creates a new, empty process for {name}: a numbered slot with its own private memory, ready for code.</p>,
    },
    {
      title: simple ? 'Setting up memory' : 'The kernel maps the executable',
      dur: 4.2,
      tech: (
        <p>
          The kernel reads the Mach-O header of {name}'s executable and maps each segment into the new address space: <code>__TEXT</code> for code, <code>__DATA</code> for variables, and so on. Mapping only records where each part lives in the file. Nothing is read from the SSD yet. Then it maps dyld, the dynamic linker, and starts the process running inside it.
        </p>
      ),
      plain: <p>macOS builds {name}'s private memory map. It notes which part of the app file belongs where, but it doesn't copy anything off the SSD yet. That happens later, a piece at a time, only when the app needs it.</p>,
    },
    {
      title: simple ? 'Checking the seal' : 'Code signature and Gatekeeper',
      dur: first ? 5.4 : 3.6,
      tech: first ? (
        <p>
          Every app carries a code signature: SHA-256 hashes, one per page of code, signed with the developer's certificate. The kernel checks each page against its hash as it comes into memory, and a page that doesn't match never runs. This is the first launch of a downloaded app, so Gatekeeper also checks for a Developer ID signature and Apple's notarization, which means Apple scanned a copy and found no known malware, and asks you to approve.
        </p>
      ) : (
        <p>
          Every app carries a code signature: SHA-256 hashes, one per page of code, signed by the developer. The kernel checks each page against its hash as it comes into memory, so a changed page never runs. On this Mac, <code>codesign -dvvv</code> shows Notes with 429 page hashes. Gatekeeper's extra checks and its approval prompt only come on the first launch of downloaded software.
        </p>
      ),
      plain: first ? (
        <p>Every app comes with a seal: a fingerprint for each piece of its code. macOS checks each piece against its fingerprint, so a tampered app can't run. This app was just downloaded, so macOS also checks who made it and that Apple scanned it for known malware, and asks you once if you're sure.</p>
      ) : (
        <p>Every app comes with a seal: a fingerprint for each piece of its code. macOS checks each piece against its fingerprint as it's used, so a tampered app can't run. You've opened {name} before, so there's no "are you sure" question this time.</p>
      ),
    },
    {
      title: simple ? 'Connecting the building blocks' : 'dyld loads libraries',
      dur: 4.4,
      tech: (
        <p>
          dyld reads the libraries {name} needs. The matching Apple app lists {app.libs} directly, per <code>otool -L</code>
          {app.id === 'browser' ? ", because Safari's own executable is a small stub and the browser lives in a framework" : ''}. Nearly all system libraries come from the dyld shared cache, one prelinked file of system libraries mapped into every process: 2.3 GB across 82 files on this Mac. Then come fixups: rebases add the ASLR slide to internal pointers, and binds look up symbols like <code>malloc</code> by name.
          {warm ? ' On a warm launch dyld can reuse work it saved from an earlier launch instead of parsing everything again.' : ''}
        </p>
      ),
      plain: (
        <p>
          Apps are built from ready-made parts that macOS provides, for windows, text, pictures and more. {name} uses about {app.libs} of them directly. Most sit in one big shared bundle that every app already has in its memory map. The linker then fills in addresses so the app's code can find each part.
          {warm ? ' It remembers its work from last time, so this goes quicker.' : ''}
        </p>
      ),
    },
    {
      title: simple ? "The app's code starts" : 'main() runs',
      dur: 3.8,
      tech: (
        <p>
          dyld runs each library's initializers, then jumps to {name}'s <code>main()</code>. A Mac app calls <code>NSApplicationMain()</code>, which sets up AppKit, loads the main menu and first window from the app's resources, and enters the run loop, where it waits for events from the window server.
        </p>
      ),
      plain: <p>Now {name}'s own code runs for the first time. It sets up its menu and its first window, then waits for your clicks and key presses.</p>,
    },
    {
      title: simple ? 'Fetching code as it runs' : 'Page faults bring code in',
      dur: 5,
      tech: warm ? (
        <p>
          Every first touch of a code page is a page fault. On a warm launch most of {name}'s pages are still in the page cache from last time, so the kernel maps them and no disk read happens. That is most of the difference between a warm launch and a cold one.{live} <a href="#labs/virtual-memory">The virtual memory lab</a> shows a single fault step by step.
        </p>
      ) : (
        <p>
          As main() and AppKit run, every first touch of a code page faults. The kernel reads that page in from the SSD and checks its hash. A cold launch, the first since boot or after a long time, pays for each of these reads, and they show up live above as page-ins.{live} <a href="#labs/virtual-memory">The virtual memory lab</a> shows a single fault step by step.
        </p>
      ),
      plain: warm ? (
        <p>
          Each time {name} reaches a piece of its code for the first time, macOS has to fetch it. You opened it recently, so those pieces are still in Desk Space and nothing comes off the SSD. That's why a second launch feels faster. <a href="#labs/virtual-memory">The memory lab</a> shows one of these moments up close.
        </p>
      ) : (
        <p>
          Each time {name} reaches a piece of its code for the first time, macOS pauses it, copies that piece off the SSD into Desk Space, and lets it carry on. On the first launch since a restart this happens a lot. <a href="#labs/virtual-memory">The memory lab</a> shows one of these moments up close.
        </p>
      ),
    },
    {
      title: simple ? 'The window appears' : 'WindowServer and the first frame',
      dur: 4.6,
      tech: (
        <p>
          AppKit connects to WindowServer, the process that owns the screen and routes every click and key press to the right app. {name} renders its own window. WindowServer composites every window on screen into one frame with the GPU, and the display shows it. The first frame is where a launch ends: Apple's 2019 launch talk set a goal of a first frame within 400 ms for iPhone apps.
        </p>
      ),
      plain: <p>{name} draws its window, but only its own window. A separate part of macOS, the window manager, stacks it with every other window and the desktop into one picture, and the graphics chip paints that onto the screen. The moment the window appears, the launch is done.</p>,
    },
  ]
  const story = useSteps(steps)
  const opened = picked || story.i > 0 || story.auto
  const split = story.i === 0 && picked ? phase(story.t, 0, 0.8) : 1
  const pick = (id: AppId) => {
    setAppId(id)
    setPicked(true)
    story.go(0)
  }
  const top = s.topMem[0]
  const busy = s.topCpu[0]
  const pageins = history.map((x) => x.paging?.pageins ?? null)

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          simple
            ? 'Try it: open a big app you have not used since the Mac restarted, and watch "Fetched from SSD" jump and the app climb the Desk Space list.'
            : "Try it: open a big app you haven't opened since boot, and watch page-ins spike and the new process climb to the top of the memory list."
        }
      >
        <LiveStat label={simple ? 'SSD reads' : 'Disk reads'} value={rate(s.disk.readBps)} sub={<Sparkline values={history.map((x) => x.disk.readBps)} w={90} h={18} label="Disk reads over the last minutes" />} />
        <LiveStat
          label={simple ? 'Fetched from SSD' : 'Page-ins'}
          value={pg?.pageins == null ? 'n/a' : `${num(pg.pageins)}/s`}
          sub={pg?.pageins != null && pageBytes != null ? <>{bytes(pg.pageins * pageBytes)}/s <Sparkline values={pageins} w={60} h={18} label="Page-ins over the last minutes" /></> : undefined}
          hot={(pg?.pageins ?? 0) > 2000}
        />
        <LiveStat label={simple ? 'Busiest app' : 'Top CPU'} value={busy ? busy.name : 'n/a'} sub={busy ? `${num(busy.cpu)}% of one core` : undefined} />
        <LiveStat label={simple ? 'Most Desk Space' : 'Top memory'} value={top ? top.name : 'n/a'} sub={top ? memGB(top.bytes) : undefined} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="al-controls">
          <span className="fine">{simple ? 'What kind of launch?' : 'Launch type'}</span>
          <div className="lab-seg" role="group" aria-label="Launch type">
            {(
              [
                ['first', simple ? 'Just downloaded' : 'First launch'],
                ['cold', simple ? 'First since restart' : 'Cold'],
                ['warm', simple ? 'Opened recently' : 'Warm'],
              ] as [Mode, string][]
            ).map(([m, l]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-stage">
          <div className="al-wrap">
            <Scene i={story.i} t={story.t} app={app} mode={mode} opened={opened} split={split} />
            {APPS.map((a, n) => {
              const p = ICON(n)
              return (
                <button
                  key={a.id}
                  type="button"
                  className="al-hit-btn"
                  style={{ left: `${(p.x / 960) * 100}%`, top: `${(p.y / 600) * 100}%`, width: `${(p.s / 960) * 100}%`, height: `${(p.s / 600) * 100}%` }}
                  aria-label={`Open ${a.name}`}
                  aria-pressed={opened && a.id === appId}
                  title={a.name}
                  onClick={() => pick(a.id)}
                />
              )
            })}
          </div>
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <Watcher s={s} history={history} demo={demo} />

      <Deeper title={simple ? 'Why the second launch is faster' : 'Cold, warm and first launches'}>
        {simple ? (
          <>
            <p>The first time you open an app after a restart, most of its code is still on the SSD, so macOS copies each piece into Desk Space the first time it's needed. Quit and reopen it soon after, and those pieces are usually still in Desk Space, so the second launch skips most of the trips to the SSD.</p>
            <p>The very first time you open something you downloaded, macOS also checks who made it and that Apple scanned it, and asks you once. After that it doesn't ask again.</p>
            <p>If an app is slow to open every time, the extra work is usually inside the app itself, after its code starts.</p>
          </>
        ) : (
          <>
            <p>Apple's 2019 talk on app launch splits launches three ways. A cold launch, after a reboot or when the app hasn't run for a long time, has to bring the app from disk into memory and start system services it relies on. A warm launch still spawns a new process, but the app and those services are already in memory. A resume isn't a launch at all: the process never stopped.</p>
            <p>The first launch of downloaded software adds Gatekeeper on top of a cold launch: the Developer ID signature, the notarization ticket and your approval. Later launches skip that, but the kernel still validates each code page against the signature's hashes as it faults in.</p>
            <ul>
              <li>
                See the libraries an app links: <code>otool -L /System/Applications/Notes.app/Contents/MacOS/Notes</code>.
              </li>
              <li>
                See its signature: <code>codesign -dvvv /System/Applications/Notes.app</code>.
              </li>
              <li>
                Ask Gatekeeper for its verdict: <code>spctl --assess -vv /Applications/Safari.app</code>. Here it printed "accepted" with source "Apple System", and for Chrome, "Notarized Developer ID".
              </li>
              <li>
                See the shared cache: <code>ls -lh /System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/</code>.
              </li>
            </ul>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'Apple, WWDC 2017: App Startup Time: Past, Present, and Future (archived)', url: 'https://web.archive.org/web/20201112020327/https://developer.apple.com/videos/play/wwdc2017/413/', note: 'dyld 3, launch closures, and the shared cache as "a single file containing most of the system dylibs". Apple has taken the page down; this is the Internet Archive copy.' },
          { title: 'Apple, WWDC 2022: Link fast: Improve build and launch times', url: 'https://developer.apple.com/videos/play/wwdc2022/110362/', note: 'How dyld maps segments, rebases and binds, chained fixups, and page-in linking.' },
          { title: 'Apple, WWDC 2019: Optimizing App Launch', url: 'https://developer.apple.com/videos/play/wwdc2019/423/', note: 'Cold, warm and resume launches, and the 400 ms first frame goal.' },
          { title: 'Apple open source: dyld', url: 'https://github.com/apple-oss-distributions/dyld', note: 'The dynamic linker itself.' },
          { title: 'Apple open source: XNU kern_exec.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c', note: 'Where the kernel implements posix_spawn and loads a Mach-O executable.' },
          { title: 'Apple open source: XNU vm_fault.c', url: 'https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_fault.c', note: 'The page fault handler, including the check that validates code-signed pages as they come in.' },
          { title: 'Apple Platform Security: App code signing process in macOS', url: 'https://support.apple.com/guide/security/sec3ad8e6e53', note: 'Developer ID signing and notarization, and what each proves.' },
          { title: 'Apple Platform Security: Gatekeeper and runtime protection', url: 'https://support.apple.com/guide/security/sec5599b66df', note: 'Gatekeeper checks downloaded software on first open and asks for approval.' },
          { title: 'Apple, Notarizing macOS software before distribution', url: 'https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution', note: 'Notarization from the developer side.' },
          { title: 'Apple, Code Signing Guide', url: 'https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Introduction/Introduction.html', note: 'What a code signature contains and how macOS evaluates it.' },
          { title: 'Apple, Launch Services', url: 'https://developer.apple.com/documentation/coreservices/launch_services', note: 'The API that finds and opens apps and documents.' },
          { title: 'launchd(8) man page', url: 'https://keith.github.io/xcode-man-pages/launchd.8.html', note: 'launchd runs as the first process and starts the rest of the system. Also `man launchd` in Terminal.' },
          { title: 'posix_spawn(2) man page', url: 'https://keith.github.io/xcode-man-pages/posix_spawn.2.html', note: 'Creating a process and running a program in one call.' },
          { title: 'Apple, Cocoa Event Handling Guide: Event Architecture', url: 'https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/EventArchitecture/EventArchitecture.html', note: 'The window server receives events and dispatches each one to the right app.' },
          { title: 'Apple, Mac Technology Overview: Media Layer', url: 'https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/OSX_Technology_Overview/MediaLayer/MediaLayer.html', note: 'Quartz implements the windowing system and its compositing.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac, an M5 MacBook Air on macOS 27: <code>otool -L</code> lists 105 libraries for Notes, 136 for Photos, 154 for Music, 38 for Terminal and 2 for Safari. <code>codesign -dvvv</code> shows 429 page hashes for Notes. <code>nm -u /sbin/launchd</code> includes <code>posix_spawn</code>. The shared cache files total 2.3 GB. The desktop and icons are drawn for this lab and are not Apple's.
      </p>
    </div>
  )
}
