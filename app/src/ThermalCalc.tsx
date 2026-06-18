import { useMemo, useState } from 'react'
import type { Oxide } from './types'
import { addToNotebook } from './notebook'

// Coefficient of thermal expansion (×10⁻⁶/°C) per oxide
// Values from digitalfire.com oxide data + standard ceramic references
const COE_DATA: Record<string, number> = {
  'Li2O':  0.068,
  'Na2O':  0.387,
  'K2O':   0.331,
  'KNaO':  0.359,
  'CaO':   0.148,
  'MgO':   0.026,
  'BaO':   0.129,
  'SrO':   0.130,
  'ZnO':   0.094,
  'PbO':   0.083,
  'MnO':   0.050,
  'MnO2':  0.050,
  'FeO':   0.108,
  'Fe2O3': 0.125,
  'CoO':   0.053,
  'NiO':   0.037,
  'CuO':   0.030,
  'Al2O3': 0.063,
  'B2O3':  0.031,
  'SiO2':  0.035,
  'TiO2':  0.144,
  'ZrO2':  0.020,
  'SnO2':  0.020,
  'P2O5':  0.050,
  'Free SiO2': 0.035,
}

// Typical clay body COE ranges (×10⁻⁶/°C) for reference
const CLAY_BODIES: { name: string; lo: number; hi: number }[] = [
  { name: 'Cone 6 Porcelain',        lo: 5.5, hi: 6.5 },
  { name: 'Cone 6 Stoneware',        lo: 5.8, hi: 6.8 },
  { name: 'Cone 10 Porcelain',       lo: 5.0, hi: 6.0 },
  { name: 'Cone 10 Stoneware',       lo: 5.5, hi: 6.5 },
  { name: 'Low-fire Earthenware',    lo: 6.0, hi: 7.5 },
  { name: 'Raku / High-silica body', lo: 4.5, hi: 5.5 },
]

interface AnalysisRow {
  oxide: string
  analysisPct: number
}

function calcCOE(rows: AnalysisRow[]): number | null {
  // Thermal expansion using weight-% weighted sum of oxide COEs
  // (simplified Appen method — accurate enough for glaze fit screening)
  let sum = 0
  let total = 0
  for (const r of rows) {
    const coe = COE_DATA[r.oxide]
    if (coe != null) {
      sum += coe * r.analysisPct
      total += r.analysisPct
    }
  }
  return total > 0 ? Math.round((sum / total) * 1000) / 1000 : null
}

const GAUGE_MIN = 3.0
const GAUGE_MAX = 9.5

