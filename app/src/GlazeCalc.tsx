import { useMemo, useRef, useState } from 'react'
import type { Material, Oxide, Recipe } from './types'
import { analysisToFormula, FLUX_OXIDES, molecularWeight } from './chem'
import { StullChart } from './components/StullChart'
import { UnityFormulaViz } from './components/UnityFormulaViz'
import { addToNotebook } from './notebook'

// Typical Cone 6 limit ranges for reference (Digitalfire-style guidance)
const CONE6_LIMITS: Record<string, [number, number]> = {
  'SiO2':  [2.5, 4.5],
  'Al2O3': [0.25, 0.6],
  'B2O3':  [0.0, 0.9],
  'CaO':   [0.0, 0.9],
  'MgO':   [0.0, 0.35],
  'K2O':   [0.0, 0.4],
  'Na2O':  [0.0, 0.4],
  'ZnO':   [0.0, 0.3],
  'BaO':   [0.0, 0.2],
  'SrO':   [0.0, 0.35],
  'Li2O':  [0.0, 0.4],
  'TiO2':  [0.0, 0.15],
  'Fe2O3': [0.0, 0.35],
  'MnO':   [0.0, 0.2],
}

function MaterialPicker({
  value,
  onChange,
  materials,
}: {
  value: string
  onChange: (id: string) => void
  materials: Material[]
}) {
  const [query, setQuery] = useState(() => {
    const m = materials.find((x) => x.id === value)
    return m ? m.name : ''
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const hits = q.length >= 1
    ? materials.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 12)
    : []

  function select(m: Material) {
    setQuery(m.name)
    onChange(m.id)
    setOpen(false)
  }

  function handleBlur() {
    setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) {
        setOpen(false)
        // If no valid match, clear
        if (!materials.find((m) => m.id === value)) {
          setQuery('')
          onChange('')
        }
      }
    }, 150)
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange('') }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        placeholder="Search material…"
        className="w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none"
      />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-48 overflow-y-auto rounded border border-neutral-200 bg-white shadow-lg">
          {hits.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={() => select(m)}
                className="w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Line {
  materialId: string
  amount: string
}

interface BlendRow {
  oxide: string
  analysisPct: number
  mol: number | null
  unity: number | null
  limits: [number, number] | null
}

