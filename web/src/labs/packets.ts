// The packet lab's arithmetic: how a message is cut into TLS records and TCP segments that fit the MTU, what the
// headers cost, and what packet loss does to retransmissions and throughput.

/** Largest IP packet on Ethernet and almost every Wi-Fi network (RFC 894); `ifconfig en0` prints mtu 1500 here. */
export const MTU = 1500
/** Minimum header sizes in bytes: IPv4 (RFC 791), IPv6 (RFC 8200), TCP without options (RFC 9293), Ethernet II plus its checksum (RFC 894). */
export const HDR = { ipv4: 20, ipv6: 40, tcp: 20, eth: 14 + 4 }
/** TLS 1.3 records carry at most 2^14 bytes; each adds a 5-byte header, a 1-byte inner type and a 16-byte AES-GCM tag (RFC 8446, RFC 5116). */
export const TLS_RECORD = 16384
export const TLS_OVERHEAD = 5 + 1 + 16

export type Plan = {
  message: number
  records: number
  tlsBytes: number
  /** Most payload one TCP segment can carry: MTU minus the IP and TCP headers. */
  mss: number
  packets: number
  /** Payload in the final, usually short, packet. */
  last: number
  headerBytes: number
  wireBytes: number
  /** Share of the bytes on the wire that are the message itself. */
  efficiency: number
}

export function plan(message: number, ip: 4 | 6 = 4): Plan {
  const m = Math.max(0, Math.floor(message))
  const records = Math.ceil(m / TLS_RECORD)
  const tlsBytes = records * TLS_OVERHEAD
  const stream = m + tlsBytes
  const mss = MTU - (ip === 4 ? HDR.ipv4 : HDR.ipv6) - HDR.tcp
  const packets = Math.ceil(stream / mss)
  const last = packets ? stream - (packets - 1) * mss : 0
  const headerBytes = packets * (MTU - mss + HDR.eth)
  const wireBytes = stream + headerBytes
  return { message: m, records, tlsBytes, mss, packets, last, headerBytes, wireBytes, efficiency: wireBytes ? m / wireBytes : 0 }
}

/** Sends `n` packets over a link that drops each try with probability p; every loss costs one more try. */
export function send(n: number, p: number, rand: () => number, maxTries = 50) {
  let tries = 0
  let lost = 0
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < maxTries; k++) {
      tries++
      if (rand() >= p) break
      lost++
    }
  }
  return { tries, lost }
}

/** Average tries per packet when each try fails with probability p. */
export const expectedTries = (p: number) => (p >= 1 ? Infinity : 1 / (1 - p))

/**
 * Throughput ceiling of standard TCP congestion control in bits a second: an average window of 1.2/sqrt(p)
 * segments (RFC 3649) sent once per round trip. Null without loss, where the link and the receiver set the limit.
 */
export function lossCeiling(p: number, rttMs: number, mss = MTU - HDR.ipv4 - HDR.tcp): number | null {
  if (!(p > 0) || !(rttMs > 0)) return null
  return ((1.2 / Math.sqrt(p)) * mss * 8) / (rttMs / 1000)
}

/** Rough packets a second for a byte rate, if the packets are full size. Smaller packets mean more of them. */
export const packetsPerSecond = (bps: number | null | undefined) => (bps == null || !Number.isFinite(bps) || bps < 0 ? null : bps / MTU)

/** A repeatable random source, so the loss demo shows the same run for the same settings. */
export function seeded(s: number) {
  let x = s >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}
