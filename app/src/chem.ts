// chem.ts — ceramic oxide chemistry.
// Molecular weights are computed from each oxide's formula using standard
// atomic weights (public scientific constants). Conversions follow the
// classic Seger unity-molecular-formula method: flux (RO + R2O) moles are
// normalized to sum to 1.0.

const ATOMIC: Record<string, number> = {
  H: 1.008, Li: 6.94, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45,
  K: 39.098, Ca: 40.078, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922,
  Se: 78.971, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95,
  Cd: 112.414, Sn: 118.71, Sb: 121.76, Cs: 132.905, Ba: 137.327, La: 138.905,
  Ce: 140.116, Pr: 140.908, Nd: 144.242, Pb: 207.2, Bi: 208.98, Th: 232.038, U: 238.029,
}

// Oxides whose moles are normalized to unity (the RO + R2O flux bases).
export const FLUX_OXIDES = new Set<string>([
  'Li2O', 'Na2O', 'K2O', 'Rb2O', 'Cs2O', 'KNaO',
  'CaO', 'MgO', 'BaO', 'SrO', 'ZnO', 'PbO', 'MnO', 'FeO', 'CuO', 'CoO', 'NiO', 'CdO',
])

const NON_OXIDE = new Set(['LOI', 'Organics', 'Trace'])

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Molecular weight of an oxide symbol (e.g. "Al2O3" -> 101.96), or null if
 *  the symbol isn't a parseable formula of known elements. */
export function molecularWeight(symbol: string): number | null {
  if (!symbol || NON_OXIDE.has(symbol)) return null
  let total = 0
  let matched = ''
  const re = /([A-Z][a-z]?)(\d*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(symbol)) !== null) {
    if (!m[0]) break
    const aw = ATOMIC[m[1]]
    if (aw == null) return null
    total += aw * (m[2] ? parseInt(m[2], 10) : 1)
    matched += m[0]
  }
  if (matched !== symbol || total === 0) return null // stray chars e.g. "Free SiO2"
  return round(total, 2)
}

export interface AnalysisRow {
  oxide: string
  analysis_pct: number | null
}
export interface FormulaRow {
  oxide: string
  amount: number | null
}

/** Sum of all the analysis percentages present (a quality indicator: ~100). */
export function analysisTotal(rows: AnalysisRow[]): number {
  return round(rows.reduce((a, r) => a + (r.analysis_pct ?? 0), 0), 1)
}

/** Formula weight = Σ (unity amount × molecular weight). */
export function formulaWeight(rows: FormulaRow[]): number | null {
  let total = 0
  let any = false
  for (const r of rows) {
    const mw = molecularWeight(r.oxide)
    if (r.amount != null && mw) {
      total += r.amount * mw
      any = true
    }
  }
  return any ? round(total, 2) : null
}

/** Weight-% analysis → unity formula (fluxes normalized to 1.0) + formula weight. */
export function analysisToFormula(rows: AnalysisRow[]): {
  formula: FormulaRow[]
  formulaWeight: number | null
} {
  const moles = rows.map((r) => {
    const mw = molecularWeight(r.oxide)
    return { oxide: r.oxide, mol: r.analysis_pct != null && mw ? r.analysis_pct / mw : null }
  })
  const fluxSum = moles
    .filter((x) => FLUX_OXIDES.has(x.oxide) && x.mol != null)
    .reduce((a, x) => a + (x.mol as number), 0)
  const factor = fluxSum > 0 ? 1 / fluxSum : null
  const formula = moles.map((x) => ({
    oxide: x.oxide,
    amount: x.mol != null && factor != null ? round(x.mol * factor, 3) : null,
  }))
  return { formula, formulaWeight: factor != null ? formulaWeight(formula) : null }
}

/** Unity formula → weight-% analysis + formula weight. */
export function formulaToAnalysis(rows: FormulaRow[]): {
  analysis: AnalysisRow[]
  formulaWeight: number | null
} {
  const weights = rows.map((r) => {
    const mw = molecularWeight(r.oxide)
    return { oxide: r.oxide, w: r.amount != null && mw ? r.amount * mw : null }
  })
  const total = weights.reduce((a, x) => a + (x.w ?? 0), 0)
  const analysis = weights.map((x) => ({
    oxide: x.oxide,
    analysis_pct: x.w != null && total > 0 ? round((x.w / total) * 100, 2) : null,
  }))
  return { analysis, formulaWeight: total > 0 ? round(total, 2) : null }
}
