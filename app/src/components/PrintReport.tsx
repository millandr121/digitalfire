import { useEffect, useState } from 'react'
import { loadNotebook, type NotebookItem } from '../notebook'

export function PrintReport() {
  const [items, setItems] = useState<NotebookItem[]>(loadNotebook)

  useEffect(() => {
    const handler = () => setItems(loadNotebook())
    window.addEventListener('notebook-changed', handler)
    return () => window.removeEventListener('notebook-changed', handler)
  }, [])

  if (items.length === 0) return null

  const materials = items.filter(x => x.type === 'material')
  const recipes = items.filter(x => x.type === 'recipe')
  const oxides = items.filter(x => x.type === 'oxide')
  const calcs = items.filter(x => x.type === 'calc')

  return (
    <div className="hidden print:block font-sans text-black">
      {/* Report header */}
      <div className="mb-6 border-b-2 border-black pb-4">
        <h1 className="text-2xl font-bold">Ceramic Reference Report</h1>
        <p className="text-sm text-gray-500">Prepared from Digitalfire ceramic database · {new Date().toLocaleDateString()}</p>
      </div>

      {/* Materials section */}
      {materials.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold border-b border-gray-300 pb-1">Materials</h2>
          {materials.map((item) => {
            const analysis: { oxide: string; analysis_pct: number | null }[] = (item.data.analysis as any[]) || []
            return (
              <div key={item.id} className="mb-6">
                <h3 className="font-semibold text-base">{item.label}</h3>
                {item.note && <p className="text-sm italic text-gray-600 mt-0.5">{item.note}</p>}
                {analysis.length > 0 && (
                  <table className="mt-2 w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-1 text-left font-medium">Oxide</th>
                        <th className="border border-gray-300 px-2 py-1 text-right font-medium">Wt %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.filter((r) => r.analysis_pct != null && r.analysis_pct > 0).map((r) => (
                        <tr key={r.oxide}>
                          <td className="border border-gray-300 px-2 py-0.5 font-mono">{r.oxide}</td>
                          <td className="border border-gray-300 px-2 py-0.5 text-right font-mono">{(r.analysis_pct ?? 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Recipes section */}
      {recipes.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold border-b border-gray-300 pb-1">Recipes</h2>
          {recipes.map((item) => {
            const mats: { material: string; amount: number | null; percent: number | null }[] = (item.data.materials as any[]) || []
            return (
              <div key={item.id} className="mb-6">
                <h3 className="font-semibold">{item.label}</h3>
                {!!item.data.code && <p className="text-xs text-gray-500">Code: {String(item.data.code)}</p>}
                {item.note && <p className="text-sm italic text-gray-600 mt-0.5">{item.note}</p>}
                {mats.length > 0 && (
                  <table className="mt-2 w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-1 text-left font-medium">Material</th>
                        <th className="border border-gray-300 px-2 py-1 text-right font-medium">Amount</th>
                        {mats.some(m => m.percent != null) && <th className="border border-gray-300 px-2 py-1 text-right font-medium">%</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mats.map((m, i) => (
                        <tr key={i}>
                          <td className="border border-gray-300 px-2 py-0.5">{m.material}</td>
                          <td className="border border-gray-300 px-2 py-0.5 text-right font-mono">{m.amount ?? '—'}</td>
                          {mats.some(x => x.percent != null) && <td className="border border-gray-300 px-2 py-0.5 text-right font-mono">{m.percent != null ? `${m.percent.toFixed(1)}%` : '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Oxides section */}
      {oxides.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold border-b border-gray-300 pb-1">Oxides</h2>
          {oxides.map((item) => (
            <div key={item.id} className="mb-3">
              <h3 className="font-semibold">{item.label}</h3>
              {!!item.data.symbol && <p className="font-mono text-sm text-gray-600">{String(item.data.symbol)}</p>}
              {item.note && <p className="text-sm italic text-gray-600">{item.note}</p>}
            </div>
          ))}
        </section>
      )}

      {/* Calculations section */}
      {calcs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold border-b border-gray-300 pb-1">Calculations</h2>
          {calcs.map((item) => {
            const rows: { oxide: string; unity: number | null; analysisPct: number }[] = (item.data.blend as any[]) || []
            return (
              <div key={item.id} className="mb-6">
                <h3 className="font-semibold">{item.label}</h3>
                {item.note && <p className="text-sm italic text-gray-600">{item.note}</p>}
                {rows.length > 0 && (
                  <table className="mt-2 w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-1 text-left font-medium">Oxide</th>
                        <th className="border border-gray-300 px-2 py-1 text-right font-medium">Wt %</th>
                        <th className="border border-gray-300 px-2 py-1 text-right font-medium">Unity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.oxide}>
                          <td className="border border-gray-300 px-2 py-0.5 font-mono">{r.oxide}</td>
                          <td className="border border-gray-300 px-2 py-0.5 text-right font-mono">{r.analysisPct.toFixed(2)}</td>
                          <td className="border border-gray-300 px-2 py-0.5 text-right font-mono">{r.unity != null ? r.unity.toFixed(3) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {item.data.fluxSum != null && (
                  <p className="mt-1 text-xs text-gray-600">Flux sum: {(item.data.fluxSum as number).toFixed(3)}</p>
                )}
              </div>
            )
          })}
        </section>
      )}

      <div className="mt-8 border-t border-gray-300 pt-2 text-xs text-gray-400">
        Data sourced from digitalfire.com (Tony Hansen). Scientific facts are in the public domain.
      </div>
    </div>
  )
}
