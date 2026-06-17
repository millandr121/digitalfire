import { useMemo, useState } from 'react'
import type { Oxide } from './types'

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

export function ThermalCalc(_props: { oxides: Oxide[] }) {
  // Manual oxide entry mode — user enters unity formula values directly
  const [rows, setRows] = useState<{ oxide: string; pct: string }[]>(
    Object.keys(COE_DATA).slice(0, 8).map((o) => ({ oxide: o, pct: '' }))
  )
  const [customClay, setCustomClay] = useState('')

  const analysisRows: AnalysisRow[] = rows
    .map((r) => ({ oxide: r.oxide, analysisPct: parseFloat(r.pct) || 0 }))
    .filter((r) => r.analysisPct > 0)

  const glazeCOE = useMemo(() => calcCOE(analysisRows), [analysisRows])

  function setRow(i: number, field: 'oxide' | 'pct', val: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: val } : r)))
  }

  const allOxides = Object.keys(COE_DATA)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Thermal Expansion Calculator</h1>
        <span className="text-xs text-neutral-500">Glaze fit screening · Appen method</span>
      </div>

      <p className="text-sm text-neutral-400">
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
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
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
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-right text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            />
          </div>
        ))}
        <button
          onClick={() => setRows((prev) => [...prev, { oxide: 'SiO2', pct: '' }])}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          + Add oxide
        </button>
      </div>

      {/* Result */}
      {glazeCOE != null && (
        <div className="space-y-4">
          <div className="rounded border border-neutral-700 bg-neutral-900 px-4 py-3">
            <div className="text-xs text-neutral-500">Estimated glaze COE</div>
            <div className="text-3xl font-mono font-semibold text-neutral-100">
              {glazeCOE.toFixed(3)}
              <span className="ml-2 text-sm font-normal text-neutral-500">×10⁻⁶/°C</span>
            </div>
          </div>

          {/* Clay body comparison */}
          <div>
            <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Clay Body Fit</h2>
            <div className="space-y-2">
              {CLAY_BODIES.map((body) => {
                const diff = glazeCOE - (body.lo + body.hi) / 2
                const fits = glazeCOE >= body.lo - 0.3 && glazeCOE <= body.hi + 0.3
                const crazes = glazeCOE < body.lo - 0.3
                return (
                  <div key={body.name} className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2">
                    <div className="w-48 shrink-0 text-sm text-neutral-300">{body.name}</div>
                    <div className="text-xs text-neutral-500">{body.lo}–{body.hi}</div>
                    <div className="flex-1" />
                    <div className={`text-xs font-medium ${fits ? 'text-green-400' : crazes ? 'text-blue-400' : 'text-red-400'}`}>
                      {fits ? '✓ Good fit' : crazes ? '↓ May craze' : '↑ May shiver'}
                    </div>
                    <div className="text-xs text-neutral-600">
                      {diff > 0 ? '+' : ''}{diff.toFixed(3)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Custom clay */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-400 shrink-0">My clay body COE:</label>
            <input
              type="number"
              step="0.1"
              value={customClay}
              onChange={(e) => setCustomClay(e.target.value)}
              placeholder="e.g. 6.2"
              className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
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

          <p className="text-xs text-neutral-600">
            Rule of thumb: glaze COE should be slightly lower than the clay body (compression fit).
            A difference of ±0.3 is generally acceptable. This calculator uses the Appen additive
            method — actual fit depends on firing schedule and clay body composition.
          </p>
        </div>
      )}
    </div>
  )
}