function COEGauge({
  coe,
  bodies,
}: {
  coe: number
  bodies: { name: string; lo: number; hi: number }[]
}) {
  const W = 400
  const H = 56
  const LABEL_H = 18
  const BAR_Y = LABEL_H + 4
  const BAR_H = 14

  const px = (v: number) => ((v - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * W

  // Palette for clay body bands — deterministic order
  const BAND_COLORS = ['#bfdbfe', '#a5f3fc', '#bbf7d0', '#fef08a', '#fed7aa', '#fecaca']

  const ticks = [3, 4, 5, 6, 7, 8, 9]

  return (
    <div>
      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">COE Gauge</h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} className="block overflow-visible">
        {/* Clay body bands */}
        {bodies.map((b, i) => (
          <rect
            key={b.name}
            x={px(b.lo)} y={BAR_Y}
            width={px(b.hi) - px(b.lo)} height={BAR_H}
            fill={BAND_COLORS[i % BAND_COLORS.length]}
            opacity="0.85"
          >
            <title>{b.name}: {b.lo}–{b.hi}</title>
          </rect>
        ))}

        {/* Gauge track background */}
        <rect x={0} y={BAR_Y} width={W} height={BAR_H} fill="none" stroke="#d1d5db" strokeWidth="1" rx="2" />

        {/* Tick marks */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={px(v)} x2={px(v)} y1={BAR_Y + BAR_H} y2={BAR_Y + BAR_H + 4} stroke="#9ca3af" strokeWidth="1" />
            <text x={px(v)} y={BAR_Y + BAR_H + 14} fontSize="9" fill="#9ca3af" textAnchor="middle">{v}</text>
          </g>
        ))}

        {/* Axis label */}
        <text x={W / 2} y={H} fontSize="9" fill="#9ca3af" textAnchor="middle">COE (×10⁻⁶/°C)</text>

        {/* Glaze COE marker */}
        {coe >= GAUGE_MIN && coe <= GAUGE_MAX && (
          <g>
            <line
              x1={px(coe)} x2={px(coe)} y1={BAR_Y - 2} y2={BAR_Y + BAR_H + 2}
              stroke="#1d4ed8" strokeWidth="2"
            />
            <polygon
              points={`${px(coe)},${BAR_Y - 2} ${px(coe) - 5},${BAR_Y - 10} ${px(coe) + 5},${BAR_Y - 10}`}
              fill="#1d4ed8"
            />
            <text x={px(coe)} y={BAR_Y - 12} fontSize="10" fill="#1d4ed8" textAnchor="middle" fontWeight="bold">
              {coe.toFixed(3)}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-1 text-[10px] text-neutral-400">
        Coloured bands show typical clay body COE ranges. Blue marker = computed glaze COE.
        Glaze should sit slightly below the clay body band (compression fit prevents crazing).
      </p>
    </div>
  )
}

export function ThermalCalc(_props: { oxides: Oxide[] }) {
  // Manual oxide entry mode — user enters unity formula values directly
  const [rows, setRows] = useState<{ oxide: string; pct: string }[]>(
    Object.keys(COE_DATA).slice(0, 8).map((o) => ({ oxide: o, pct: '' }))
  )
  const [customClay, setCustomClay] = useState('')
  const [label, setLabel] = useState('')

  const analysisRows: AnalysisRow[] = rows
    .map((r) => ({ oxide: r.oxide, analysisPct: parseFloat(r.pct) || 0 }))
    .filter((r) => r.analysisPct > 0)

  const glazeCOE = useMemo(() => calcCOE(analysisRows), [analysisRows])

  function setRow(i: number, field: 'oxide' | 'pct', val: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: val } : r)))
  }

  const allOxides = Object.keys(COE_DATA)

  function clearCalc() {
    setRows(Object.keys(COE_DATA).slice(0, 8).map((o) => ({ oxide: o, pct: '' })))
    setCustomClay('')
    setLabel('')
  }

  function saveToNotebook() {
    if (glazeCOE == null) return
    addToNotebook({
      id: `thermal-${Date.now()}`,
      type: 'calc',
      label: label || `COE ${glazeCOE.toFixed(3)}`,
      note: '',
      data: { coe: glazeCOE, analysisRows, customClay },
    })
    clearCalc()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Thermal Expansion Calculator</h1>
        <span className="text-xs text-neutral-500">Glaze fit screening · Appen method</span>
      </div>

      <p className="text-sm text-neutral-500">
        Enter glaze oxide weight percentages to estimate the coefficient of thermal expansion (COE ×10⁻⁶/°C)
        and check fit against common clay bodies.
      </p>

      {/* Oxide input table */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_120px] gap-2 px-1 text-xs text-neutral-500">
          <span>Oxide</span>
          <span className="text-right">Wt %</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px] gap-2">
            <select
              value={row.oxide}
              onChange={(e) => setRow(i, 'oxide', e.target.value)}
              className="rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
            >
              {allOxides.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={row.pct}
              onChange={(e) => setRow(i, 'pct', e.target.value)}
              placeholder="0"
              className="rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-right text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
            />
          </div>
        ))}
        <button
          onClick={() => setRows((prev) => [...prev, { oxide: 'SiO2', pct: '' }])}
          className="text-sm text-neutral-500 hover:text-neutral-700"
        >
          + Add oxide
        </button>
      </div>

      {/* Result */}
      {glazeCOE != null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label this calculation (optional)…"
              className="w-64 rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button onClick={clearCalc} className="text-xs text-neutral-400 hover:text-neutral-600">Clear</button>
              <button
                onClick={saveToNotebook}
                className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              >
                + Save to notebook
              </button>
            </div>
          </div>
          <div className="rounded border border-neutral-300 bg-neutral-50 px-4 py-3">
            <div className="text-xs text-neutral-500">Estimated glaze COE</div>
            <div className="text-3xl font-mono font-semibold text-neutral-900">
              {glazeCOE.toFixed(3)}
              <span className="ml-2 text-sm font-normal text-neutral-500">×10⁻⁶/°C</span>
            </div>
          </div>

          {/* COE Gauge */}
          <COEGauge coe={glazeCOE} bodies={CLAY_BODIES} />

          {/* Clay body comparison */}
          <div>
            <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Clay Body Fit</h2>
            <div className="space-y-2">
              {CLAY_BODIES.map((body) => {
                const diff = glazeCOE - (body.lo + body.hi) / 2
                const fits = glazeCOE >= body.lo - 0.3 && glazeCOE <= body.hi + 0.3
                const crazes = glazeCOE < body.lo - 0.3
                return (
                  <div key={body.name} className="flex items-center gap-3 rounded border border-neutral-200 px-3 py-2">
                    <div className="w-48 shrink-0 text-sm text-neutral-700">{body.name}</div>
                    <div className="text-xs text-neutral-500">{body.lo}–{body.hi}</div>
                    <div className="flex-1" />
                    <div className={`text-xs font-medium ${fits ? 'text-green-600' : crazes ? 'text-blue-500' : 'text-red-500'}`}>
                      {fits ? '✓ Good fit' : crazes ? '↓ May craze' : '↑ May shiver'}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {diff > 0 ? '+' : ''}{diff.toFixed(3)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Custom clay */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-500 shrink-0">My clay body COE:</label>
            <input
              type="number"
              step="0.1"
              value={customClay}
              onChange={(e) => setCustomClay(e.target.value)}
              placeholder="e.g. 6.2"
              className="w-32 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
            />
            {customClay && !isNaN(parseFloat(customClay)) && (
              <span className={`text-sm font-medium ${
                Math.abs(glazeCOE - parseFloat(customClay)) <= 0.3
                  ? 'text-green-400'
                  : glazeCOE < parseFloat(customClay)
                  ? 'text-blue-400'
                  : 'text-red-400'
              }`}>
                {Math.abs(glazeCOE - parseFloat(customClay)) <= 0.3
                  ? '✓ Good fit'
                  : glazeCOE < parseFloat(customClay)
                  ? '↓ Glaze COE lower — may craze'
                  : '↑ Glaze COE higher — may shiver'}
              </span>
            )}
          </div>

          <p className="text-xs text-neutral-400">
            Rule of thumb: glaze COE should be slightly lower than the clay body (compression fit).
            A difference of ±0.3 is generally acceptable. This calculator uses the Appen additive
            method — actual fit depends on firing schedule and clay body composition.
          </p>
        </div>
      )}
    </div>
  )
}
