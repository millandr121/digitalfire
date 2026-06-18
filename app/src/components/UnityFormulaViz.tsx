/**
 * UnityFormulaViz — visualizes the Seger unity molecular formula as three
 * proportional column groups:
 *
 *   RO + R₂O (Fluxes)  |  R₂O₃ (Stabilizers)  |  RO₂ (Glass Formers)
 *
 * Each column is a stacked bar where bar height is proportional to the unity
 * amount of each oxide. Values are computed by analysisToFormula() — exact.
 *
 * Color assignments follow standard ceramic chemistry oxide groupings.
 */

export interface UnityRow {
  oxide: string
  amount: number
}

interface Props {
  formula: UnityRow[]
}

// Oxide → group mapping (Seger classification)
const FLUXES = new Set(['Li2O', 'Na2O', 'K2O', 'KNaO', 'CaO', 'MgO', 'BaO', 'SrO', 'ZnO', 'PbO', 'MnO', 'FeO', 'CuO', 'CoO', 'NiO'])
const STABILIZERS = new Set(['Al2O3', 'Fe2O3', 'B2O3', 'Cr2O3', 'TiO2'])
const GLASS_FORMERS = new Set(['SiO2', 'ZrO2', 'SnO2', 'P2O5'])

// Distinct colors per oxide — from a fixed palette for reproducibility
const OXIDE_COLORS: Record<string, string> = {
  // Fluxes — warm tones
  CaO: '#f97316', MgO: '#fb923c', K2O: '#fbbf24', Na2O: '#fde68a',
  Li2O: '#fef9c3', ZnO: '#d97706', BaO: '#b45309', SrO: '#92400e',
  PbO: '#a16207', MnO: '#ca8a04', FeO: '#dc2626', CuO: '#16a34a',
  CoO: '#2563eb', NiO: '#7c3aed', KNaO: '#f59e0b',
  // Stabilizers — cool greens/teals
  Al2O3: '#0d9488', Fe2O3: '#b91c1c', B2O3: '#0891b2',
  Cr2O3: '#065f46', TiO2: '#6d28d9',
  // Glass formers — blues/purples
  SiO2: '#1d4ed8', ZrO2: '#4338ca', SnO2: '#7c3aed', P2O5: '#a21caf',
}

function oxideColor(oxide: string): string {
  return OXIDE_COLORS[oxide] || '#9ca3af'
}

function group(oxide: string): 'flux' | 'stabilizer' | 'glass' | 'other' {
  if (FLUXES.has(oxide)) return 'flux'
  if (STABILIZERS.has(oxide)) return 'stabilizer'
  if (GLASS_FORMERS.has(oxide)) return 'glass'
  return 'other'
}

interface ColProps {
  label: string
  subtitle: string
  rows: UnityRow[]
  maxVal: number
}

function Column({ label, subtitle, rows, maxVal }: ColProps) {
  const total = rows.reduce((a, r) => a + r.amount, 0)
  const BAR_H = 180

  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-[9px] text-neutral-400 mb-1">{subtitle}</div>

      {/* Stacked bar */}
      <div
        className="w-14 rounded overflow-hidden border border-neutral-200 relative"
        style={{ height: BAR_H }}
        title={`Total: ${total.toFixed(3)}`}
      >
        {rows.length === 0 ? (
          <div className="w-full h-full bg-neutral-100" />
        ) : (
          rows.map((r) => {
                      return (
              <div
                key={r.oxide}
                style={{
                  height: `${(r.amount / (maxVal || 1)) * BAR_H}px`,
                  backgroundColor: oxideColor(r.oxide),
                }}
                title={`${r.oxide}: ${r.amount.toFixed(3)}`}
              />
            )
          })
        )}
      </div>

      {/* Total below bar */}
      <div className="text-xs font-mono text-neutral-700 mt-1">{total > 0 ? total.toFixed(3) : '—'}</div>

      {/* Legend */}
      <div className="space-y-0.5 w-full mt-1">
        {rows.map((r) => (
          <div key={r.oxide} className="flex items-center gap-1.5 text-[10px]">
            <div
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: oxideColor(r.oxide) }}
            />
            <span className="font-mono text-neutral-600 shrink-0">{r.oxide}</span>
            <span className="text-neutral-400 ml-auto font-mono">{r.amount.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function UnityFormulaViz({ formula }: Props) {
  const rows = formula.filter((r) => r.amount != null && r.amount > 0.0005)

  const fluxRows = rows.filter((r) => group(r.oxide) === 'flux')
    .sort((a, b) => b.amount - a.amount)
  const stabRows = rows.filter((r) => group(r.oxide) === 'stabilizer')
    .sort((a, b) => b.amount - a.amount)
  const glassRows = rows.filter((r) => group(r.oxide) === 'glass')
    .sort((a, b) => b.amount - a.amount)
  const otherRows = rows.filter((r) => group(r.oxide) === 'other')
    .sort((a, b) => b.amount - a.amount)

  // Max value across all columns to keep bars on the same scale
  const allRows = [...fluxRows, ...stabRows, ...glassRows, ...otherRows]
  const columnTotals = [
    fluxRows.reduce((a, r) => a + r.amount, 0),
    stabRows.reduce((a, r) => a + r.amount, 0),
    glassRows.reduce((a, r) => a + r.amount, 0),
  ]
  const maxVal = Math.max(...columnTotals, 1)

  if (allRows.length === 0) return null

  return (
    <div>
      <div className="flex gap-4 justify-start">
        <Column label="RO + R₂O" subtitle="Fluxes" rows={fluxRows} maxVal={maxVal} />
        <div className="w-px bg-neutral-200 self-stretch mx-1" />
        <Column label="R₂O₃" subtitle="Stabilizers" rows={[...stabRows, ...otherRows]} maxVal={maxVal} />
        <div className="w-px bg-neutral-200 self-stretch mx-1" />
        <Column label="RO₂" subtitle="Glass Formers" rows={glassRows} maxVal={maxVal} />
      </div>
      <p className="mt-2 text-[10px] text-neutral-400">
        Seger unity molecular formula — flux group (RO + R₂O) normalized to 1.0.
        Bar heights are proportional across all three columns on the same scale.
      </p>
    </div>
  )
}