function blendMaterials(lines: Line[], materials: Material[]): BlendRow[] {
  // sum weight-% contributions from each ingredient
  const oxideTotals: Record<string, number> = {}
  let totalWeight = 0

  for (const line of lines) {
    const amt = parseFloat(line.amount)
    if (!amt || amt <= 0) continue
    const mat = materials.find((m) => m.id === line.materialId)
    if (!mat) continue
    totalWeight += amt
    for (const row of mat.analysis) {
      if (row.analysis_pct == null) continue
      oxideTotals[row.oxide] = (oxideTotals[row.oxide] || 0) + (row.analysis_pct / 100) * amt
    }
  }

  if (totalWeight === 0) return []

  // convert to weight %
  const analysisRows = Object.entries(oxideTotals).map(([oxide, total]) => ({
    oxide,
    analysis_pct: (total / totalWeight) * 100,
  }))

  const { formula } = analysisToFormula(analysisRows)
  const formulaMap = new Map(formula.map((r) => [r.oxide, r.amount]))

  return analysisRows
    .sort((a, b) => {
      const order = [...FLUX_OXIDES, 'Al2O3', 'B2O3', 'SiO2', 'TiO2', 'Fe2O3']
      const ai = order.indexOf(a.oxide)
      const bi = order.indexOf(b.oxide)
      if (ai === -1 && bi === -1) return a.oxide.localeCompare(b.oxide)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .map(({ oxide, analysis_pct }) => ({
      oxide,
      analysisPct: Math.round(analysis_pct * 100) / 100,
      mol: molecularWeight(oxide) ? analysis_pct / molecularWeight(oxide)! : null,
      unity: formulaMap.get(oxide) ?? null,
      limits: CONE6_LIMITS[oxide] ?? null,
    }))
}

function findMat(name: string, materials: Material[]): Material | undefined {
  const q = name.replace(/^\*/, '').trim().toLowerCase()
  let m = materials.find((x) => x.name.toLowerCase() === q)
  if (m) return m
  m = materials.find((x) => (x.alternate_names || '').toLowerCase().split(/[;,]+/).map((s) => s.trim()).includes(q))
  if (m) return m
  const paren = q.match(/\(([^)]+)\)/)
  if (paren) {
    const inner = paren[1].trim()
    m = materials.find((x) => x.name.toLowerCase() === inner)
    if (m) return m
  }
  return materials.find((x) => {
    const n = x.name.toLowerCase()
    return n.length >= 4 && (q.startsWith(n) || n.startsWith(q))
  })
}

export function GlazeCalc({ materials, recipes }: { materials: Material[]; oxides: Oxide[]; recipes: Recipe[] }) {
  const [lines, setLines] = useState<Line[]>([
    { materialId: '', amount: '' },
    { materialId: '', amount: '' },
    { materialId: '', amount: '' },
  ])
  const [name, setName] = useState('')

  const validMaterials = materials.filter((m) => m.analysis.length > 0)

  const blend = useMemo(() => blendMaterials(lines, materials), [lines, materials])

  const contextPoints = useMemo(() => {
    return recipes.flatMap((r) => {
      const oxideTotals: Record<string, number> = {}
      let totalWeight = 0
      for (const line of r.materials) {
        const amt = line.amount ?? line.percent
        if (!amt || amt <= 0) continue
        const mat = findMat(line.material, materials)
        if (!mat) continue
        totalWeight += amt
        for (const row of mat.analysis) {
          if (row.analysis_pct == null) continue
          oxideTotals[row.oxide] = (oxideTotals[row.oxide] || 0) + (row.analysis_pct / 100) * amt
        }
      }
      if (totalWeight === 0) return []
      const analysisRows = Object.entries(oxideTotals).map(([oxide, total]) => ({
        oxide, analysis_pct: (total / totalWeight) * 100,
      }))
      const { formula } = analysisToFormula(analysisRows)
      const fmap = new Map(formula.map((x) => [x.oxide, x.amount]))
      const sio2 = fmap.get('SiO2')
      const al2o3 = fmap.get('Al2O3')
      if (sio2 == null || al2o3 == null) return []
      return [{ id: r.id, label: r.code || r.name, sio2, al2o3 }]
    })
  }, [recipes, materials])

  const fluxSum = blend
    .filter((r) => FLUX_OXIDES.has(r.oxide))
    .reduce((a, r) => a + (r.unity ?? 0), 0)

  const silicaAlumina =
    blend.find((r) => r.oxide === 'SiO2')?.unity &&
    blend.find((r) => r.oxide === 'Al2O3')?.unity
      ? (blend.find((r) => r.oxide === 'SiO2')!.unity! /
          blend.find((r) => r.oxide === 'Al2O3')!.unity!).toFixed(2)
      : null

  function clearCalc() {
    setLines([
      { materialId: '', amount: '' },
      { materialId: '', amount: '' },
      { materialId: '', amount: '' },
    ])
    setName('')
  }

  function saveToNotebook() {
    addToNotebook({
      id: `calc-${Date.now()}`,
      type: 'calc',
      label: name || 'Unnamed Calculation',
      note: '',
      data: { blend, fluxSum, name, lines },
    })
    clearCalc()
  }

  function setLine(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, [field]: value } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { materialId: '', amount: '' }])
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i))
  }

  const totalAmt = lines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Glaze Calculator</h1>
        <span className="text-xs text-neutral-500">Unity molecular formula · Cone 6 limits</span>
      </div>

      {/* Recipe name */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Recipe name (optional)…"
        className="w-full rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
      />

      {/* Ingredient lines */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_100px_32px] gap-2 text-xs text-neutral-500 px-1">
          <span>Material</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_32px] gap-2 items-center">
            <MaterialPicker
              value={line.materialId}
              onChange={(id) => setLine(i, 'materialId', id)}
              materials={validMaterials}
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={line.amount}
              onChange={(e) => setLine(i, 'amount', e.target.value)}
              placeholder="0"
              className="rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-right text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none"
            />
            <button
              onClick={() => removeLine(i)}
              className="text-neutral-400 hover:text-neutral-500 text-lg leading-none"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between px-1">
          <button
            onClick={addLine}
            className="text-sm text-neutral-500 hover:text-neutral-700"
          >
            + Add material
          </button>
          {totalAmt > 0 && (
            <span className="text-xs text-neutral-500">Total: {totalAmt.toFixed(1)}</span>
          )}
        </div>
      </div>

      {/* Results */}
      {blend.length > 0 && (
        <div className="space-y-4">
          {/* Save / Clear */}
          <div className="flex items-center justify-between">
            <button
              onClick={clearCalc}
              className="text-xs text-neutral-400 hover:text-neutral-600"
            >
              Clear
            </button>
            <button
              onClick={saveToNotebook}
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
            >
              + Save to notebook
            </button>
          </div>
          {/* Summary stats */}
          <div className="flex flex-wrap gap-4 text-sm">
            <Stat label="Flux sum" value={fluxSum.toFixed(3)} ideal="1.000" />
            {silicaAlumina && <Stat label="Si:Al ratio" value={silicaAlumina} ideal="5–10" />}
          </div>

          {/* Unity formula table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
                  <th className="py-1.5 font-normal">Oxide</th>
                  <th className="py-1.5 text-right font-normal">Wt %</th>
                  <th className="py-1.5 text-right font-normal pr-4">Unity</th>
                  <th className="py-1.5 font-normal">Cone 6 range</th>
                  <th className="py-1.5 font-normal w-32">Status</th>
                </tr>
              </thead>
              <tbody>
                {blend.map((row) => {
                  const inRange =
                    row.limits && row.unity != null
                      ? row.unity >= row.limits[0] && row.unity <= row.limits[1]
                      : null
                  const hasLimit = row.limits != null
                  return (
                    <tr key={row.oxide} className="border-t border-neutral-100">
                      <td className="py-1 font-mono text-neutral-800">{row.oxide}</td>
                      <td className="py-1 text-right font-mono text-neutral-500">{row.analysisPct.toFixed(2)}</td>
                      <td className="py-1 text-right font-mono text-neutral-900 pr-4">
                        {row.unity != null ? row.unity.toFixed(3) : '—'}
                      </td>
                      <td className="py-1 text-neutral-500 text-xs">
                        {row.limits ? `${row.limits[0]}–${row.limits[1]}` : ''}
                      </td>
                      <td className="py-1">
                        {hasLimit && row.unity != null && (
                          <LimitBar value={row.unity} limits={row.limits!} inRange={inRange!} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Unity formula visualization */}
          {(() => {
            const unityRows = blend
              .filter((r) => r.unity != null && r.unity > 0)
              .map((r) => ({ oxide: r.oxide, amount: r.unity as number }))
            return unityRows.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Seger Groups</div>
                <UnityFormulaViz formula={unityRows} />
              </div>
            ) : null
          })()}

          {/* Stull chart position */}
          {(() => {
            const sio2 = blend.find((r) => r.oxide === 'SiO2')?.unity
            const al2o3 = blend.find((r) => r.oxide === 'Al2O3')?.unity
            if (!sio2 || !al2o3) return null
            return (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Stull Chart Position</div>
                <p className="mb-2 text-xs text-neutral-400">
                  SiO₂ {sio2.toFixed(3)} · Al₂O₃ {al2o3.toFixed(3)}
                </p>
                <StullChart
                  points={[
                    ...contextPoints.map((p) => ({ ...p, highlighted: false })),
                    { id: 'calc', label: name || 'Recipe', sio2, al2o3, highlighted: true },
                  ]}
                  width={480}
                  height={320}
                />
              </div>
            )
          })()}

          {/* Flux normalization note */}
          {Math.abs(fluxSum - 1.0) > 0.01 && (
            <p className="text-xs text-amber-500">
              Flux sum is {fluxSum.toFixed(3)} (not 1.000) — recipe may be missing a flux material or
              the selected materials lack complete analysis data.
            </p>
          )}
        </div>
      )}

      {blend.length === 0 && lines.some((l) => l.materialId && l.amount) && (
        <p className="text-sm text-neutral-500">
          Selected materials have no oxide analysis data — add materials with analysis to calculate.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, ideal }: { label: string; value: string; ideal: string }) {
  return (
    <div className="rounded border border-neutral-200 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-mono text-neutral-900">{value}</div>
      <div className="text-xs text-neutral-400">ideal: {ideal}</div>
    </div>
  )
}

function LimitBar({ value, limits, inRange }: { value: number; limits: [number, number]; inRange: boolean }) {
  const [lo, hi] = limits
  const range = hi - lo || 1
  const pct = Math.min(100, Math.max(0, ((value - lo) / range) * 100))
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-2 w-24 rounded-full bg-neutral-200">
        <div className="absolute inset-0 rounded-full bg-neutral-700 opacity-40" />
        <div
          className={`absolute top-0 h-2 w-1.5 -translate-x-1/2 rounded-full ${inRange ? 'bg-green-500' : 'bg-red-400'}`}
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className={`text-xs ${inRange ? 'text-green-500' : 'text-red-400'}`}>
        {inRange ? '✓' : '✗'}
      </span>
    </div>
  )
}
