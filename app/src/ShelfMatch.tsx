import { useMemo, useState } from 'react'
import type { Material, Recipe } from './types'

function findMat(name: string, materials: Material[]): Material | undefined {
  const q = name.replace(/^\*/, '').trim().toLowerCase()
  let m = materials.find((x) => x.name.toLowerCase() === q)
  if (m) return m
  m = materials.find((x) =>
    (x.alternate_names || '').toLowerCase().split(/[;,]+/).map((s) => s.trim()).includes(q)
  )
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

interface RecipeMatch {
  recipe: Recipe
  have: number
  total: number
  missing: string[]
}

function scoreRecipes(shelf: Set<string>, recipes: Recipe[], materials: Material[]): RecipeMatch[] {
  return recipes
    .map((r) => {
      const total = r.materials.length
      const missing: string[] = []
      let have = 0
      for (const ing of r.materials) {
        const mat = findMat(ing.material, materials)
        if (mat && shelf.has(mat.id)) {
          have++
        } else {
          missing.push(ing.material)
        }
      }
      return { recipe: r, have, total, missing }
    })
    .filter((x) => x.total > 0 && x.have > 0)
    .sort((a, b) => b.have / b.total - a.have / a.total || b.have - a.have)
}

function go(hash: string) {
  window.location.hash = hash
}

export function ShelfMatch({ materials, recipes }: { materials: Material[]; recipes: Recipe[] }) {
  const [query, setQuery] = useState('')
  const [shelf, setShelf] = useState<Set<string>>(new Set())
  const [minPct, setMinPct] = useState(50)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return materials.slice().sort((a, b) => a.name.localeCompare(b.name))
    return materials
      .filter((m) =>
        m.name.toLowerCase().includes(q) ||
        (m.alternate_names || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [query, materials])

  const matches = useMemo(() => scoreRecipes(shelf, recipes, materials), [shelf, recipes, materials])

  const shown = matches.filter((x) => (x.have / x.total) * 100 >= minPct)

  function toggleMat(id: string) {
    setShelf((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Recipe Matcher</h1>
        <span className="text-xs text-neutral-500">What's on your shelf?</span>
      </div>

      <p className="text-sm text-neutral-500">
        Check off the materials you have on hand. The app will find recipes you can make (or nearly make) from your existing stock.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: material shelf picker */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700">Your materials ({shelf.size} selected)</h2>
            {shelf.size > 0 && (
              <button
                onClick={() => setShelf(new Set())}
                className="text-xs text-neutral-400 hover:text-neutral-600"
              >
                Clear all
              </button>
            )}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter materials…"
            className="w-full rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
          <div className="max-h-[420px] overflow-y-auto rounded border border-neutral-200 divide-y divide-neutral-100">
            {filtered.slice(0, 200).map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                  shelf.has(m.id) ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={shelf.has(m.id)}
                  onChange={() => toggleMat(m.id)}
                  className="accent-white"
                />
                <span className="flex-1">{m.name}</span>
                {shelf.has(m.id) && <span className="text-neutral-400 text-xs">✓</span>}
              </label>
            ))}
            {filtered.length > 200 && (
              <p className="px-3 py-2 text-xs text-neutral-400">Showing first 200 — refine the filter.</p>
            )}
          </div>
        </div>

        {/* Right: recipe matches */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700">
              Possible recipes
              {shown.length > 0 && <span className="ml-2 text-neutral-400">({shown.length})</span>}
            </h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">Min match</label>
              <select
                value={minPct}
                onChange={(e) => setMinPct(Number(e.target.value))}
                className="rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 focus:outline-none"
              >
                <option value={100}>100% — exact only</option>
                <option value={80}>80%+</option>
                <option value={60}>60%+</option>
                <option value={50}>50%+</option>
                <option value={1}>All partial</option>
              </select>
            </div>
          </div>

          {shelf.size === 0 ? (
            <div className="flex h-48 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-400">
              Select materials on the left to see matching recipes
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-400">
              No recipes match at {minPct}%+ — try lowering the threshold
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto space-y-2">
              {shown.map(({ recipe, have, total, missing }) => {
                const pct = Math.round((have / total) * 100)
                const complete = pct === 100
                return (
                  <div
                    key={recipe.id}
                    className="rounded border border-neutral-200 px-3 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => go(`#/recipe/${encodeURIComponent(recipe.id)}`)}
                        className="text-sm font-medium text-neutral-900 hover:underline text-left"
                      >
                        {recipe.name || recipe.code}
                      </button>
                      <span className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded ${
                        complete
                          ? 'bg-green-100 text-green-700'
                          : pct >= 80
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}>
                        {have}/{total}
                      </span>
                    </div>

                    {/* Match bar */}
                    <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${complete ? 'bg-green-500' : 'bg-neutral-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {!complete && missing.length > 0 && (
                      <p className="text-xs text-neutral-400">
                        Missing: {missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` +${missing.length - 4} more` : ''}
                      </p>
                    )}

                    {recipe.code && (
                      <p className="text-xs text-neutral-400">{recipe.code}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
