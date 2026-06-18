import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type MiniSearch from 'minisearch'
import { buildSearch, downloadJSON, loadDataset, saveMaterial, type Dataset, type SearchDoc } from './store'
import type { Material, Mineral, Oxide, Recipe, Temperature } from './types'
import { AnalysisChart } from './components/AnalysisChart'
import { MaterialForm } from './MaterialForm'
import { GlazeCalc } from './GlazeCalc'
import { ThermalCalc } from './ThermalCalc'
import { analysisToFormula, FLUX_OXIDES } from './chem'

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function go(path: string) {
  window.location.hash = path
}

function parseHash(hash: string): string[] {
  const h = hash.replace(/^#\/?/, '')
  return h ? h.split('/').map(decodeURIComponent) : []
}

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const hash = useHash()

  useEffect(() => {
    loadDataset().then(setDs).catch((e) => setError(String(e)))
  }, [])

  const search = useMemo(() => (ds ? buildSearch(ds) : null), [ds])

  const onSaveMaterial = async (m: Material) => {
    await saveMaterial(m)
    setDs(await loadDataset())
    go(`#/material/${encodeURIComponent(m.id)}`)
  }

  if (error) return <Centered>Failed to load data: {error}</Centered>
  if (!ds) return <Centered>Loading the archive…</Centered>

  return (
    <div className="flex min-h-full flex-col">
      <Header hash={hash} query={query} setQuery={setQuery} ds={ds} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {query.trim() && search ? (
          <SearchView search={search} query={query} onPick={() => setQuery('')} />
        ) : (
          <Routed hash={hash} ds={ds} onSaveMaterial={onSaveMaterial} />
        )}
      </main>
      <footer className="border-t border-neutral-200 px-4 py-3 text-center text-xs text-neutral-500">
        {ds.materials.length} materials · {ds.oxides.length} oxides · {ds.recipes.length} recipes · {ds.minerals.length} minerals · {ds.temperatures.length} temps ·{' '}
        factual data from digitalfire.com (Tony Hansen) — local archive
      </footer>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-full place-items-center text-neutral-500">{children}</div>
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded border border-neutral-200 p-4">{children}</div>
}

function Header({
  hash,
  query,
  setQuery,
  ds,
}: {
  hash: string
  query: string
  setQuery: (s: string) => void
  ds: Dataset
}) {
  const view = parseHash(hash)[0] || 'materials'
  const tabs: [string, string][] = [
    ['materials', 'Materials'],
    ['oxides', 'Oxides'],
    ['recipes', 'Recipes'],
    ['minerals', 'Minerals'],
    ['temperatures', 'Temperatures'],
    ['calc', 'Glaze Calc'],
    ['thermal', 'Thermal Exp'],
  ]
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <button
          onClick={() => { go('#/materials'); setQuery('') }}
          className="font-semibold tracking-tight text-neutral-900"
        >
          Ceramic Reference <span className="font-normal text-neutral-500">· local</span>
        </button>
        <nav className="flex gap-1 text-sm">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { go(`#/${key}`); setQuery('') }}
              className={`rounded px-2 py-1 ${
                view === key && !query.trim()
                  ? 'bg-neutral-200 text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          onClick={() => downloadJSON(ds)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-200"
          title="Export the full dataset (including your edits) as JSON"
        >
          Export
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search materials, oxides, recipes…"
          className="w-full rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-500 focus:outline-none sm:w-64"
        />
      </div>
    </header>
  )
}

function SearchView({
  search,
  query,
  onPick,
}: {
  search: MiniSearch<SearchDoc>
  query: string
  onPick: () => void
}) {
  const results = search.search(query).slice(0, 50)
  if (!results.length) return <p className="text-neutral-500">No matches for “{query}”.</p>
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
      {results.map((r: any) => (
        <li key={r.id}>
          <button
            onClick={() => { go(`#/${r.type}/${encodeURIComponent(r.ref)}`); onPick() }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
          >
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-neutral-500">{r.type}</span>
            <span className="text-neutral-900">{r.title}</span>
            <span className="truncate text-sm text-neutral-500">{r.subtitle}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Routed({
  hash,
  ds,
  onSaveMaterial,
}: {
  hash: string
  ds: Dataset
  onSaveMaterial: (m: Material) => void
}) {
  const [view, a, b] = parseHash(hash)
  switch (view || 'materials') {
    case 'material':
      return <MaterialDetail m={ds.materials.find((x) => x.id === a)} ds={ds} />
    case 'oxide':
      return <OxideDetail o={ds.oxides.find((x) => x.id === a)} />
    case 'recipe':
      return <RecipeDetail r={ds.recipes.find((x) => x.id === a)} ds={ds} />
    case 'oxides':
      return <OxideList items={ds.oxides} />
    case 'recipes':
      return <RecipeList items={ds.recipes} />
    case 'calc':
      return <GlazeCalc materials={ds.materials} oxides={ds.oxides} />
    case 'thermal':
      return <ThermalCalc oxides={ds.oxides} />
    case 'minerals':
      return <MineralList items={ds.minerals} />
    case 'mineral':
      return <MineralDetail m={ds.minerals.find((x) => x.id === a)} />
    case 'temperatures':
      return <TemperatureList items={ds.temperatures} />
    case 'temperature':
      return <TemperatureDetail t={ds.temperatures.find((x) => x.id === a)} />
    case 'new':
      if (a === 'material')
        return <MaterialForm oxides={ds.oxides} onSave={onSaveMaterial} onCancel={() => go('#/materials')} />
      return <MaterialList items={ds.materials} />
    case 'edit':
      if (a === 'material') {
        const m = ds.materials.find((x) => x.id === b)
        return (
          <MaterialForm
            initial={m}
            oxides={ds.oxides}
            onSave={onSaveMaterial}
            onCancel={() => go(m ? `#/material/${encodeURIComponent(m.id)}` : '#/materials')}
          />
        )
      }
      return <MaterialList items={ds.materials} />
    default:
      return <MaterialList items={ds.materials} />
  }
}

function ListHeader({
  title,
  count,
  total,
  filter,
  setFilter,
  onNew,
}: {
  title: string
  count: number
  total: number
  filter: string
  setFilter: (s: string) => void
  onNew?: () => void
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
      <span className="text-sm text-neutral-500">{count === total ? total : `${count} of ${total}`}</span>
      <div className="flex-1" />
      {onNew && (
        <button onClick={onNew} className="rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200">
          + New
        </button>
      )}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Filter ${title.toLowerCase()}…`}
        className="w-48 rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
      />
    </div>
  )
}

function MaterialList({ items }: { items: Material[] }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (m) => m.name.toLowerCase().includes(q) || (m.alternate_names || '').toLowerCase().includes(q),
    )
  }, [filter, items])
  return (
    <div>
      <ListHeader
        title="Materials"
        count={filtered.length}
        total={items.length}
        filter={filter}
        setFilter={setFilter}
        onNew={() => go('#/new/material')}
      />
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
        {filtered.slice(0, 400).map((m) => (
          <li key={m.id}>
            <button
              onClick={() => go(`#/material/${encodeURIComponent(m.id)}`)}
              className="w-full px-3 py-2 text-left hover:bg-neutral-50"
            >
              <div className="text-neutral-900">{m.name}</div>
              {m.description && <div className="truncate text-sm text-neutral-500">{m.description}</div>}
            </button>
          </li>
        ))}
      </ul>
      {filtered.length > 400 && (
        <p className="mt-2 text-xs text-neutral-500">Showing first 400 — refine the filter to narrow.</p>
      )}
    </div>
  )
}

