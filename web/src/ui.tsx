import type { ReactNode } from 'react'
import { NA } from './format.ts'
import { InfoButton } from './Learn.tsx'

/** A formatted value. "n/a" gets a tooltip explaining why, so null never reads as zero. */
export function Val({ v, why }: { v: string; why?: string }) {
  if (v !== NA) return <span className="num">{v}</span>
  return (
    <span className="na" title={why ?? 'The reader cannot read this on this Mac.'}>
      n/a<span className="sr-only">. {why ?? 'The reader cannot read this on this Mac.'}</span>
    </span>
  )
}

export function Stat({ label, value, why, sub, topic }: { label: string; value: string; why?: string; sub?: ReactNode; topic?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {topic && <InfoButton topic={topic} />}
      </div>
      <div className="stat-value">
        <Val v={value} why={why} />
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/** Line sparkline. Null points leave a gap. `max` fixes the scale; otherwise it fits the data. */
export function Sparkline({
  values,
  max,
  w = 160,
  h = 36,
  color = 'var(--accent)',
  fill = true,
  label,
}: {
  values: (number | null)[]
  max?: number
  w?: number
  h?: number
  color?: string
  fill?: boolean
  label?: string
}) {
  const top = max ?? Math.max(1e-9, ...values.map((v) => v ?? 0))
  const n = values.length
  const x = (i: number) => (n <= 1 ? w : (i / (n - 1)) * w)
  const y = (v: number) => h - 1 - (Math.min(v, top) / top) * (h - 2)
  const runs: string[] = []
  let cur: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) runs.push(cur.join(' '))
      cur = []
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  })
  if (cur.length) runs.push(cur.join(' '))
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ height: h }}>
      {runs.map((r, i) => (
        <g key={i}>
          {fill && <polygon points={`${r.split(' ')[0].split(',')[0]},${h} ${r} ${r.split(' ').at(-1)!.split(',')[0]},${h}`} fill={color} opacity={0.14} />}
          <polyline points={r} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  )
}
