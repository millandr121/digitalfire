import MiniSearch from 'minisearch'
import { openDB, type IDBPDatabase } from 'idb'
import type { Material, Mineral, Oxide, Recipe, Temperature } from './types'

export interface Dataset {
  materials: Material[]
  oxides: Oxide[]
  recipes: Recipe[]
  minerals: Mineral[]
  temperatures: Temperature[]
}

const STORES = ['materials', 'oxides', 'recipes'] as const

let dbPromise: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('digitalfire-edits', 1, {
      upgrade(d) {
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

function merge<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  const map = new Map(base.map((x) => [x.id, x]))
  for (const o of overrides) map.set(o.id, o)
  return [...map.values()]
}

async function fetchJson<T>(name: string): Promise<T> {
  const r = await fetch(`data/${name}.json`)
  if (!r.ok) throw new Error(`Failed to load ${name}.json`)
  return r.json()
}

/** Fetch D1 admin overrides (silently returns empty on error or local dev). */
async function fetchOverrides(): Promise<Record<string, Record<string, unknown | null>>> {
  try {
    const r = await fetch('/api/overrides')
    if (!r.ok) return {}
    return r.json()
  } catch {
    return {}
  }
}

function applyOverrides<T extends { id: string }>(base: T[], overrides: Record<string, unknown | null>): T[] {
  if (!overrides || Object.keys(overrides).length === 0) return base
  const result: T[] = []
  for (const item of base) {
    const ov = overrides[item.id]
    if (ov === null) continue  // admin-deleted
    if (ov !== undefined) result.push(ov as T)
    else result.push(item)
  }
  // Append admin-created records (not in base)
  const baseIds = new Set(base.map(x => x.id))
  for (const [id, ov] of Object.entries(overrides)) {
    if (!baseIds.has(id) && ov !== null) result.push(ov as T)
  }
  return result
}

/** Base JSON merged with admin D1 overrides, then user's local IndexedDB edits. */
export async function loadDataset(): Promise<Dataset> {
  const [materials, oxides, recipes, minerals, temperatures, adminOverrides] = await Promise.all([
    fetchJson<Material[]>('materials'),
    fetchJson<Oxide[]>('oxides'),
    fetchJson<Recipe[]>('recipes'),
    fetchJson<Mineral[]>('minerals'),
    fetchJson<Temperature[]>('temperatures'),
    fetchOverrides(),
  ])
  const d = await db()
  const [mEdits, oEdits, rEdits] = await Promise.all([
    d.getAll('materials'),
    d.getAll('oxides'),
    d.getAll('recipes'),
  ])
  return {
    materials: merge(applyOverrides(materials, adminOverrides.materials ?? {}), mEdits as Material[]),
    oxides: merge(applyOverrides(oxides, adminOverrides.oxides ?? {}), oEdits as Oxide[]),
    recipes: merge(applyOverrides(recipes, adminOverrides.recipes ?? {}), rEdits as Recipe[]),
    minerals,
    temperatures,
  }
}

export async function saveMaterial(m: Material): Promise<void> {
  await (await db()).put('materials', m)
}

export async function saveRecipe(r: Recipe): Promise<void> {
  await (await db()).put('recipes', r)
}

export async function editCount(): Promise<number> {
  const d = await db()
  const counts = await Promise.all(STORES.map((s) => d.count(s)))
  return counts.reduce((a, b) => a + b, 0)
}

/** Download the current (base + edits) dataset as a single JSON file. */
export function downloadJSON(ds: Dataset): void {
  const blob = new Blob([JSON.stringify(ds, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'digitalfire-dataset.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type SearchType = 'material' | 'oxide' | 'recipe' | 'mineral' | 'temperature'

export interface SearchDoc {
  id: string
  ref: string
  type: SearchType
  title: string
  subtitle: string
}

export function buildSearch(ds: Dataset): MiniSearch<SearchDoc> {
  const docs: SearchDoc[] = [
    ...ds.materials.map((m) => ({
      id: `material:${m.id}`,
      ref: m.id,
      type: 'material' as const,
      title: m.name,
      subtitle: m.description || m.alternate_names || '',
    })),
    ...ds.oxides.map((o) => ({
      id: `oxide:${o.id}`,
      ref: o.id,
      type: 'oxide' as const,
      title: `${o.symbol} — ${o.name}`,
      subtitle: o.name,
    })),
    ...ds.recipes.map((r) => ({
      id: `recipe:${r.id}`,
      ref: r.id,
      type: 'recipe' as const,
      title: `${r.code} — ${r.name}`,
      subtitle: r.name || '',
    })),
    ...ds.minerals.map((m) => ({
      id: `mineral:${m.id}`,
      ref: m.id,
      type: 'mineral' as const,
      title: m.name,
      subtitle: m.formula || '',
    })),
    ...ds.temperatures.map((t) => ({
      id: `temperature:${t.id}`,
      ref: t.id,
      type: 'temperature' as const,
      title: t.value,
      subtitle: t.event || '',
    })),
  ]
  const mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'subtitle'],
    storeFields: ['ref', 'type', 'title', 'subtitle'],
    searchOptions: { prefix: true, fuzzy: 0.1, boost: { title: 3 } },
  })
  mini.addAll(docs)
  return mini
}