function OxideList({ items }: { items: Oxide[] }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const filtered = q ? items.filter((o) => `${o.symbol} ${o.name}`.toLowerCase().includes(q)) : items
  return (
    <div>
      <ListHeader title="Oxides" count={filtered.length} total={items.length} filter={filter} setFilter={setFilter} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {filtered.map((o) => (
          <button
            key={o.id}
            onClick={() => go(`#/oxide/${encodeURIComponent(o.id)}`)}
            className="rounded border border-neutral-200 px-3 py-2 text-left hover:bg-neutral-50"
          >
            <div className="font-mono text-neutral-900">{o.symbol}</div>
            <div className="text-xs text-neutral-500">{o.name}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function RecipeList({ items }: { items: Recipe[] }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const filtered = q ? items.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q)) : items
  return (
    <div>
      <ListHeader title="Recipes" count={filtered.length} total={items.length} filter={filter} setFilter={setFilter} />
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
        {filtered.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => go(`#/recipe/${encodeURIComponent(r.id)}`)}
              className="w-full px-3 py-2 text-left hover:bg-neutral-50"
            >
              <span className="font-mono text-neutral-700">{r.code}</span>{' '}
              <span className="text-neutral-900">{r.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NotFound({ what }: { what: string }) {
  return (
    <p className="text-neutral-500">
      {what} not found.{' '}
      <button className="underline" onClick={() => go('#/')}>
        Back
      </button>
    </p>
  )
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <button onClick={() => go(to)} className="text-sm text-neutral-500 hover:text-neutral-700">
      ← {label}
    </button>
  )
}

function MaterialDetail({ m, ds }: { m: Material | undefined; ds: Dataset }) {
  if (!m) return <NotFound what="Material" />
  const sum = m.analysis.reduce((a, r) => a + (r.analysis_pct || 0), 0)
  const usedIn = ds.recipes.filter((r) =>
    r.materials.some((x) => x.material.toLowerCase() === m.name.toLowerCase())
  )
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/materials" label="Materials" />
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-900">{m.name}</h1>
          <button
            onClick={() => go(`#/edit/material/${encodeURIComponent(m.id)}`)}
            className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-200"
          >
            Edit
          </button>
        </div>
        {m.alternate_names && <p className="text-sm text-neutral-500">a.k.a. {m.alternate_names}</p>}
        {m.description && <p className="mt-1 text-neutral-700">{m.description}</p>}
      </div>

      {m.analysis.length > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm uppercase tracking-wide text-neutral-500">Oxide Analysis</h2>
            <span className="text-xs text-neutral-500">
              Σ {sum.toFixed(1)}% · formula wt {m.formula_weight ?? '—'}
            </span>
          </div>
          <AnalysisChart rows={m.analysis} />
        </Card>
      )}

      {Object.keys(m.properties).length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Properties</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {Object.entries(m.properties).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-neutral-100 py-1">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right text-neutral-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {usedIn.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Used in Recipes</h2>
          <ul className="divide-y divide-neutral-100 text-sm">
            {usedIn.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => go(`#/recipe/${encodeURIComponent(r.id)}`)}
                  className="w-full py-1.5 text-left hover:text-neutral-600"
                >
                  <span className="font-mono text-neutral-500">{r.code}</span>{' '}
                  <span className="text-neutral-800">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-neutral-400">Source: {m.source} · factual data only</p>
    </article>
  )
}

function OxideDetail({ o }: { o: Oxide | undefined }) {
  if (!o) return <NotFound what="Oxide" />
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/oxides" label="Oxides" />
        <h1 className="mt-1 font-mono text-2xl font-semibold text-neutral-900">{o.symbol}</h1>
        <p className="text-neutral-500">{o.name}</p>
      </div>
      {Object.keys(o.data).length > 0 ? (
        <Card>
          <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Data</h2>
          <dl className="space-y-1 text-sm">
            {Object.entries(o.data).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-neutral-100 py-1">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right text-neutral-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : (
        <p className="text-sm text-neutral-500">No tabulated data for this oxide.</p>
      )}
      <p className="text-xs text-neutral-400">Source: {o.source}</p>
    </article>
  )
}

function blendRecipe(r: Recipe, materials: Material[]) {
  const oxideTotals: Record<string, number> = {}
  let totalWeight = 0
  for (const line of r.materials) {
    const amt = line.amount ?? line.percent
    if (!amt || amt <= 0) continue
    const mat = materials.find((m) => m.name.toLowerCase() === line.material.toLowerCase())
    if (!mat) continue
    totalWeight += amt
    for (const row of mat.analysis) {
      if (row.analysis_pct == null) continue
      oxideTotals[row.oxide] = (oxideTotals[row.oxide] || 0) + (row.analysis_pct / 100) * amt
    }
  }
  if (totalWeight === 0) return null
  const analysisRows = Object.entries(oxideTotals).map(([oxide, total]) => ({
    oxide,
    analysis_pct: (total / totalWeight) * 100,
  }))
  const { formula, formulaWeight: fw } = analysisToFormula(analysisRows)
  const formulaMap = new Map(formula.map((r) => [r.oxide, r.amount]))
  const fluxOrder = [...FLUX_OXIDES, 'Al2O3', 'B2O3', 'SiO2', 'TiO2', 'Fe2O3', 'ZrO2', 'SnO2', 'P2O5']
  const rows = analysisRows
    .filter((r) => r.analysis_pct > 0.01)
    .sort((a, b) => {
      const ai = fluxOrder.indexOf(a.oxide), bi = fluxOrder.indexOf(b.oxide)
      if (ai === -1 && bi === -1) return a.oxide.localeCompare(b.oxide)
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
    .map(({ oxide, analysis_pct }) => ({
      oxide,
      pct: Math.round(analysis_pct * 10) / 10,
      unity: formulaMap.get(oxide) ?? null,
    }))
  return { rows, formulaWeight: fw }
}

function RecipeDetail({ r, ds }: { r: Recipe | undefined; ds: Dataset }) {
  if (!r) return <NotFound what="Recipe" />
  const findMat = (name: string) => ds.materials.find((m) => m.name.toLowerCase() === name.toLowerCase())
  const blend = useMemo(() => blendRecipe(r, ds.materials), [r, ds.materials])
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/recipes" label="Recipes" />
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
          <span className="font-mono text-neutral-500">{r.code}</span> {r.name}
        </h1>
        {r.description && <p className="mt-1 text-neutral-700">{r.description}</p>}
      </div>
      <Card>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Recipe</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1 font-normal">Material</th>
              <th className="py-1 text-right font-normal">Amount</th>
              <th className="py-1 text-right font-normal">%</th>
            </tr>
          </thead>
          <tbody>
            {r.materials.map((x, i) => {
              const mat = findMat(x.material)
              return (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1">
                    {mat ? (
                      <button
                        className="text-neutral-900 hover:underline"
                        onClick={() => go(`#/material/${encodeURIComponent(mat.id)}`)}
                      >
                        {x.material}
                      </button>
                    ) : (
                      <span className="text-neutral-700">{x.material}</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-neutral-700">{x.amount ?? ''}</td>
                  <td className="text-right font-mono text-neutral-500">{x.percent ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {blend && (
        <Card>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm uppercase tracking-wide text-neutral-500">Computed Unity Formula</h2>
            {blend.formulaWeight != null && (
              <span className="text-xs text-neutral-400">formula wt {blend.formulaWeight.toFixed(1)}</span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400">
                <th className="py-0.5 font-normal">Oxide</th>
                <th className="py-0.5 text-right font-normal">Unity</th>
                <th className="py-0.5 text-right font-normal">Wt %</th>
              </tr>
            </thead>
            <tbody>
              {blend.rows.map(({ oxide, pct, unity }) => (
                <tr key={oxide} className="border-t border-neutral-100">
                  <td className="py-0.5 font-mono text-neutral-700">{oxide}</td>
                  <td className="py-0.5 text-right font-mono text-neutral-900">
                    {unity != null ? unity.toFixed(3) : '—'}
                  </td>
                  <td className="py-0.5 text-right font-mono text-neutral-500">{pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-neutral-400">Source: {r.source}</p>
    </article>
  )
}

function MineralList({ items }: { items: Mineral[] }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const filtered = q ? items.filter((m) => `${m.name} ${m.formula}`.toLowerCase().includes(q)) : items
  return (
    <div>
      <ListHeader title="Minerals" count={filtered.length} total={items.length} filter={filter} setFilter={setFilter} />
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
        {filtered.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => go(`#/mineral/${encodeURIComponent(m.id)}`)}
              className="w-full px-3 py-2 text-left hover:bg-neutral-50"
            >
              <div className="text-neutral-900">{m.name}</div>
              <div className="font-mono text-xs text-neutral-500">{m.formula}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MineralDetail({ m }: { m: Mineral | undefined }) {
  if (!m) return <NotFound what="Mineral" />
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/minerals" label="Minerals" />
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{m.name}</h1>
        <p className="font-mono text-sm text-neutral-500">{m.formula}</p>
      </div>
      {m.analysis.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-500">Oxide Analysis</h2>
          <AnalysisChart rows={m.analysis} />
        </Card>
      )}
      {Object.keys(m.data).length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Data</h2>
          <dl className="space-y-1 text-sm">
            {Object.entries(m.data).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-neutral-100 py-1">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right text-neutral-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <p className="text-xs text-neutral-400">Source: {m.source}</p>
    </article>
  )
}

function TemperatureList({ items }: { items: Temperature[] }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const filtered = q ? items.filter((t) => `${t.value} ${t.event}`.toLowerCase().includes(q)) : items
  return (
    <div>
      <ListHeader title="Temperatures" count={filtered.length} total={items.length} filter={filter} setFilter={setFilter} />
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
        {filtered.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => go(`#/temperature/${encodeURIComponent(t.id)}`)}
              className="flex w-full gap-4 px-3 py-2 text-left hover:bg-neutral-50"
            >
              <span className="w-36 shrink-0 font-mono text-sm text-amber-700">{t.value}</span>
              <span className="text-sm text-neutral-700">{t.event}</span>
            </button>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && (
        <p className="mt-4 text-sm text-neutral-500">No temperature events found.</p>
      )}
    </div>
  )
}

function TemperatureDetail({ t }: { t: Temperature | undefined }) {
  if (!t) return <NotFound what="Temperature" />
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/temperatures" label="Temperatures" />
        <h1 className="mt-1 font-mono text-3xl font-semibold text-amber-700">{t.value}</h1>
        {t.event && <p className="mt-1 text-lg text-neutral-700">{t.event}</p>}
      </div>
      <p className="text-xs text-neutral-400">Source: {t.source}</p>
    </article>
  )
}
