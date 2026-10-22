import { useState } from 'react'
import { bytes, num, rate } from '../format.ts'
import { useSimple } from '../simple.ts'
import { Sparkline } from '../ui.tsx'
import { Deeper, LiveStat, LiveStrip, Sources, StepBar, along, phase, useSteps, type LabProps, type Step } from './kit.tsx'
import { HDR, MTU, TLS_OVERHEAD, TLS_RECORD, expectedTries, lossCeiling, packetsPerSecond, plan, seeded, send } from './packets.ts'
import './Packets.css'

// The page's journey drawn as one network: this Mac, the Wi-Fi router, the internet, a DNS resolver and the web
// server. Each step is a list of messages ("shots") that travel the paths; the panel at the bottom keeps a record
// of what has arrived, so the end frame of every step reads on its own. Coordinates are in a 960 x 450 viewBox.

type Pt = [number, number]
const MAC: Pt = [168, 190]
const ROUTER: Pt = [330, 190]
const NET: Pt = [560, 190]
const SERVER: Pt = [790, 190]
const RESOLVER: Pt = [560, 92]
const UP: Pt[] = [MAC, ROUTER, NET, SERVER]
const DOWN: Pt[] = [SERVER, NET, ROUTER, MAC]
const TO_DNS: Pt[] = [MAC, ROUTER, RESOLVER]
const FROM_DNS: Pt[] = [RESOLVER, ROUTER, MAC]

type Kind = 'dns' | 'tcp' | 'tls' | 'data' | 'ack' | 'rtx'
type Shot = { path: Pt[]; a: number; b: number; label: string; kind: Kind; lost?: boolean; log?: string }

const TRAVEL = 1.2
const GAP = 0.35
const sent = (k: number) => 0.3 + (k - 1) * GAP
const arrives = (k: number) => sent(k) + TRAVEL
/** When the server, having seen the third duplicate ACK, resends packet 4. */
const RTX_AT = arrives(8) + TRAVEL

/** Steps 6 and 7: eight packets of the page down to this Mac, and the ACKs back. */
function stream(lose: boolean): Shot[] {
  const out: Shot[] = []
  for (let k = 1; k <= 8; k++) {
    const lost = lose && k === 4
    out.push({ path: lost ? [SERVER, NET] : DOWN, a: sent(k), b: lost ? sent(k) + TRAVEL / 2 : arrives(k), label: `${k}`, kind: 'data', lost })
  }
  if (!lose) {
    for (const k of [2, 4, 6, 8]) out.push({ path: UP, a: arrives(k), b: arrives(k) + TRAVEL, label: `ACK ${k + 1}`, kind: 'ack' })
    return out
  }
  out.push({ path: UP, a: arrives(2), b: arrives(2) + TRAVEL, label: 'ACK 3', kind: 'ack' })
  // Packet 5 arrives out of order, so the Mac ACKs at once, and again for 6, 7 and 8: three duplicates.
  for (const k of [5, 6, 7, 8]) out.push({ path: UP, a: arrives(k), b: arrives(k) + TRAVEL, label: 'ACK 4', kind: 'ack' })
  out.push({ path: DOWN, a: RTX_AT, b: RTX_AT + TRAVEL, label: '4', kind: 'rtx' })
  out.push({ path: UP, a: RTX_AT + TRAVEL, b: RTX_AT + 2 * TRAVEL, label: 'ACK 9', kind: 'ack' })
  return out
}

function shots(i: number, simple: boolean): Shot[] {
  switch (i) {
    case 1:
      return [
        { path: TO_DNS, a: 0.3, b: 1.6, label: simple ? 'example.com?' : 'UDP :53  A? example.com', kind: 'dns', log: simple ? 'Mac asks: what is the number for example.com?' : 'query: A record for example.com, UDP to port 53' },
        { path: FROM_DNS, a: 2.1, b: 3.4, label: '203.0.113.10', kind: 'dns', log: simple ? 'Answer: 203.0.113.10' : 'answer: example.com A 203.0.113.10, with a time to live' },
      ]
    case 2:
      return [
        { path: UP, a: 0.3, b: 1.7, label: 'SYN', kind: 'tcp', log: simple ? 'Mac: can we talk? I will number my bytes from x.' : 'SYN, seq = x: open, my numbering starts at x' },
        { path: DOWN, a: 1.9, b: 3.3, label: 'SYN-ACK', kind: 'tcp', log: simple ? 'Server: yes, and I will number mine from y.' : 'SYN-ACK, seq = y, ack = x + 1' },
        { path: UP, a: 3.5, b: 4.9, label: 'ACK', kind: 'tcp', log: simple ? 'Mac: got it. We are connected.' : 'ACK, ack = y + 1: connection open after one round trip' },
      ]
    case 3:
      return [
        { path: UP, a: 0.3, b: 1.7, label: 'ClientHello', kind: 'tls', log: simple ? 'Mac: here is half of a secret, and the codes I know.' : 'ClientHello: cipher suites and a key_share' },
        { path: DOWN, a: 1.9, b: 3.3, label: 'ServerHello + cert', kind: 'tls', log: simple ? 'Server: here is my half, my ID card and my signature, already scrambled.' : 'ServerHello and key_share, then encrypted Certificate, CertificateVerify, Finished' },
        { path: UP, a: 3.5, b: 4.9, label: 'Finished', kind: 'tls', log: simple ? 'Mac checks the ID card. From now on everything is scrambled.' : 'client Finished: both sides hold the same keys after one round trip' },
      ]
    case 4:
      return [{ path: UP, a: 3, b: 4.6, label: 'GET /', kind: 'data' }]
    case 5:
      return stream(false)
    case 6:
      return stream(true)
    default:
      return []
  }
}

