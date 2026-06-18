import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type MiniSearch from 'minisearch'
import { buildSearch, downloadJSON, loadDataset, type Dataset, type SearchDoc } from './store'
import type { Material, Mineral, Oxide, Recipe, Temperature } from './types'
import { AnalysisChart } from './components/AnalysisChart'
import { StullChart, type StullPoint } from './components/StullChart'
import { UnityFormulaViz } from './components/UnityFormulaViz'
import { FiringTimeline, parseTempEvents } from './components/FiringTimeline'
import { GlazeCalc } from './GlazeCalc'
import { ThermalCalc } from './ThermalCalc'
import { ShelfMatch } from './ShelfMatch'
import { Admin } from './Admin'
import { analysisToFormula, FLUX_OXIDES } from './chem'
import { NotebookPanel } from './components/NotebookPanel'
import { PrintReport } from './components/PrintReport'
import { AddToNotebook } from './components/AddToNotebook'
import { loadNotebook } from './notebook'

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
  const [notebookOpen, setNotebookOpen] = useState(false)
  const [notebookCount, setNotebookCount] = useState(() => loadNotebook().length)

  useEffect(() => {
    const handler = () => setNotebookCount(loadNotebook().length)
    window.addEventListener('notebook-changed', handler)
    return () => window.removeEventListener('notebook-changed', handler)
  }, [])

  useEffect(() => {
    loadDataset().then(setDs).catch((e) => setError(String(e)))
  }, [])

  const search = useMemo(() => (ds ? buildSearch(ds) : null), [ds])

  if (error) return <Centered>Failed to load data: {error}</Centered>
  if (!ds) return <Centered>Loading the archive…</Centered>

  return (
    <>
      <PrintReport />
      <div className="flex min-h-full flex-col">
        <Header hash={hash} query={query} setQuery={setQuery} ds={ds} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {query.trim() && search ? (
            <SearchView search={search} query={query} onPick={() => setQuery('')} />
          ) : (
            <Routed hash={hash} ds={ds} />
          )}
        </main>
        <footer className="border-t border-neutral-200 px-4 py-3 text-center text-xs text-neutral-500">
          {ds.materials.length} materials · {ds.oxides.length} oxides · {ds.recipes.length} recipes · {ds.minerals.length} minerals · {ds.temperatures.length} temps ·{' '}
          factual data from digitalfire.com (Tony Hansen) — local archive
        </footer>
      </div>
      <button
        onClick={() => setNotebookOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-neutral-700 print:hidden"
      >
        <span>📋</span>
        <span>Notebook</span>
        {notebookCount > 0 && (
          <span className="rounded-full bg-white px-1.5 py-0.5 text-xs font-semibold text-neutral-900">
            {notebookCount}
          </span>
        )}
      </button>
      {notebookOpen && <NotebookPanel onClose={() => setNotebookOpen(false)} />}
    </>
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
    ['shelf', 'Recipe Matcher'],
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
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const q = query.trim()

  const raw = search.search(q)
  // Exact-title matches float to the top
  const exact = q.toLowerCase()
  const sorted = [...raw].sort((a: any, b: any) => {
    const aExact = a.title.toLowerCase().startsWith(exact) ? 0 : 1
    const bExact = b.title.toLowerCase().startsWith(exact) ? 0 : 1
    if (aExact !== bExact) return aExact - bExact
    return b.score - a.score
  })
  const filtered = typeFilter === 'all' ? sorted : sorted.filter((r: any) => r.type === typeFilter)
  const results = filtered.slice(0, 60)

  const TYPES = ['all', 'material', 'recipe', 'oxide', 'mineral', 'temperature'] as const

  if (!sorted.length) return <p className="text-neutral-500">No matches for &quot;{q}&quot;.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => {
          const count = t === 'all' ? sorted.length : sorted.filter((r: any) => r.type === t).length
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-neutral-800 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {t} <span className="opacity-70">({count})</span>
            </button>
          )
        })}
      </div>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
        {results.map((r: any) => (
          <li key={r.id}>
            <button
              onClick={() => { go(`#/${r.type}/${encodeURIComponent(r.ref)}`); onPick() }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
            >
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">{r.type}</span>
              <span className="font-medium text-neutral-900">{r.title}</span>
              {r.subtitle && r.subtitle !== r.title && (
                <span className="truncate text-sm text-neutral-400">{r.subtitle}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {filtered.length > 60 && (
        <p className="text-center text-xs text-neutral-400">Showing 60 of {filtered.length} — narrow your search</p>
      )}
    </div>
  )
}

function Routed({
  hash,
  ds,
}: {
  hash: string
  ds: Dataset
}) {
  const [view, a] = parseHash(hash)
  if (view === 'admin') return <Admin />
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
      return <RecipeList items={ds.recipes} ds={ds} />
    case 'calc':
      return <GlazeCalc materials={ds.materials} oxides={ds.oxides} recipes={ds.recipes} />
    case 'thermal':
      return <ThermalCalc oxides={ds.oxides} />
    case 'shelf':
      return <ShelfMatch materials={ds.materials} recipes={ds.recipes} />
    case 'minerals':
      return <MineralList items={ds.minerals} />
    case 'mineral':
      return <MineralDetail m={ds.minerals.find((x) => x.id === a)} ds={ds} />
    case 'temperatures':
      return <TemperatureList items={ds.temperatures} />
    case 'temperature':
      return <TemperatureDetail t={ds.temperatures.find((x) => x.id === a)} />
    case 'new':
    case 'edit':
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

function RecipeList({ items, ds }: { items: Recipe[]; ds: Dataset }) {
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'list' | 'stull'>('list')
  const q = filter.trim().toLowerCase()
  const filtered = q ? items.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q)) : items

  const stullPoints = useMemo(() => {
    if (view !== 'stull') return []
    return items
      .map((r) => recipeToStullPoint(r, ds.materials))
      .filter((p): p is StullPoint => p !== null)
  }, [view, items, ds.materials])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ListHeader title="Recipes" count={filtered.length} total={items.length} filter={filter} setFilter={setFilter} />
        <div className="ml-auto flex rounded border border-neutral-200 overflow-hidden text-xs">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 ${view === 'list' ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
          >
            List
          </button>
          <button
            onClick={() => setView('stull')}
            className={`px-3 py-1.5 ${view === 'stull' ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
          >
            Stull Chart
          </button>
        </div>
      </div>

      {view === 'list' ? (
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
      ) : (
        <div className="rounded border border-neutral-200 p-4">
          <p className="mb-3 text-xs text-neutral-500">
            {stullPoints.length} of {items.length} recipes plotted (requires material oxide data to compute unity formula).
            Hover a dot for recipe name and SiO₂/Al₂O₃ values. Click to open recipe.
          </p>
          <StullChart
            points={stullPoints}
            width={620}
            height={420}
            onPointClick={(p) => go(`#/recipe/${encodeURIComponent(p.id)}`)}
          />
        </div>
      )}
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
    r.materials.some((x) => findMaterial(x.material, ds.materials)?.id === m.id)
  )
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/materials" label="Materials" />
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-900">{m.name}</h1>
          <div className="flex items-center gap-2">
            <AddToNotebook
              id={m.id}
              type="material"
              label={m.name}
              data={{ analysis: m.analysis, alternate_names: m.alternate_names }}
            />
          </div>
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

// COE data for all oxides with published Appen coefficients (×10⁻⁶/°C)
// Source: digitalfire.com oxide data (Tony Hansen), same scale as ThermalCalc
const OXIDE_COE: Record<string, number> = {
  ZrO2: 0.020, SnO2: 0.020, MgO: 0.026, B2O3: 0.031, SiO2: 0.035,
  MnO: 0.050, Al2O3: 0.063, Li2O: 0.068, PbO: 0.083, ZnO: 0.094,
  Fe2O3: 0.125, BaO: 0.129, SrO: 0.130, TiO2: 0.144, CaO: 0.148,
  K2O: 0.331, KNaO: 0.359, Na2O: 0.387,
}

function OxideCOEChart({ symbol }: { symbol: string }) {
  const entries = Object.entries(OXIDE_COE).sort((a, b) => a[1] - b[1])
  const max = Math.max(...entries.map(([, v]) => v))
  const current = OXIDE_COE[symbol]
  if (!current) return null

  return (
    <Card>
      <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-500">
        Thermal Expansion (COE ×10⁻⁶/°C) — relative to other oxides
      </h2>
      <div className="space-y-1">
        {entries.map(([sym, coe]) => {
          const isThis = sym === symbol
          return (
            <div key={sym} className="flex items-center gap-2 text-xs">
              <div className={`w-14 shrink-0 text-right font-mono ${isThis ? 'font-bold text-blue-700' : 'text-neutral-500'}`}>
                {sym}
              </div>
              <div className="flex-1 rounded bg-neutral-100">
                <div
                  className={`h-3.5 rounded ${isThis ? 'bg-blue-500' : 'bg-neutral-300'}`}
                  style={{ width: `${(coe / max) * 100}%` }}
                />
              </div>
              <div className={`w-10 shrink-0 font-mono ${isThis ? 'font-bold text-blue-700' : 'text-neutral-400'}`}>
                {coe}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] text-neutral-400">
        Higher COE = more thermal expansion. Fluxes (Na₂O, K₂O) expand the most;
        glass formers (SiO₂, B₂O₃) and stabilizers (Al₂O₃) expand the least.
        Values are Appen additive method coefficients.
      </p>
    </Card>
  )
}

function OxideDetail({ o }: { o: Oxide | undefined }) {
  if (!o) return <NotFound what="Oxide" />
  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/oxides" label="Oxides" />
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold text-neutral-900">{o.symbol}</h1>
            <p className="text-neutral-500">{o.name}</p>
          </div>
          <AddToNotebook
            id={o.id}
            type="oxide"
            label={`${o.symbol} — ${o.name}`}
            data={{ symbol: o.symbol, name: o.name }}
          />
        </div>
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
      <OxideCOEChart symbol={o.symbol} />
      <p className="text-xs text-neutral-400">Source: {o.source}</p>
    </article>
  )
}

function findMaterial(name: string, materials: Material[]): Material | undefined {
  const q = name.replace(/^\*/, '').trim().toLowerCase()
  // 1. Exact match
  let m = materials.find((x) => x.name.toLowerCase() === q)
  if (m) return m
  // 2. Alternate names match
  m = materials.find((x) => (x.alternate_names || '').toLowerCase().split(/[;,]+/).map((s) => s.trim()).includes(q))
  if (m) return m
  // 3. Content in parentheses as canonical: "Silica 325 mesh (Silica)" → try "Silica"
  const paren = q.match(/\(([^)]+)\)/)
  if (paren) {
    const inner = paren[1].trim()
    m = materials.find((x) => x.name.toLowerCase() === inner)
    if (m) return m
  }
  // 4. Prefix match: query contains material name or vice versa (short names only, min 4 chars)
  m = materials.find((x) => {
    const n = x.name.toLowerCase()
    return n.length >= 4 && (q.startsWith(n) || n.startsWith(q))
  })
  return m
}

function blendRecipe(r: Recipe, materials: Material[]) {
  const oxideTotals: Record<string, number> = {}
  let totalWeight = 0
  for (const line of r.materials) {
    const amt = line.amount ?? line.percent
    if (!amt || amt <= 0) continue
    const mat = findMaterial(line.material, materials)
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

function recipeToStullPoint(r: Recipe, materials: Material[]): StullPoint | null {
  const blend = blendRecipe(r, materials)
  if (!blend) return null
  const sio2 = blend.rows.find((x) => x.oxide === 'SiO2')?.unity
  const al2o3 = blend.rows.find((x) => x.oxide === 'Al2O3')?.unity
  if (sio2 == null || al2o3 == null) return null
  return { id: r.id, label: r.code || r.name, sio2, al2o3 }
}

function RecipeDetail({ r, ds }: { r: Recipe | undefined; ds: Dataset }) {
  if (!r) return <NotFound what="Recipe" />
  const findMat = (name: string) => findMaterial(name, ds.materials)
  const blend = useMemo(() => blendRecipe(r, ds.materials), [r, ds.materials])

  // All recipe Stull points for context (computed lazily, only when blend is available)
  const allStullPoints = useMemo(() => {
    if (!blend) return []
    return ds.recipes
      .map((rec) => recipeToStullPoint(rec, ds.materials))
      .filter((p): p is StullPoint => p !== null)
      .map((p) => ({ ...p, highlighted: p.id === r.id }))
  }, [blend, ds.recipes, ds.materials, r.id])

  const unityRows = useMemo(() => {
    if (!blend) return []
    return blend.rows
      .filter((x) => x.unity != null && x.unity > 0)
      .map((x) => ({ oxide: x.oxide, amount: x.unity as number }))
  }, [blend])

  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/recipes" label="Recipes" />
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-900">
            <span className="font-mono text-neutral-500">{r.code}</span> {r.name}
          </h1>
          <AddToNotebook
            id={r.id}
            type="recipe"
            label={`${r.code} ${r.name}`.trim()}
            data={{ code: r.code, name: r.name, materials: r.materials, source_url: r.source_url }}
          />
        </div>
        {r.source_url && (
          <a
            href={r.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm text-blue-600 hover:underline"
          >
            Original on digitalfire.com ↗
          </a>
        )}
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

      {blend && unityRows.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-500">Unity Formula — Seger Groups</h2>
          <UnityFormulaViz formula={unityRows} />
        </Card>
      )}

      {allStullPoints.length > 0 && (
        <Card>
          <h2 className="mb-1 text-sm uppercase tracking-wide text-neutral-500">Stull Chart Position</h2>
          <p className="mb-3 text-xs text-neutral-400">
            Blue dot = this recipe. Grey dots = all other recipes with computable unity formula.
          </p>
          <StullChart points={allStullPoints} />
        </Card>
      )}

      <p className="text-xs text-neutral-400">Source: {r.source}</p>
    </article>
  )
}

const MINERAL_INFO: Record<string, { formula?: string; family: string; note?: string }> = {
  'Kaolinite':                  { formula: 'Al₂Si₂O₅(OH)₄',        family: 'Clay Minerals', note: 'Primary mineral in kaolin/china clay; fires to mullite above 980°C' },
  'Halloysite':                 { formula: 'Al₂Si₂O₅(OH)₄·2H₂O',   family: 'Clay Minerals', note: 'Tubular form of kaolinite; higher plasticity' },
  'Montmorillonite, Bentonite': { formula: '(Na,Ca)₀.₃(Al,Mg)₂Si₄O₁₀(OH)₂·nH₂O', family: 'Clay Minerals', note: 'Highly plastic smectite; main component of bentonite; used as plasticizer' },
  'Smectite':    { formula: '(Na,Ca)₀.₃(Al,Mg)₂Si₄O₁₀(OH)₂·nH₂O', family: 'Clay Minerals', note: 'Swelling clay group; includes bentonite and montmorillonite' },
  'Illite':      { formula: '(K,H₃O)(Al,Mg,Fe)₂(Si,Al)₄O₁₀(OH)₂', family: 'Clay Minerals', note: 'Common in fireclays and shales; non-swelling' },
  'Dickite':     { formula: 'Al₂Si₂O₅(OH)₄',  family: 'Clay Minerals', note: 'Polymorph of kaolinite' },
  'Nacrite':     { formula: 'Al₂Si₂O₅(OH)₄',  family: 'Clay Minerals', note: 'Polymorph of kaolinite' },
  'Nontronite':  { formula: 'Na₀.₃Fe₂³⁺Si₃AlO₁₀(OH)₂·4H₂O', family: 'Clay Minerals', note: 'Iron-rich smectite; contributes color' },
  'Hectorite':   { formula: 'Na₀.₃(Mg,Li)₃Si₄O₁₀(OH)₂', family: 'Clay Minerals', note: 'Magnesium lithium smectite; used in specialty ceramics' },
  'Saponite':    { formula: 'Ca₀.₂₅(Mg,Fe)₃(Si,Al)₄O₁₀(OH)₂·4H₂O', family: 'Clay Minerals' },
  'Attapulgite, Palygorskite': { formula: '(Mg,Al)₂Si₄O₁₀(OH)·4H₂O', family: 'Clay Minerals', note: 'Fibrous clay; used as binder and plasticizer' },
  'Sepiolite':   { formula: 'Mg₄Si₆O₁₅(OH)₂·6H₂O', family: 'Clay Minerals', note: 'Fibrous magnesium silicate; high surface area' },
  'Chlorite':    { formula: '(Mg,Fe)₃(Si,Al)₄O₁₀(OH)₂·(Mg,Fe)₃(OH)₆', family: 'Clay Minerals' },
  'Allophane':   { formula: 'Al₂O₃·SiO₂·2.5H₂O', family: 'Clay Minerals', note: 'Amorphous aluminosilicate; common in volcanic soils' },
  'Pyrophyllite':{ formula: 'Al₂Si₄O₁₀(OH)₂', family: 'Clay Minerals', note: 'Similar to talc; used in high-temperature refractory ceramics' },
  'Ball Clay':   { formula: '(Al-Si mixture)', family: 'Clay Minerals', note: 'Highly plastic secondary kaolin; contains illite, kaolinite, quartz; key body ingredient' },
  'Feldspar':    { formula: 'KAlSi₃O₈ / NaAlSi₃O₈ / CaAl₂Si₂O₈', family: 'Feldspars', note: 'Most important glaze flux mineral group; melts around cone 8–10' },
  'K-Feldspar':  { formula: 'KAlSi₃O₈', family: 'Feldspars', note: 'Orthoclase/microcline; major source of K₂O flux in glazes' },
  'Na-Feldspar': { formula: 'NaAlSi₃O₈', family: 'Feldspars', note: 'Albite end-member; source of Na₂O flux; lower melting than K-spar' },
  'Albite':      { formula: 'NaAlSi₃O₈', family: 'Feldspars', note: 'Sodium feldspar end-member; melts ~1100°C' },
  'Anorthite':   { formula: 'CaAl₂Si₂O₈', family: 'Feldspars', note: 'Calcium feldspar end-member; very refractory' },
  'Microcline, Anorthoclase': { formula: 'KAlSi₃O₈', family: 'Feldspars', note: 'Low-temperature triclinic K-feldspar polymorph' },
  'Sanidine':    { formula: '(K,Na)AlSi₃O₈', family: 'Feldspars', note: 'High-temperature monoclinic K-feldspar; volcanic origin' },
  'Plagioclase': { formula: 'NaAlSi₃O₈ → CaAl₂Si₂O₈', family: 'Feldspars', note: 'Continuous solid solution series from albite to anorthite' },
  'Oligoclase':  { formula: '(Na,Ca)(Al,Si)AlSi₂O₈', family: 'Feldspars', note: 'Plagioclase ~10–30% anorthite content' },
  'Celsian':     { formula: 'BaAl₂Si₂O₈', family: 'Feldspars', note: 'Barium feldspar; very refractory; low thermal expansion' },
  'Quartz':      { formula: 'SiO₂', family: 'Silica', note: 'Stable crystalline silica; undergoes inversion at 573°C — critical in body/glaze fit' },
  'Amorphous Silica': { formula: 'SiO₂', family: 'Silica', note: 'Non-crystalline; lower inversion risk than quartz' },
  'Chalcedony':  { formula: 'SiO₂', family: 'Silica', note: 'Microcrystalline quartz; cryptocrystalline texture' },
  'Quartzite':   { formula: 'SiO₂', family: 'Silica', note: 'Metamorphic rock composed almost entirely of quartz' },
  'Calcite':     { formula: 'CaCO₃', family: 'Carbonates', note: 'Main component of whiting; decomposes ~800°C releasing CO₂ to give CaO flux' },
  'Dolomite':    { formula: 'CaMg(CO₃)₂', family: 'Carbonates', note: 'Dual source of CaO + MgO flux; decomposes 750–900°C' },
  'Dolomitic Limestone, Dolostone': { formula: 'CaMg(CO₃)₂ + CaCO₃', family: 'Carbonates' },
  'Magnesite':   { formula: 'MgCO₃', family: 'Carbonates', note: 'Source of MgO; decomposes ~400°C' },
  'Aragonite':   { formula: 'CaCO₃', family: 'Carbonates', note: 'Metastable CaCO₃ polymorph; converts to calcite at ~400°C' },
  'Trona':       { formula: 'Na₃H(CO₃)₂·2H₂O', family: 'Carbonates', note: 'Natural soda ash; source of Na₂O flux' },
  'Azurite':     { formula: 'Cu₃(CO₃)₂(OH)₂', family: 'Carbonates', note: 'Blue copper carbonate; colorant mineral' },
  'Malachite':   { formula: 'Cu₂CO₃(OH)₂', family: 'Carbonates', note: 'Green copper carbonate; colorant mineral' },
  'Cerussite':   { formula: 'PbCO₃', family: 'Carbonates', note: 'Lead carbonate; historic glaze source — toxic' },
  'Witherite':   { formula: 'BaCO₃', family: 'Carbonates', note: 'Barium carbonate; source of BaO flux; toxic if soluble' },
  'Limestone':   { formula: 'CaCO₃', family: 'Carbonates', note: 'Sedimentary rock; raw calcium source; used in slips and bodies' },
  'Corundum':    { formula: 'Al₂O₃', family: 'Oxides', note: 'Pure alumina; extremely refractory (mp 2072°C); kiln furniture' },
  'Hematite':    { formula: 'Fe₂O₃', family: 'Oxides', note: 'Red iron oxide; strong red-brown colorant; fluxes at high temp' },
  'Magnetite':   { formula: 'Fe₃O₄', family: 'Oxides', note: 'Black iron oxide; fluxes at lower temps; speckle in reduction' },
  'Rutile':      { formula: 'TiO₂', family: 'Oxides', note: 'Titanium dioxide; opacifier and variegation agent in glazes' },
  'Anatase':     { formula: 'TiO₂', family: 'Oxides', note: 'Metastable TiO₂; converts irreversibly to rutile on firing' },
  'Brookite':    { formula: 'TiO₂', family: 'Oxides', note: 'Rare TiO₂ polymorph' },
  'Illmenite':   { formula: 'FeTiO₃', family: 'Oxides', note: 'Iron titanate; source of both Fe and Ti; used for texture/speckle' },
  'Cassiterite': { formula: 'SnO₂', family: 'Oxides', note: 'Tin oxide; traditional opacifier for majolica and tin-glazed earthenware' },
  'Baddeleyite': { formula: 'ZrO₂', family: 'Oxides', note: 'Natural zirconia; refractory opacifier; high chemical resistance' },
  'Brucite':     { formula: 'Mg(OH)₂', family: 'Oxides', note: 'Magnesium hydroxide; converts to MgO on firing' },
  'Gibbsite':    { formula: 'Al(OH)₃', family: 'Oxides', note: 'Aluminium hydroxide; found in bauxite; calcines to Al₂O₃' },
  'Bauxite':     { formula: 'Al(OH)₃ + AlO(OH) + Al₂O₃', family: 'Oxides', note: 'Main aluminium ore; contains gibbsite, boehmite, diaspore' },
  'Manganite':   { formula: 'MnO(OH)', family: 'Oxides', note: 'Manganese oxyhydroxide; colorant' },
  'Limonite':    { formula: 'FeO(OH)·nH₂O', family: 'Oxides', note: 'Hydrated iron oxide; yellow-brown colorant in natural clays' },
  'Talc':        { formula: 'Mg₃Si₄O₁₀(OH)₂', family: 'Sheet Silicates', note: 'Key MgO source; reduces crazing; important in low-fire bodies' },
  'Steatite':    { formula: 'Mg₃Si₄O₁₀(OH)₂', family: 'Sheet Silicates', note: 'Massive talc rock; excellent electrical insulator ceramics' },
  'Muscovite':   { formula: 'KAl₂(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Potash mica; contributes K₂O + Al₂O₃; common in granites' },
  'Biotite':     { formula: 'K(Mg,Fe)₃(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Iron-magnesium mica; decomposes before feldspars on firing' },
  'Lepidolite':  { formula: 'K(Li,Al)₃(AlSi)₄O₁₀(OH,F)₂', family: 'Sheet Silicates', note: 'Lithium mica; source of Li₂O flux; powerful melter' },
  'Phlogopite Mica': { formula: 'KMg₃(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Magnesium mica; refractory' },
  'Potash Mica': { formula: 'KAl₂(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Muscovite-type mica' },
  'Soda Mica':   { formula: 'NaAl₂(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Paragonite; sodium analogue of muscovite' },
  'Sericite':    { formula: 'KAl₂(AlSi₃O₁₀)(OH)₂', family: 'Sheet Silicates', note: 'Fine-grained muscovite; contributes flux and Al₂O₃' },
  'Mica':        { formula: '(K,Na,Ca)(Al,Mg,Fe)₂(Si,Al)₄O₁₀(OH)₂', family: 'Sheet Silicates', note: 'Platy silicate group; common in granites and metamorphic rocks' },
  'Tremolite':   { formula: 'Ca₂Mg₅Si₈O₂₂(OH)₂', family: 'Sheet Silicates', note: 'Calcium magnesium amphibole; refractory; asbestiform variety hazardous' },
  'Serpentine':  { formula: 'Mg₃Si₂O₅(OH)₄', family: 'Sheet Silicates', note: 'Hydrated magnesium silicate group; source of MgO' },
  'Chrysotile':  { formula: 'Mg₃Si₂O₅(OH)₄', family: 'Sheet Silicates', note: 'Fibrous serpentine (white asbestos) — hazardous' },
  'Asbestos':    { formula: '(Mg,Fe)₇Si₈O₂₂(OH)₂', family: 'Sheet Silicates', note: 'Fibrous silicate minerals — carcinogenic, regulated' },
  'Nepheline':   { formula: '(Na,K)AlSiO₄', family: 'Framework Silicates', note: 'Feldspathoid; active flux with no free silica — used in nepheline syenite' },
  'Leucite':     { formula: 'KAlSi₂O₆', family: 'Framework Silicates', note: 'Potassium feldspathoid; very low thermal expansion' },
  'Sodalite':    { formula: 'Na₈(AlSiO₄)₆Cl₂', family: 'Framework Silicates', note: 'Blue feldspathoid; chlorine-bearing' },
  'Zeolite':     { formula: '(Na,K,Ca)(AlSi)₂O₄·nH₂O', family: 'Framework Silicates', note: 'Porous aluminosilicates; used for ion exchange and catalysis' },
  'Anorthosite': { formula: '(Na,Ca)(Al,Si)AlSi₂O₈', family: 'Framework Silicates', note: 'Igneous rock dominated by plagioclase feldspar' },
  'Aplite':      { formula: '(K-Na-Al-Si)', family: 'Framework Silicates', note: 'Fine-grained granitic rock; feldspars + quartz; used as feldspar substitute' },
  'Granite':     { formula: '(K-Na-Al-Si-Ca)', family: 'Framework Silicates', note: 'Igneous rock; quartz + feldspar + mica; ground granite used in bodies' },
  'Pegmatite':   { formula: '(K-Na-Al-Si)', family: 'Framework Silicates', note: 'Coarse igneous rock; major source of potash feldspar and lithium minerals' },
  'Olivine':     { formula: '(Mg,Fe)₂SiO₄', family: 'Nesosilicates', note: 'Magnesium iron silicate; converts to forsterite + enstatite on firing' },
  'Fayalite':    { formula: 'Fe₂SiO₄', family: 'Nesosilicates', note: 'Iron olivine end-member; fluxes at lower temperatures' },
  'Kyanite':     { formula: 'Al₂SiO₅', family: 'Nesosilicates', note: 'Converts to mullite + silica above 1300°C; used in refractories' },
  'Andalusite':  { formula: 'Al₂SiO₅', family: 'Nesosilicates', note: 'Converts to mullite on firing; used in kiln furniture and refractories' },
  'Sillimanite': { formula: 'Al₂SiO₅', family: 'Nesosilicates', note: 'High-temperature Al₂SiO₅ polymorph; refractory' },
  'Mullite':     { formula: '3Al₂O₃·2SiO₂', family: 'Nesosilicates', note: 'Primary fired ceramic phase; forms from kaolin above 980°C; gives strength and whiteness' },
  'Willemite':   { formula: 'Zn₂SiO₄', family: 'Nesosilicates', note: 'Zinc silicate; crystallizes in zinc matte glazes at cone 6' },
  'Beryl':       { formula: 'Be₃Al₂Si₆O₁₈', family: 'Nesosilicates', note: 'Beryllium aluminosilicate; gem varieties include emerald and aquamarine' },
  'Wollastonite': { formula: 'CaSiO₃', family: 'Chain Silicates', note: 'Calcium metasilicate; promotes whiteness, reduces shrinkage; used in tile bodies' },
  'Diopside':    { formula: 'CaMgSi₂O₆', family: 'Chain Silicates', note: 'Calcium magnesium pyroxene; crystallizes in some high-fire glazes' },
  'Gypsum':      { formula: 'CaSO₄·2H₂O', family: 'Sulfates', note: 'Calcium sulfate dihydrate; primary material for plaster molds and bats' },
  'Gypsum, Calcium sulphate': { formula: 'CaSO₄·2H₂O', family: 'Sulfates' },
  'Selenite':    { formula: 'CaSO₄·2H₂O', family: 'Sulfates', note: 'Transparent crystalline gypsum form' },
  'Barytes, Barite': { formula: 'BaSO₄', family: 'Sulfates', note: 'Barium sulfate; dense, chemically inert; used as filler' },
  'Alunite':     { formula: 'KAl₃(SO₄)₂(OH)₆', family: 'Sulfates', note: 'Potassium aluminum sulfate mineral' },
  'Sylvite':     { formula: 'KCl', family: 'Halides', note: 'Potassium chloride; water soluble; minor K source' },
  'Kernite':     { formula: 'Na₂B₄O₆(OH)₂·3H₂O', family: 'Borates', note: 'Sodium borate mineral; key source of B₂O₃ for glazes' },
  'Boracite':    { formula: 'Mg₃B₇O₁₃Cl', family: 'Borates', note: 'Magnesium borate chloride; less common borate mineral' },
  'Hydroboracite': { formula: 'CaMgB₆O₁₁·6H₂O', family: 'Borates', note: 'Calcium magnesium borate' },
  'Borate Minerals': { formula: 'various Na/Ca/Mg borates', family: 'Borates', note: 'Group of boron-bearing minerals; essential for low-fire glazes' },
  'Iron Pyrite': { formula: 'FeS₂', family: 'Sulfides', note: "Fool's gold; causes bloating if present in clay body" },
  'Galena':      { formula: 'PbS', family: 'Sulfides', note: 'Lead sulfide ore; historic glaze source — highly toxic' },
  'Sphalerite':  { formula: 'ZnS', family: 'Sulfides', note: 'Zinc sulfide; zinc ore mineral' },
  'Bornite':     { formula: 'Cu₅FeS₄', family: 'Sulfides', note: 'Copper iron sulfide; copper ore' },
  'Berthierite': { formula: 'FeSb₂S₄', family: 'Sulfides' },
  'Stibnite':    { formula: 'Sb₂S₃', family: 'Sulfides', note: 'Antimony sulfide; toxic' },
  'Amblygonite': { formula: 'LiAlPO₄F', family: 'Phosphates', note: 'Lithium aluminium fluorophosphate; source of Li₂O flux' },
  'Monazite':    { formula: '(Ce,La,Nd,Th)PO₄', family: 'Phosphates', note: 'Rare earth phosphate; slightly radioactive' },
  'Vanadinite':  { formula: 'Pb₅(VO₄)₃Cl', family: 'Other', note: 'Lead vanadate chloride; orange-red mineral specimen' },
  'Organics':    { formula: '(variable)', family: 'Other', note: 'Organic matter in clays; burns out below 600°C; causes carbon coring if too fast' },
  'Shale':       { formula: '(Al-Si-Fe-Ca)', family: 'Other', note: 'Finely laminated clay-rich sedimentary rock; fired for brick and structural tile' },
  'Slate':       { formula: '(Al-Si-Fe)', family: 'Other', note: 'Low-grade metamorphic rock from shale; contains illite and chlorite' },
  'Laterite':    { formula: '(Fe,Al hydrous oxides)', family: 'Other', note: 'Tropical weathering product; rich in iron and aluminium oxides' },
}

const FAMILY_ORDER = [
  'Clay Minerals', 'Silica', 'Feldspars', 'Sheet Silicates', 'Framework Silicates',
  'Carbonates', 'Oxides', 'Nesosilicates', 'Chain Silicates',
  'Borates', 'Sulfates', 'Halides', 'Sulfides', 'Phosphates', 'Other',
]

function MineralList({ items }: { items: Mineral[] }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()

  const enriched = items.map((m) => ({ ...m, info: MINERAL_INFO[m.name] }))

  if (q) {
    const hits = enriched.filter((m) =>
      `${m.name} ${m.info?.formula ?? m.formula ?? ''} ${m.info?.note ?? ''}`.toLowerCase().includes(q)
    )
    return (
      <div className="space-y-3">
        <ListHeader title="Minerals" count={hits.length} total={items.length} filter={filter} setFilter={setFilter} />
        <div className="divide-y divide-neutral-100 rounded border border-neutral-200">
          {hits.map((m) => <MineralRow key={m.id} m={m} info={m.info} />)}
        </div>
      </div>
    )
  }

  const byFamily = new Map<string, typeof enriched>()
  for (const m of enriched) {
    const fam = m.info?.family ?? 'Other'
    if (!byFamily.has(fam)) byFamily.set(fam, [])
    byFamily.get(fam)!.push(m)
  }

  const families = FAMILY_ORDER.filter((f) => byFamily.has(f))

  return (
    <div className="space-y-3">
      <ListHeader title="Minerals" count={items.length} total={items.length} filter={filter} setFilter={setFilter} />
      <div className="space-y-2">
        {families.map((fam) => (
          <details key={fam} open={['Clay Minerals', 'Feldspars', 'Silica', 'Carbonates', 'Oxides'].includes(fam)}>
            <summary className="cursor-pointer select-none rounded bg-neutral-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-200">
              {fam} <span className="font-normal text-neutral-400">({byFamily.get(fam)!.length})</span>
            </summary>
            <div className="mt-1 divide-y divide-neutral-100 rounded border border-neutral-200">
              {byFamily.get(fam)!.map((m) => <MineralRow key={m.id} m={m} info={m.info} />)}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function MineralRow({ m, info }: { m: Mineral; info: typeof MINERAL_INFO[string] | undefined }) {
  const formula = info?.formula ?? m.formula
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-neutral-900">{m.name}</span>
        {formula && <span className="font-mono text-xs text-neutral-400">{formula}</span>}
      </div>
      {info?.note && <p className="mt-0.5 text-xs text-neutral-500">{info.note}</p>}
    </div>
  )
}

function MineralDetail({ m, ds }: { m: Mineral | undefined; ds: Dataset }) {
  if (!m) return <NotFound what="Mineral" />
  const info = MINERAL_INFO[m.name]
  const formula = info?.formula ?? m.formula
  const mq = m.name.toLowerCase()
  const related = ds.materials.filter((mat) => {
    const mn = mat.name.toLowerCase()
    return mn.includes(mq) || mq.includes(mn.replace(/\s*\(.*\)/, '').trim())
  }).slice(0, 8)

  return (
    <article className="space-y-4">
      <div>
        <BackLink to="#/minerals" label="Minerals" />
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{m.name}</h1>
        {formula && <p className="font-mono text-sm text-neutral-500">{formula}</p>}
        {info?.family && <p className="text-xs text-neutral-400">{info.family}</p>}
      </div>
      {info?.note && (
        <Card>
          <p className="text-sm text-neutral-700">{info.note}</p>
        </Card>
      )}
      {m.analysis.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-500">Oxide Analysis</h2>
          <AnalysisChart rows={m.analysis} />
        </Card>
      )}
      {related.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Related Materials in Database</h2>
          <ul className="space-y-1">
            {related.map((mat) => (
              <li key={mat.id}>
                <button onClick={() => go(`#/material/${mat.id}`)} className="text-sm text-neutral-700 hover:text-neutral-900 hover:underline">
                  {mat.name}
                </button>
              </li>
            ))}
          </ul>
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
  const events = useMemo(() => parseTempEvents(items), [items])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">Firing Temperature Events</h1>
        <p className="text-sm text-neutral-500">
          {items.length} temperature events — hover a marker to see what happens at each stage of a firing.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-500">Timeline (0–1400°C)</h2>
        <FiringTimeline events={events} />
      </Card>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-700">All events</span>
          <span className="text-sm text-neutral-500">{filtered.length === items.length ? items.length : `${filtered.length} of ${items.length}`}</span>
          <div className="flex-1" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter events…"
            className="w-48 rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded border border-neutral-200">
          {filtered.sort((a, b) => {
            const na = parseInt(a.value) || 0
            const nb = parseInt(b.value) || 0
            return na - nb
          }).map((t) => (
            <li key={t.id} className="flex gap-4 px-3 py-2">
              <span className="w-36 shrink-0 font-mono text-sm text-amber-700">{t.value}</span>
              <span className="text-sm text-neutral-700">{t.event}</span>
            </li>
          ))}
        </ul>
      </div>
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
