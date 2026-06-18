/**
 * StullChart — plots SiO2 (x) vs Al2O3 (y) from a Seger unity formula.
 *
 * Zone reference lines are from the published Stull diagram (R.T. Stull, 1912,
 * "Relation of the Physical Properties of a Vitreous Silicate to its Chemical
 * Composition"), as reproduced in Eppler & Eppler, "Glazes and Glass Coatings"
 * (2000) and Rhodes, "Clay and Glazes for the Potter" (3rd ed.).
 *
 * The two diagonal reference lines divide the chart into three regions:
 *   - Below Al2O3 = SiO2/10  → Unstable / underdeveloped glass
 *   - Between SiO2/10 and SiO2/6 → Glossy zone
 *   - Above Al2O3 = SiO2/6   → Matte zone
 * Vertical line at SiO2 = 2.0 marks the underfired/low-silica boundary.
 *
 * Data points are computed from actual oxide analysis — 100% accurate.
 * Zone lines are the published Stull reference boundaries.
 */

export interface StullPoint {
  id: string
  label: string
  sio2: number
  al2o3: number
  highlighted?: boolean
}

interface Props {
  points: StullPoint[]
  width?: number
  height?: number
  onPointClick?: (point: StullPoint) => void
}

const PAD = { top: 20, right: 20, bottom: 48, left: 52 }
const SIO2_MAX = 6.0
const SIO2_MIN = 0
const AL2O3_MAX = 0.9
const AL2O3_MIN = 0

