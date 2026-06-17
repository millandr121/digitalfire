// Throwaway validation of the chemistry engine against known digitalfire values.
import { molecularWeight, analysisToFormula, formulaToAnalysis } from './app/src/chem.ts'

const mwChecks = [
  ['SiO2', 60.08], ['Al2O3', 101.96], ['CaO', 56.08], ['Na2O', 61.98],
  ['B2O3', 69.62], ['Fe2O3', 159.69], ['K2O', 94.2], ['TiO2', 79.87],
  ['Free SiO2', null], ['LOI', null],
]
console.log('-- molecular weights --')
for (const [sym, exp] of mwChecks) {
  const got = molecularWeight(sym)
  console.log(`${sym.padEnd(11)} ${String(got).padStart(7)}  expect ${exp}  ${got === exp ? 'OK' : '*** CHECK'}`)
}

console.log('\n-- Fusion Frit F-12: analysis % -> unity formula --')
const f = analysisToFormula([
  { oxide: 'CaO', analysis_pct: 20 },
  { oxide: 'Na2O', analysis_pct: 10.4 },
  { oxide: 'B2O3', analysis_pct: 23.8 },
  { oxide: 'Al2O3', analysis_pct: 0.8 },
  { oxide: 'SiO2', analysis_pct: 45 },
])
for (const r of f.formula) console.log(`  ${r.oxide.padEnd(6)} ${r.amount}`)
console.log('  formula weight:', f.formulaWeight, '(digitalfire shows 190.75)')

console.log('\n-- round-trip: unity formula -> analysis % --')
const back = formulaToAnalysis(f.formula)
for (const r of back.analysis) console.log(`  ${r.oxide.padEnd(6)} ${r.analysis_pct}%`)
