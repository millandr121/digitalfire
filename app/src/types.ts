export interface OxideAnalysisRow {
  oxide: string
  analysis_pct: number | null
  formula: number | null
  tolerance: string | null
}

export interface Material {
  id: string
  name: string
  alternate_names: string | null
  description: string | null
  analysis: OxideAnalysisRow[]
  oxide_weight: number | null
  formula_weight: number | null
  properties: Record<string, string>
  source: string
}

export interface Oxide {
  id: string
  symbol: string
  name: string
  data: Record<string, string>
  source: string
}

export interface RecipeMaterial {
  material: string
  amount: number | null
  percent: number | null
}

export interface Recipe {
  id: string
  code: string
  name: string
  materials: RecipeMaterial[]
  source: string
  source_url?: string
}

export interface Mineral {
  id: string
  name: string
  formula: string
  analysis: OxideAnalysisRow[]
  oxide_weight: number | null
  formula_weight: number | null
  data: Record<string, string>
  source: string
}

export interface Temperature {
  id: string
  value: string
  event: string
  source: string
}