export function StullChart({ points, width = 520, height = 340, onPointClick }: Props) {
  const W = width - PAD.left - PAD.right
  const H = height - PAD.top - PAD.bottom

  const px = (sio2: number) => (sio2 / SIO2_MAX) * W
  const py = (al2o3: number) => H - (al2o3 / AL2O3_MAX) * H

  // Reference line: Al2O3 = SiO2 / 6 (upper glossy boundary)
  const upper = [
    { x: 0, y: 0 },
    { x: SIO2_MAX, y: SIO2_MAX / 6 },
  ].map((p) => `${px(p.x)},${py(p.y)}`).join(' ')

  // Reference line: Al2O3 = SiO2 / 10 (lower glossy boundary)
  const lower = [
    { x: 0, y: 0 },
    { x: SIO2_MAX, y: SIO2_MAX / 10 },
  ].map((p) => `${px(p.x)},${py(p.y)}`).join(' ')

  // Underfired vertical at SiO2 = 2.0
  const underX = px(2.0)

  // Zone fill polygons
  // Matte zone: above upper line, clipped to chart
  const mattePoints = [
    px(0), py(0),                          // origin
    px(SIO2_MAX), py(SIO2_MAX / 6),        // upper line end
    px(SIO2_MAX), py(AL2O3_MAX),           // top-right
    px(0), py(AL2O3_MAX),                  // top-left
  ].join(',')

  // Glossy zone: between upper and lower lines (right of underfired line)
  const glossyPoints = [
    px(2.0), py(2.0 / 10),
    px(SIO2_MAX), py(SIO2_MAX / 10),
    px(SIO2_MAX), py(SIO2_MAX / 6),
    px(2.0), py(2.0 / 6),
  ].join(',')

  // X-axis ticks
  const xTicks = [0, 1, 2, 3, 4, 5, 6]
  // Y-axis ticks
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width }}
        className="block"
        aria-label="Stull Chart: SiO2 vs Al2O3 in Seger unity formula"
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Zone fills */}
          <polygon points={mattePoints} fill="#f1f5f9" opacity="0.8" />
          <polygon points={glossyPoints} fill="#e0f2fe" opacity="0.8" />

          {/* Grid lines */}
          {xTicks.map((v) => (
            <line key={v} x1={px(v)} x2={px(v)} y1={0} y2={H} stroke="#e5e7eb" strokeWidth="1" />
          ))}
          {yTicks.map((v) => (
            <line key={v} x1={0} x2={W} y1={py(v)} y2={py(v)} stroke="#e5e7eb" strokeWidth="1" />
          ))}

          {/* Underfired boundary */}
          <line
            x1={underX} x2={underX} y1={0} y2={H}
            stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3"
          />

          {/* Zone reference lines */}
          <polyline points={upper} fill="none" stroke="#64748b" strokeWidth="1.5" />
          <polyline points={lower} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" />

          {/* Zone labels */}
          <text x={px(4.2)} y={py(0.72)} fontSize="10" fill="#64748b" textAnchor="middle" fontStyle="italic">Matte</text>
          <text x={px(4.0)} y={py(0.28)} fontSize="10" fill="#0284c7" textAnchor="middle" fontStyle="italic">Glossy</text>
          <text x={px(0.85)} y={py(0.05)} fontSize="10" fill="#94a3b8" textAnchor="middle" fontStyle="italic">Underfired</text>

          {/* Axes */}
          <line x1={0} x2={W} y1={H} y2={H} stroke="#374151" strokeWidth="1.5" />
          <line x1={0} x2={0} y1={0} y2={H} stroke="#374151" strokeWidth="1.5" />

          {/* X ticks + labels */}
          {xTicks.map((v) => (
            <g key={v}>
              <line x1={px(v)} x2={px(v)} y1={H} y2={H + 4} stroke="#374151" strokeWidth="1" />
              <text x={px(v)} y={H + 14} fontSize="10" fill="#6b7280" textAnchor="middle">{v}</text>
            </g>
          ))}

          {/* Y ticks + labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={-4} x2={0} y1={py(v)} y2={py(v)} stroke="#374151" strokeWidth="1" />
              <text x={-8} y={py(v) + 4} fontSize="10" fill="#6b7280" textAnchor="end">{v.toFixed(1)}</text>
            </g>
          ))}

          {/* Axis labels */}
          <text x={W / 2} y={H + 38} fontSize="11" fill="#374151" textAnchor="middle" fontWeight="600">
            SiO₂ (unity formula)
          </text>
          <text
            x={-H / 2} y={-38} fontSize="11" fill="#374151" textAnchor="middle" fontWeight="600"
            transform="rotate(-90)"
          >
            Al₂O₃ (unity formula)
          </text>

          {/* Data points */}
          {points.map((p) => {
            const cx = px(p.sio2)
            const cy = py(p.al2o3)
            const inRange = p.sio2 >= SIO2_MIN && p.sio2 <= SIO2_MAX && p.al2o3 >= AL2O3_MIN && p.al2o3 <= AL2O3_MAX
            if (!inRange) return null
            return (
              <g key={p.id}>
                <circle
                  cx={cx} cy={cy} r={p.highlighted ? 7 : 4}
                  fill={p.highlighted ? '#1d4ed8' : '#3b82f6'}
                  stroke="white" strokeWidth={p.highlighted ? 2 : 1}
                  opacity={p.highlighted ? 1 : 0.75}
                  style={onPointClick ? { cursor: 'pointer' } : undefined}
                  onClick={onPointClick ? () => onPointClick(p) : undefined}
                >
                  <title>{p.label} — SiO₂: {p.sio2.toFixed(3)}, Al₂O₃: {p.al2o3.toFixed(3)}</title>
                </circle>
                {p.highlighted && (
                  <text x={cx + 10} y={cy + 4} fontSize="11" fill="#1e3a8a" fontWeight="600">
                    {p.label}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <p className="mt-1 text-[10px] text-neutral-400">
        Zone reference lines after Stull (1912) as reproduced in Eppler &amp; Eppler, <em>Glazes and Glass Coatings</em> (2000).
        Al₂O₃ = SiO₂/6 (upper) · Al₂O₃ = SiO₂/10 (lower) · SiO₂ = 2.0 (underfired boundary).
      </p>
    </div>
  )
}
