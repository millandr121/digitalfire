import type { OxideAnalysisRow } from '../types'

/** Monochrome horizontal bar chart of a material's oxide analysis (% by weight). */
export function AnalysisChart({ rows }: { rows: OxideAnalysisRow[] }) {
  const data = rows.filter((r) => r.analysis_pct != null)
  if (!data.length) return null
  const max = Math.max(...data.map((r) => r.analysis_pct as number), 1)
  return (
    <div className="space-y-1">
      {data.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-20 shrink-0 text-right font-mono text-neutral-500">{r.oxide}</div>
          <div className="flex-1 rounded bg-neutral-200">
            <div
              className="h-4 rounded bg-neutral-300"
              style={{ width: `${((r.analysis_pct as number) / max) * 100}%` }}
            />
          </div>
          <div className="w-14 shrink-0 text-right font-mono text-neutral-700">{r.analysis_pct}%</div>
        </div>
      ))}
    </div>
  )
}
