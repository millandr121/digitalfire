/**
 * FiringTimeline — horizontal SVG chart of ceramic firing temperature events.
 *
 * Events are plotted on a 0–1400°C scale (the practical pottery range).
 * Events above 1400°C are listed separately. The scale corresponds to the
 * commonly referenced firing sequence from bisque through glaze firing.
 *
 * Reference cone temperatures (approximate midpoints):
 *   Cone 06 ~ 999°C, Cone 6 ~ 1222°C, Cone 10 ~ 1285°C
 */

import { useState } from 'react'

export interface TempEvent {
  id: string
  value: string
  event: string
  tempC: number | null
  tempHi: number | null
  source: string
}

interface Props {
  events: TempEvent[]
}

const MIN_C = 0
const MAX_C = 1400
const PAD = { top: 16, right: 16, bottom: 40, left: 16 }

// Approximate cone reference points for context marks
const CONE_MARKS: { label: string; temp: number; color: string }[] = [
  { label: 'Cone 022', temp: 586, color: '#fbbf24' },
  { label: 'Cone 06',  temp: 999, color: '#f97316' },
  { label: 'Cone 6',   temp: 1222, color: '#ef4444' },
  { label: 'Cone 10',  temp: 1285, color: '#b91c1c' },
]

function parseTempRange(value: string): { lo: number | null; hi: number | null } {
  const nums = [...value.matchAll(/(\d+)/g)].map((m) => parseInt(m[1], 10))
  if (nums.length === 0) return { lo: null, hi: null }
  if (nums.length === 1) return { lo: nums[0], hi: null }
  return { lo: nums[0], hi: nums[1] }
}

export function parseTempEvents(raw: { id: string; value: string; event: string; source: string }[]): TempEvent[] {
  return raw.map((t) => {
    const { lo, hi } = parseTempRange(t.value)
    return { ...t, tempC: lo, tempHi: hi }
  })
}

export function FiringTimeline({ events }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const W = 700
  const H = 120
  const trackW = W - PAD.left - PAD.right
  const trackY = PAD.top + 28
  const trackH = 12

  const px = (c: number) => PAD.left + ((c - MIN_C) / (MAX_C - MIN_C)) * trackW

  const inRange = events.filter((e) => e.tempC != null && e.tempC >= MIN_C && e.tempC <= MAX_C)
  const above = events.filter((e) => e.tempC != null && e.tempC > MAX_C)

  const hoveredEvent = hovered ? events.find((e) => e.id === hovered) : null

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ maxWidth: W }}
          className="block overflow-visible"
          aria-label="Firing temperature timeline: ceramic events from 0 to 1400°C"
        >
          {/* Gradient track background */}
          <defs>
            <linearGradient id="fireGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="40%" stopColor="#fed7aa" />
              <stop offset="70%" stopColor="#fca5a5" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <rect
            x={PAD.left} y={trackY}
            width={trackW} height={trackH}
            fill="url(#fireGrad)" rx="3" opacity="0.4"
          />
          <rect
            x={PAD.left} y={trackY}
            width={trackW} height={trackH}
            fill="none" stroke="#d1d5db" strokeWidth="1" rx="3"
          />

          {/* Cone reference marks */}
          {CONE_MARKS.map((c) => (
            <g key={c.label}>
              <line
                x1={px(c.temp)} x2={px(c.temp)}
                y1={trackY - 2} y2={trackY + trackH + 2}
                stroke={c.color} strokeWidth="1.5" opacity="0.6"
              />
              <text
                x={px(c.temp)} y={trackY - 5}
                fontSize="8" fill={c.color} textAnchor="middle" opacity="0.8"
              >
                {c.label}
              </text>
            </g>
          ))}

          {/* Event markers */}
          {inRange.map((e) => {
            const x = px(e.tempC!)
            const isHov = hovered === e.id
            const hasRange = e.tempHi != null && e.tempHi <= MAX_C
            return (
              <g key={e.id}
                onMouseEnter={() => setHovered(e.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                {hasRange && (
                  <rect
                    x={x} y={trackY + 1}
                    width={px(e.tempHi!) - x} height={trackH - 2}
                    fill="#6366f1" opacity={isHov ? 0.5 : 0.2} rx="1"
                  />
                )}
                <line
                  x1={x} x2={x}
                  y1={trackY - 1} y2={trackY + trackH + 1}
                  stroke={isHov ? '#4f46e5' : '#6366f1'}
                  strokeWidth={isHov ? 2 : 1.5}
                />
                <circle
                  cx={x} cy={trackY + trackH + 6} r={isHov ? 4 : 3}
                  fill={isHov ? '#4f46e5' : '#818cf8'}
                />
              </g>
            )
          })}

          {/* X-axis ticks */}
          {[0, 200, 400, 600, 800, 1000, 1200, 1400].map((t) => (
            <g key={t}>
              <line
                x1={px(t)} x2={px(t)}
                y1={trackY + trackH + 14} y2={trackY + trackH + 18}
                stroke="#9ca3af" strokeWidth="1"
              />
              <text
                x={px(t)} y={trackY + trackH + 27}
                fontSize="9" fill="#9ca3af" textAnchor="middle"
              >
                {t}°C
              </text>
            </g>
          ))}
        </svg>

        {/* Hover tooltip */}
        {hoveredEvent && (
          <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-mono text-indigo-700">{hoveredEvent.value}</span>
            {' — '}
            <span className="text-neutral-800">{hoveredEvent.event}</span>
            <span className="ml-2 text-xs text-neutral-400">{hoveredEvent.source}</span>
          </div>
        )}
        {!hoveredEvent && (
          <div className="mt-2 h-10 rounded border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-400">
            Hover a marker to see the temperature event
          </div>
        )}
      </div>

      {above.length > 0 && (
        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer hover:text-neutral-700">
            {above.length} events above 1400°C (click to expand)
          </summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {above.sort((a, b) => (a.tempC ?? 0) - (b.tempC ?? 0)).map((e) => (
              <li key={e.id}>
                <span className="font-mono text-neutral-600">{e.value}</span>
                {' — '}{e.event}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[10px] text-neutral-400">
        Cone reference temperatures are approximate midpoints. Events from digitalfire.com (Tony Hansen).
        Markers below 1400°C only — the practical pottery range.
      </p>
    </div>
  )
}