function Token({ s, t }: { s: Shot; t: number }) {
  if (t < s.a) return null
  if (t > s.b + (s.lost ? 0.9 : 0.25)) return null
  const k = phase(t, s.a, s.b)
  const [x, y] = along(s.path, k)
  const w = Math.max(30, s.label.length * 7.6 + 18)
  const dead = s.lost && k >= 1
  return (
    <g className={`pk-token ${s.kind} ${dead ? 'lost' : ''}`} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-12} width={w} height={24} rx={12} />
      <text y={4} textAnchor="middle">
        {s.label}
      </text>
      {dead && <path className="pk-x" d="M -14 -40 L 14 -16 M 14 -40 L -14 -16" />}
    </g>
  )
}

function Node({ at, w, h, title, sub, cls = '' }: { at: Pt; w: number; h: number; title: string; sub?: string; cls?: string }) {
  return (
    <g className={`pk-node ${cls}`}>
      <rect x={at[0] - w / 2} y={at[1] - h / 2} width={w} height={h} rx={12} />
      <text className="pk-node-t" x={at[0]} y={at[1] + (sub ? -2 : 5)} textAnchor="middle">
        {title}
      </text>
      {sub && (
        <text className="pk-node-s" x={at[0]} y={at[1] + 16} textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  )
}

/** Step 5's picture: the request, wrapped by each layer in turn, innermost first. */
function Layers({ t, simple }: { t: number; simple: boolean }) {
  const rows = [
    { name: simple ? 'Envelope for the next stop' : 'Link: Wi-Fi or Ethernet frame', bytes: simple ? 'Wi-Fi box address' : `Ethernet ${HDR.eth} B; Wi-Fi differs` },
    { name: simple ? 'Internet address label' : 'IPv4 packet', bytes: `${HDR.ipv4} B: ${simple ? 'from and to numbers' : 'source, destination, TTL'}` },
    { name: simple ? 'Numbered parcel' : 'TCP segment', bytes: `${HDR.tcp} B: ${simple ? 'door 443, parcel number' : 'ports, seq, ack'}` },
    { name: simple ? 'Locked box' : 'TLS record', bytes: `${TLS_OVERHEAD} B: ${simple ? 'label and seal' : 'header, type, AEAD tag'}` },
    { name: simple ? 'The request' : 'HTTP request', bytes: 'GET /  Host: example.com' },
  ]
  return (
    <g>
      {rows.map((r, n) => {
        const order = rows.length - 1 - n
        const k = order === 0 ? 1 : phase(t, 0.2 + order * 0.6, 0.7 + order * 0.6)
        const x = 40 + n * 26
        const y = 264 + n * 28
        const w = 880 - n * 52
        return (
          <g key={r.name} className={`pk-layer l${n}`} opacity={k} transform={`translate(0 ${(1 - k) * 12})`}>
            <rect x={x} y={y} width={w} height={178 - n * 28} rx={10} />
            <text className="pk-layer-n" x={x + 12} y={y + 20}>
              {r.name}
            </text>
            <text className="pk-layer-b" x={x + w - 12} y={y + 20} textAnchor="end">
              {r.bytes}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Strip({ t, lose, simple }: { t: number; lose: boolean; simple: boolean }) {
  const got = (k: number) => (lose && k === 4 ? t >= RTX_AT + TRAVEL : t >= arrives(k))
  const dups = lose ? [6, 7, 8].filter((k) => t >= arrives(k) + TRAVEL).length : 0
  const done = [1, 2, 3, 4, 5, 6, 7, 8].every(got)
  return (
    <g>
      <text className="pk-sub" x={60} y={292}>
        {simple ? 'What your Mac has received' : 'Receive buffer on this Mac'}
      </text>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => {
        const late = lose && k === 4
        const cls = got(k) ? (late ? 'rtx' : 'have') : late && t >= arrives(4) ? 'gap' : ''
        return (
          <g key={k} className={`pk-slot ${cls}`}>
            <rect x={60 + (k - 1) * 64} y={304} width={56} height={40} rx={7} />
            <text x={88 + (k - 1) * 64} y={330} textAnchor="middle">
              {cls === 'gap' ? '?' : k}
            </text>
          </g>
        )
      })}
      <text className="pk-note" x={60} y={374}>
        {done
          ? simple
            ? 'All 8 pieces are here, in order. The page can be drawn.'
            : 'All 8 segments in order: the bytes go up to the browser.'
          : lose && t >= arrives(5)
            ? simple
              ? 'Piece 4 is missing. 5 to 8 wait, and each reply says "still need 4".'
              : 'Segment 4 is missing. 5 to 8 wait in the buffer; each arrival repeats ACK 4.'
            : simple
              ? 'Pieces arrive one after another.'
              : 'Segments arrive in order; the receiver ACKs every second one.'}
      </text>
      {lose && (
        <text className={`pk-note ${dups >= 3 ? 'hot' : ''}`} x={60} y={402}>
          {simple ? `Repeated "still need 4" replies: ${dups} of 3` : `Duplicate ACKs at the server: ${dups} of 3`}
          {t >= RTX_AT ? (simple ? '. The server sends 4 again.' : '. Fast retransmit: resend 4 without waiting for a timeout.') : ''}
        </text>
      )}
      {(
        [
          ['data', simple ? 'piece of the page' : 'data segment'],
          ['ack', simple ? 'reply: send n next' : 'ACK n: send n next'],
          ['rtx', simple ? 'sent again' : 'retransmission'],
        ] as [Kind, string][]
      ).map(([k, label], n) => (
        <g key={k} className={`pk-token ${k}`} transform={`translate(640 ${314 + n * 28})`}>
          <rect x={-10} y={-9} width={20} height={18} rx={9} />
          <text className="pk-key" x={20} y={4}>
            {label}
          </text>
        </g>
      ))}
    </g>
  )
}

function Radio({ t, simple, rx, tx }: { t: number; simple: boolean; rx: number | null; tx: number | null }) {
  return (
    <g>
      {[0, 1, 2, 3].map((n) => {
        const w = (t * 0.8 + n / 4) % 1
        return <path key={n} className="pk-wave" d={`M ${ROUTER[0] - 60 - w * 30} ${ROUTER[1] - 22} q -12 22 0 44`} opacity={1 - w} />
      })}
      <text className="pk-sub" x={60} y={292}>
        {simple ? 'The last few metres are radio' : 'The last hop: 802.11 radio'}
      </text>
      {(simple
        ? [
            'The Wi-Fi box sends each piece as a short burst of radio on 2.4, 5 or 6 GHz.',
            'A clean signal packs more bits into each burst. In the next room each burst carries fewer.',
            "The radio's speed to the box is not your internet speed. That is usually much lower.",
          ]
        : [
            'Each frame goes out as a burst on a 2.4, 5 or 6 GHz channel; wider channels carry more.',
            'Signal-to-noise ratio sets the MCS, the bits per burst. Apple lists 2400 Mbps for the M5 Air.',
            'Link rate is radio to router, not internet: lesson 13 measured a 1200 Mbps link, 25 Mbps down.',
          ]
      ).map((line, n) => (
        <text key={n} className="pk-note" x={60} y={322 + n * 26}>
          {line}
        </text>
      ))}
      <text className="pk-note live" x={60} y={408}>
        {rx == null ? (simple ? 'No live reading right now.' : 'No live network reading.') : `${simple ? 'Right now' : 'Live'}: ${rate(rx)} in, ${rate(tx)} out`}
      </text>
    </g>
  )
}

function Address({ t, simple }: { t: number; simple: boolean }) {
  const url = 'https://example.com/'
  const typed = url.slice(0, Math.ceil(phase(t, 0.2, 1.8) * url.length))
  const parts = phase(t, 2, 2.6)
  const pieces: [string, string, number, number][] = [
    ['https', simple ? 'lock it, use door 443' : 'TLS over TCP, port 443', 84, 388],
    ['example.com', simple ? 'a name: find its number' : 'hostname: needs a DNS lookup', 150, 362],
    ['/', simple ? 'which page' : 'path', 262, 336],
  ]
  return (
    <g>
      <rect className="pk-bar" x={60} y={262} width={360} height={40} rx={20} />
      <text className="pk-url" x={84} y={288}>
        {typed}
        {typed.length < url.length ? '|' : ''}
      </text>
      <g opacity={parts}>
        {pieces.map(([k, v, x, y]) => (
          <g key={k}>
            <line className="pk-tick" x1={x + 10} y1={304} x2={x + 10} y2={y - 4} />
            <text className="pk-note" x={x + 18} y={y}>
              <tspan className="pk-mono">{k}</tspan> {v}
            </text>
          </g>
        ))}
      </g>
      <text className="pk-note" x={560} y={288} opacity={parts}>
        {simple ? 'Four things happen next:' : 'Before one byte of the page moves:'}
      </text>
      {(simple ? ['look up the number', 'say hello', 'agree on a secret code', 'ask for the page'] : ['DNS: name to address', 'TCP: open a connection', 'TLS: agree on keys', 'HTTP: request the page']).map((s, n) => (
        <text key={s} className="pk-note" x={576} y={316 + n * 26} opacity={phase(t, 2.6 + n * 0.3, 3 + n * 0.3)}>
          {n + 1}. {s}
        </text>
      ))}
    </g>
  )
}

function Scene({ i, t, simple, rx, tx }: { i: number; t: number; simple: boolean; rx: number | null; tx: number | null }) {
  const list = shots(i, simple)
  const logs = list.filter((s) => s.log)
  const locked = i > 3 || (i === 3 && t > 4.9)
  const connected = i > 2 || (i === 2 && t > 4.9)
  return (
    <svg className="pk-scene" viewBox="0 0 960 450" role="img" aria-label="A web page request travelling from this Mac through the router and the internet to a server and back">
      <path className={`pk-link ${connected ? 'open' : ''}`} d={`M ${MAC[0]} ${MAC[1]} L ${SERVER[0]} ${SERVER[1]}`} />
      <path className="pk-link dns" d={`M ${ROUTER[0]} ${ROUTER[1]} L ${RESOLVER[0]} ${RESOLVER[1]}`} />
      {locked && (
        <g className="pk-lock" transform={`translate(${NET[0] + 104} ${MAC[1] + 52})`}>
          <rect x={-9} y={-2} width={18} height={14} rx={3} />
          <path d="M -5 -2 v -5 a 5 5 0 0 1 10 0 v 5" />
          <text x={16} y={10}>
            {simple ? 'scrambled' : 'encrypted'}
          </text>
        </g>
      )}
      <Node at={MAC} w={130} h={76} title={simple ? 'Your Mac' : 'This Mac'} sub={simple ? 'web browser' : 'browser, TCP/IP'} cls="mac" />
      <Node at={ROUTER} w={110} h={64} title={simple ? 'Wi-Fi box' : 'Wi-Fi router'} sub={simple ? 'at home' : 'first hop'} />
      <g className="pk-cloud">
        <ellipse cx={NET[0]} cy={NET[1]} rx={96} ry={40} />
        <text className="pk-node-t" x={NET[0]} y={NET[1] - 2} textAnchor="middle">
          {simple ? 'The internet' : 'Internet'}
        </text>
        <text className="pk-node-s" x={NET[0]} y={NET[1] + 16} textAnchor="middle">
          {simple ? 'many routers' : 'router hops'}
        </text>
      </g>
      <Node at={RESOLVER} w={150} h={42} title={simple ? 'Phone book' : 'DNS resolver'} cls={i === 1 ? 'hot' : ''} />
      <Node at={SERVER} w={130} h={76} title={simple ? 'Web server' : 'Server'} sub="203.0.113.10" />

      {i === 0 && <Address t={t} simple={simple} />}
      {i === 4 && <Layers t={t} simple={simple} />}
      {(i === 5 || i === 6) && <Strip t={t} lose={i === 6} simple={simple} />}
      {i === 7 && <Radio t={t} simple={simple} rx={rx} tx={tx} />}
      {logs.length > 0 && (
        <g>
          <text className="pk-sub" x={60} y={292}>
            {simple ? 'What has been said so far' : 'Messages delivered'}
          </text>
          {logs.map((s, n) => (
            <text key={n} className={`pk-log ${s.kind}`} x={60} y={324 + n * 30} opacity={t >= s.b ? 1 : 0.3}>
              <tspan className="pk-arrow">{s.path[0] === MAC ? '→' : '←'}</tspan> {t >= s.b ? s.log : '...'}
            </text>
          ))}
          {i === 2 && (
            <text className="pk-note" x={60} y={420} opacity={phase(t, 5, 5.4)}>
              {simple ? 'Newer sites can use HTTP/3, which says hello and agrees on the code in the same trip.' : 'HTTP/3 runs over QUIC on UDP instead, which merges this handshake with the TLS one.'}
            </text>
          )}
        </g>
      )}
      {list.map((s, n) => (
        <Token key={n} s={s} t={t} />
      ))}
    </svg>
  )
}

const sizeAt = (v: number) => Math.round(10 ** (2 + (5 * v) / 100))

function PacketBuilder() {
  const simple = useSimple()
  const [v, setV] = useState(40)
  const [ip, setIp] = useState<4 | 6>(4)
  const [loss, setLoss] = useState(1)
  const [rtt, setRtt] = useState(30)
  const size = sizeAt(v)
  const p = plan(size, ip)
  const hdr = MTU - p.mss
  const drawn = Math.min(p.packets, 36)
  const pl = loss / 100
  const sim = send(p.packets, pl, seeded(p.packets * 7919 + loss * 131))
  const ceiling = lossCeiling(pl, rtt, p.mss)
  const dotRand = seeded(loss * 97 + 1)
  const dots = Array.from({ length: Math.min(p.packets, 120) }, () => {
    let tries = 1
    while (dotRand() < pl && tries < 6) tries++
    return tries
  })
  const n = (x: number) => x.toLocaleString('en-US')
  return (
    <section className="card lab-try">
      <h3>{simple ? 'Try it: cut a message into packets' : 'Try it: packet builder'}</h3>
      <p className="fine">
        {simple
          ? 'Pick how big a message is. It is locked, cut into pieces that fit the 1,500-byte limit, and every piece gets its own labels.'
          : `The message goes into TLS records of up to ${n(TLS_RECORD)} bytes, then into TCP segments of at most MSS = MTU ${MTU} minus the IP and TCP headers. Headers are the minimum sizes, with no TCP options.`}
      </p>
      <div className="lab-try-row">
        <label className="lab-field pk-range">
          <span>
            {simple ? 'Message size' : 'Message'}: <b className="num">{bytes(size)}</b>
          </span>
          <input type="range" min={0} max={100} value={v} onChange={(e) => setV(+e.currentTarget.value)} aria-valuetext={bytes(size)} />
        </label>
        <div className="lab-seg" role="group" aria-label="IP version">
          {([4, 6] as const).map((x) => (
            <button key={x} type="button" aria-pressed={ip === x} onClick={() => setIp(x)}>
              IPv{x}
            </button>
          ))}
        </div>
      </div>
      <div className="pk-stats">
        <span>
          <b className="num">{n(p.packets)}</b> {simple ? 'packets' : 'segments'}
        </span>
        <span>
          <b className="num">{n(p.records)}</b> {simple ? 'locked boxes' : 'TLS records'}
        </span>
        <span>
          <b className="num">{p.mss}</b> {simple ? 'bytes of message per packet, at most' : 'byte MSS'}
        </span>
        <span>
          <b className="num">{bytes(p.headerBytes + p.tlsBytes)}</b> {simple ? 'of labels' : 'overhead'}
        </span>
        <span>
          <b className="num">{(p.efficiency * 100).toFixed(1)}%</b> {simple ? 'of what is sent is your message' : 'of wire bytes are payload'}
        </span>
      </div>
      <div className="pk-packets" aria-hidden>
        {Array.from({ length: drawn }, (_, k) => {
          const pay = k === p.packets - 1 ? p.last : p.mss
          return (
            <span key={k} className="pk-pkt" style={{ width: `${((hdr + HDR.eth + pay) / (MTU + HDR.eth)) * 100}%` }}>
              <span className="pk-h" style={{ flexBasis: `${((hdr + HDR.eth) / (hdr + HDR.eth + pay)) * 100}%` }} />
              <span className="pk-p" />
            </span>
          )
        })}
        {p.packets > drawn && <span className="pk-more">+{n(p.packets - drawn)} more</span>}
      </div>
      <p className="fine pk-key-row">
        <span className="pk-h-key">{simple ? 'labels' : `headers, ${hdr + HDR.eth} B per frame on Ethernet`}</span>
        <span className="pk-p-key">{simple ? 'your message' : 'payload, including TLS bytes'}</span>
      </p>

      <h4 className="pk-h4">{simple ? 'Now lose some on the way' : 'Packet loss'}</h4>
      <div className="lab-try-row">
        <label className="lab-field pk-range">
          <span>
            {simple ? 'Lost on the way' : 'Loss rate'}: <b className="num">{loss}%</b>
          </span>
          <input type="range" min={0} max={20} step={0.5} value={loss} onChange={(e) => setLoss(+e.currentTarget.value)} aria-valuetext={`${loss}%`} />
        </label>
        <div className="lab-seg" role="group" aria-label="Round-trip time">
          {[10, 30, 100].map((x) => (
            <button key={x} type="button" aria-pressed={rtt === x} onClick={() => setRtt(x)}>
              {x} ms
            </button>
          ))}
        </div>
      </div>
      <div className="pk-dots" aria-hidden>
        {dots.map((d, k) => (
          <span key={k} className={`pk-dot ${d > 1 ? 'again' : ''}`} />
        ))}
        {p.packets > dots.length && <span className="pk-more">first {dots.length} shown</span>}
      </div>
      <p className={`lab-verdict ${loss ? '' : 'ok'}`} aria-live="polite">
        {p.packets === 0
          ? 'Nothing to send.'
          : simple
            ? `${n(sim.lost)} pieces got lost and were sent again: ${n(sim.tries)} sends for ${n(p.packets)} pieces.${ceiling == null ? ' With nothing lost, your connection sets the speed.' : ` Each loss also makes the Mac slow down: with a ${rtt} ms round trip, standard TCP tops out near ${num(ceiling / 1e6, 1)} Mbit/s.`}`
            : `${n(sim.lost)} retransmissions, ${n(sim.tries)} sends for ${n(p.packets)} segments (expected ${(expectedTries(pl) * p.packets).toFixed(0)}). ${ceiling == null ? 'No loss: the link and the receive window set the limit.' : `Loss also shrinks the congestion window: at ${rtt} ms RTT, standard TCP averages 1.2/sqrt(p) segments per round trip, a ceiling near ${num(ceiling / 1e6, 1)} Mbit/s.`}`}
      </p>
    </section>
  )
}

export default function Packets({ s, history, demo }: LabProps) {
  const simple = useSimple()
  const rx = Number.isFinite(s.net?.rxBps) ? s.net.rxBps : null
  const tx = Number.isFinite(s.net?.txBps) ? s.net.txBps : null
  const pps = packetsPerSecond(rx)
  const busy = (rx ?? 0) > 200_000
  const steps: Step[] = [
    {
      title: simple ? 'You type an address' : 'Parsing the URL',
      dur: 4,
      tech: (
        <p>
          The browser splits the URL. <code>https</code> means TLS over TCP to port 443. <code>example.com</code> is a name, and IP packets need a numeric address, so the first job is a DNS lookup. If the browser already has an open connection to this server, it skips straight to the request.
        </p>
      ),
      plain: (
        <p>
          You type an address and press Return. The browser reads it in parts: the lock part, the name of the site, and which page. Computers on the internet find each other by number, not by name, so first it has to look the number up.
        </p>
      ),
    },
    {
      title: simple ? 'Looking up the number' : 'DNS lookup',
      dur: 3.8,
      tech: (
        <p>
          The Mac sends one small UDP datagram to port 53 of its resolver, asking for the A record, or AAAA for IPv6, of <code>example.com</code>. The resolver answers from its cache or asks the root, <code>.com</code> and example.com name servers in turn. The answer carries a time to live, so the Mac can reuse it. The address shown is from the range reserved for documentation.
        </p>
      ),
      plain: (
        <p>
          Your Mac asks a phone book on the network, often your Wi-Fi box, "what is the number for example.com?" It's one tiny message and one tiny answer. The Mac remembers the answer for a while, so the next visit skips this step.
        </p>
      ),
    },
    {
      title: simple ? 'Saying hello' : 'TCP three-way handshake',
      dur: 5.6,
      tech: (
        <p>
          TCP opens a connection with three segments. The SYN carries the Mac's initial sequence number; the SYN-ACK carries the server's and acknowledges the Mac's; the final ACK confirms. Sequence numbers count bytes, so later both sides can spot gaps and duplicates. This costs one round trip before any data moves.
        </p>
      ),
      plain: (
        <p>
          Before sending the page, the two sides agree to talk. "Can we talk?" "Yes, can you hear me?" "Yes." Each side also says how it will number its pieces, so missing pieces can be spotted later. That takes one trip there and back.
        </p>
      ),
    },
    {
      title: simple ? 'Agreeing on a secret code' : 'TLS 1.3 handshake',
      dur: 5.4,
      tech: (
        <p>
          TLS 1.3 needs one round trip. The ClientHello already carries a key share. The server replies with its own, and everything after that, its certificate included, is encrypted. The Mac checks the certificate chain and signature, both sides derive the same keys, and from here on every byte is encrypted and authenticated.
        </p>
      ),
      plain: (
        <p>
          Now the Mac and the server agree on a secret code that nobody listening can work out. The server also shows an ID card proving it really is example.com. After this, everything is scrambled, so the Wi-Fi box and the internet in between only see noise.
        </p>
      ),
    },
    {
      title: simple ? 'Envelopes inside envelopes' : 'Each layer wraps the next',
      dur: 5,
      tech: (
        <p>
          The request <code>GET /</code> goes into a TLS record, sealed with an authentication tag. TCP adds ports and sequence numbers. IP adds source and destination addresses. The link layer adds a frame header for the next hop only; each router strips it and adds a new one. Only the server unwraps all the way back to the request.
        </p>
      ),
      plain: (
        <p>
          The request for the page is put in a locked box. The box goes in a numbered parcel. The parcel gets an address label. Then it goes in an envelope just for the trip to the next stop. Every stop on the way reads only the outside label and puts on a fresh envelope.
        </p>
      ),
    },
    {
      title: simple ? 'The page comes back in pieces' : 'Response in segments, and ACKs',
      dur: arrives(8) + TRAVEL + 0.3,
      tech: (
        <p>
          The response is far bigger than one packet, so TCP cuts it into segments that fit the 1500-byte MTU. The Mac acknowledges as they arrive, usually once for every second full segment. A real ACK names the next byte it expects; here the numbers count packets to keep it readable.
        </p>
      ),
      plain: (
        <p>
          The page is too big for one parcel, so the server cuts it into numbered pieces of up to 1,500 bytes. Your Mac sends short replies saying "got these, send the next ones", usually one reply for every two pieces.
        </p>
      ),
    },
    {
      title: simple ? 'A piece goes missing' : 'Loss and fast retransmit',
      dur: RTX_AT + 2 * TRAVEL + 0.3,
      tech: (
        <p>
          Segment 4 is dropped, by a full router queue or radio interference. Segments 5 to 8 still arrive, and each one makes the Mac send ACK 4 again. After three duplicate ACKs the server resends 4 at once, fast retransmit, rather than waiting for a timeout. It also cuts its congestion window, which is why loss hurts speed more than the resent bytes suggest.
        </p>
      ),
      plain: (
        <p>
          Piece 4 gets lost on the way. Pieces 5 to 8 still arrive, and each time your Mac says "I still need 4". After hearing that three times, the server sends 4 again. It also slows down for a while, in case the road is jammed.
        </p>
      ),
    },
    {
      title: simple ? 'The last few metres: radio' : 'The Wi-Fi hop',
      dur: 4,
      tech: (
        <p>
          Between the router and this Mac, each frame travels as a radio burst. The cleaner the signal over the noise, the higher the modulation and coding scheme and the more bits per burst. The link rate is the radio's raw rate to the router, before overhead and before your internet connection, which is usually the real limit.
        </p>
      ),
      plain: (
        <p>
          The last few metres from the Wi-Fi box to your Mac are radio waves. When the signal is clear, each burst carries more. Move to another room and the bursts carry less, so pages come in slower even though nothing is broken.
        </p>
      ),
    },
  ]
  const story = useSteps(steps)
  const rxHist = history.map((h) => (Number.isFinite(h.net?.rxBps) ? h.net.rxBps : null))

  return (
    <div className="lab-body">
      <LiveStrip
        demo={demo}
        note={
          rx == null
            ? 'No network reading from the reader right now.'
            : busy
              ? simple
                ? `That is roughly ${num(pps)} pieces a second arriving, if each is a full 1,500 bytes, and about half as many "got it" replies going back.`
                : `If the packets are full size, that's about ${num(pps)} packets a second in, and with one ACK per two segments about ${num((pps ?? 0) / 2)} ACKs a second out. Smaller packets would mean more.`
              : simple
                ? 'Start a download or a video and watch these numbers climb. Every 1,500 bytes is one piece.'
                : 'Link-layer byte counters for the busiest interface, once a second. Start a download to see the packet rate climb; a full packet carries at most 1500 bytes of IP.'
        }
      >
        <LiveStat label={simple ? 'Coming in' : 'Received'} value={rate(rx)} sub={<Sparkline values={rxHist} w={90} h={18} label="Download rate over the last minutes" />} hot={busy} />
        <LiveStat label={simple ? 'Going out' : 'Sent'} value={rate(tx)} sub={simple ? 'requests and replies' : 'requests, ACKs'} />
        <LiveStat label={simple ? 'Pieces a second' : 'Packets in, est.'} value={pps == null ? 'n/a' : `${num(pps)}/s`} sub={`${simple ? 'if each is' : 'at MTU'} ${MTU} B`} />
        <LiveStat label={simple ? 'Connection' : 'Interface'} value={s.net?.iface ?? 'n/a'} sub={s.net?.iface === 'en0' ? (simple ? 'Wi-Fi' : 'en0, Wi-Fi on a MacBook Air') : simple ? 'network port' : 'busiest physical interface'} />
      </LiveStrip>

      <section className="card lab-stage-card">
        <div className="lab-stage">
          <Scene i={story.i} t={story.t} simple={simple} rx={rx} tx={tx} />
        </div>
        <StepBar story={story} steps={steps} />
      </section>

      <PacketBuilder />

      <Deeper title={simple ? 'Why it is built this way' : 'Why the layers'}>
        {simple ? (
          <>
            <p>Each layer does one job and trusts the one below to do its own.</p>
            <ul>
              <li>The address label gets a parcel across the world, but parcels can still go missing.</li>
              <li>The numbering spots missing parcels and asks for them again.</li>
              <li>The locked box stops everyone in between from reading or changing what's inside.</li>
              <li>That is why a page still loads over bad Wi-Fi, just slower.</li>
            </ul>
          </>
        ) : (
          <>
            <p>IP delivers packets on a best-effort basis: it may drop, duplicate or reorder them. TCP builds a reliable, ordered byte stream on top with sequence numbers, ACKs and retransmission, and paces itself with congestion control. TLS adds secrecy and integrity end to end.</p>
            <ul>
              <li>HTTP/2 multiplexes many requests over one TCP connection, so one lost segment stalls them all until it is resent: head-of-line blocking.</li>
              <li>HTTP/3 runs over QUIC on UDP. QUIC numbers each stream separately and folds the TLS 1.3 handshake into its own, so a new connection costs one round trip instead of two.</li>
              <li>macOS uses CUBIC congestion control. It grows the window faster than the classic rule the Try it card uses, but loss still cuts throughput.</li>
            </ul>
            <p>
              Try it in Terminal: <code>dig example.com</code> shows a DNS answer and its TTL, <code>curl -sv https://example.com -o /dev/null</code> prints the TLS handshake, and <code>netstat -s -p tcp | grep retransmit</code> counts this Mac's retransmissions.
            </p>
          </>
        )}
      </Deeper>

      <Sources
        list={[
          { title: 'RFC 1035, Domain names: implementation and specification', url: 'https://www.rfc-editor.org/rfc/rfc1035', note: 'DNS messages, A records, TTLs and UDP port 53.' },
          { title: 'RFC 9293, Transmission Control Protocol', url: 'https://www.rfc-editor.org/rfc/rfc9293', note: 'The three-way handshake, sequence numbers, the 20-byte header, and an ACK at least every second full segment.' },
          { title: 'RFC 5681, TCP Congestion Control', url: 'https://www.rfc-editor.org/rfc/rfc5681', note: 'Duplicate ACKs, fast retransmit after three, and cutting the window.' },
          { title: 'RFC 8446, TLS 1.3', url: 'https://www.rfc-editor.org/rfc/rfc8446', note: 'The one round trip handshake, encrypted certificates and the record format.' },
          { title: 'RFC 5116, AEAD interface', url: 'https://www.rfc-editor.org/rfc/rfc5116.html', note: 'The 16-byte AES-GCM tag in every TLS record.' },
          { title: 'RFC 9110, HTTP Semantics', url: 'https://www.rfc-editor.org/rfc/rfc9110', note: 'Requests, GET, and the https scheme on port 443.' },
          { title: 'RFC 9000, QUIC', url: 'https://www.rfc-editor.org/rfc/rfc9000', note: 'Transport over UDP with streams and a built-in handshake.' },
          { title: 'RFC 9114, HTTP/3', url: 'https://www.rfc-editor.org/rfc/rfc9114', note: 'HTTP over QUIC.' },
          { title: 'RFC 791, Internet Protocol', url: 'https://www.rfc-editor.org/rfc/rfc791', note: 'The 20-byte IPv4 header and best-effort delivery.' },
          { title: 'RFC 8200, IPv6', url: 'https://www.rfc-editor.org/rfc/rfc8200', note: 'The 40-byte IPv6 header.' },
          { title: 'RFC 894, IP over Ethernet', url: 'https://www.rfc-editor.org/rfc/rfc894', note: 'The 1500-byte maximum and the Ethernet header.' },
          { title: 'RFC 3649, HighSpeed TCP', url: 'https://www.rfc-editor.org/rfc/rfc3649.html', note: 'Standard TCP averages 1.2/sqrt(p) segments per round trip at loss rate p.' },
          { title: 'RFC 9438, CUBIC', url: 'https://www.rfc-editor.org/rfc/rfc9438.html', note: 'The congestion control macOS uses, compared with Reno.' },
          { title: 'Grigorik, High Performance Browser Networking: Building blocks of TCP', url: 'https://hpbn.co/building-blocks-of-tcp/', note: 'Free book. Handshake cost, congestion control, loss and head-of-line blocking.' },
          { title: 'The Illustrated TLS 1.3 Connection', url: 'https://tls13.xargs.org/', note: 'Every byte of a real TLS 1.3 handshake, explained.' },
          { title: 'Apple, Wi-Fi specification details for Apple devices', url: 'https://support.apple.com/guide/deployment/dep268652e6c', note: 'M5 MacBook Air: up to 2400 Mbps link rate on 5 and 6 GHz.' },
        ]}
      />
      <p className="fine">
        Checked on this Mac: <code>ifconfig en0</code> reports mtu 1500; <code>scutil --dns</code> lists the Wi-Fi router as a DNS resolver; <code>sysctl net.inet.tcp.cubic_sockets</code> is non-zero, so TCP here uses CUBIC. The 1200 Mbps link and 25 Mbps download come from lesson 13's measurements. Header sizes are the minimums from the RFCs.
      </p>
    </div>
  )
}
