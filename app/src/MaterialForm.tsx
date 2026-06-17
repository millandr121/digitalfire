import { useMemo, useState } from 'react'
import type { Material, Oxide } from './types'
import { analysisToFormula, formulaToAnalysis, formulaWeight, analysisTotal } from './chem'

const inputCls =
  'w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-500 focus:outline-none'

interface Props {
  initial?: Material
  oxides: Oxide[]
  onSave: (m: Material) => void
  onCancel: () => void
}

interface Row {
  oxide: string
  analysis_pct: string
  formula: string
  tolerance: string
}

function toNum(s: string): number | null {
  if (s == null || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '+').replace(/^\++|\++$/g, '')
}

const emptyRow = (): Row => ({ oxide: '', analysis_pct: '', formula: '', tolerance: '' })

export function MaterialForm({ initial, oxides, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [alt, setAlt] = useState(initial?.alternate_names ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [rows, setRows] = useState<Row[]>(
    initial?.analysis.length
      ? initial.analysis.map((a) => ({
          oxide: a.oxide,
          analysis_pct: a.analysis_pct?.toString() ?? '',
          formula: a.formula?.toString() ?? '',
          tolerance: a.tolerance ?? '',
        }))
      : [emptyRow()],
  )
  const [props, setProps] = useState<{ key: string; value: string }[]>(
    initial ? Object.entries(initial.properties).map(([key, value]) => ({ key, value })) : [],
  )

  const oxideOptions = useMemo(
    () => [...new Set(oxides.map((o) => o.symbol).filter(Boolean))].sort(),
    [oxides],
  )

  const numAnalysis = rows.map((r) => ({ oxide: r.oxide, analysis_pct: toNum(r.analysis_pct) }))
  const numFormula = rows.map((r) => ({ oxide: r.oxide, amount: toNum(r.formula) }))
  const sumPct = analysisTotal(numAnalysis)
  const fw = formulaWeight(numFormula)

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const calcFormula = () => {
    const { formula } = analysisToFormula(numAnalysis)
    setRows((rs) => rs.map((r, i) => ({ ...r, formula: formula[i]?.amount?.toString() ?? '' })))
  }
  const calcAnalysis = () => {
    const { analysis } = formulaToAnalysis(numFormula)
    setRows((rs) => rs.map((r, i) => ({ ...r, analysis_pct: analysis[i]?.analysis_pct?.toString() ?? '' })))
  }

  const submit = () => {
    if (!name.trim()) return
    const material: Material = {
      id: initial?.id ?? slugify(name),
      name: name.trim(),
      alternate_names: alt.trim() || null,
      description: desc.trim() || null,
      analysis: rows
        .filter((r) => r.oxide.trim())
        .map((r) => ({
          oxide: r.oxide.trim(),
          analysis_pct: toNum(r.analysis_pct),
          formula: toNum(r.formula),
          tolerance: r.tolerance.trim() || null,
        })),
      oxide_weight: fw,
      formula_weight: fw,
      properties: Object.fromEntries(
        props.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value.trim()]),
      ),
      source: initial?.source ?? 'user',
    }
    onSave(material)
  }

  const sumColor = Math.abs(sumPct - 100) <= 1 ? 'text-emerald-400' : sumPct > 0 ? 'text-amber-400' : 'text-neutral-500'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{initial ? 'Edit material' : 'New material'}</h1>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded bg-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custer Feldspar" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">Alternate names</span>
          <input className={inputCls} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="comma separated" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">Description</span>
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
      </div>

      <div className="rounded border border-neutral-200 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Oxide analysis</h2>
          <div className="flex-1" />
          <button onClick={calcFormula} className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200">
            ↻ Formula from %
          </button>
          <button onClick={calcAnalysis} className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200">
            ↻ % from formula
          </button>
        </div>

        <datalist id="oxide-options">
          {oxideOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5rem_5rem_4rem_1.5rem] gap-2 text-[10px] uppercase tracking-wide text-neutral-500">
            <span>Oxide</span>
            <span className="text-right">Analysis %</span>
            <span className="text-right">Formula</span>
            <span>Tol.</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_4rem_1.5rem] items-center gap-2">
              <input list="oxide-options" className={inputCls} value={r.oxide} onChange={(e) => setRow(i, { oxide: e.target.value })} placeholder="SiO2" />
              <input className={`${inputCls} text-right`} value={r.analysis_pct} onChange={(e) => setRow(i, { analysis_pct: e.target.value })} inputMode="decimal" />
              <input className={`${inputCls} text-right`} value={r.formula} onChange={(e) => setRow(i, { formula: e.target.value })} inputMode="decimal" />
              <input className={inputCls} value={r.tolerance} onChange={(e) => setRow(i, { tolerance: e.target.value })} />
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-neutral-700" title="Remove">
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs">
          <button onClick={() => setRows((rs) => [...rs, emptyRow()])} className="rounded border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-200">
            + Add oxide
          </button>
          <div className="flex-1" />
          <span className={sumColor}>Σ {sumPct}%</span>
          <span className="text-neutral-500">formula wt {fw ?? '—'}</span>
        </div>
      </div>

      <div className="rounded border border-neutral-200 p-4">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Properties</h2>
          <div className="flex-1" />
          <button onClick={() => setProps((p) => [...p, { key: '', value: '' }])} className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200">
            + Add property
          </button>
        </div>
        {props.length === 0 && (
          <p className="text-xs text-neutral-400">None yet — e.g. “Co-efficient of Linear Expansion” → 8.18</p>
        )}
        <div className="space-y-2">
          {props.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-2">
              <input
                className={inputCls}
                value={p.key}
                onChange={(e) => setProps((ps) => ps.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                placeholder="Property"
              />
              <input
                className={inputCls}
                value={p.value}
                onChange={(e) => setProps((ps) => ps.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="Value"
              />
              <button onClick={() => setProps((ps) => ps.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-neutral-700">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
