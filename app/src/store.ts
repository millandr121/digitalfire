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

/** Base JSON merged with the user's local IndexedDB edits/additions. */
export async function loadDataset(): Promise<Dataset> {
  const [materials, oxides, recipes, minerals, temperatures] = await Promise.all([
    fetchJson<Material[]>('materials'),
    fetchJson<Oxide[]>('oxides'),
    fetchJson<Recipe[]>('recipes'),
    fetchJson<Mineral[]>('minerals'),
    fetchJson<Temperature[]>('temperatures'),
  ])
  const d = await db()
  const [mEdits, oEdits, rEdits] = await Promise.all([
    d.getAll('materials'),
    d.getAll('oxides'),
    d.getAll('recipes'),
  ])
  return {
    materials: merge(materials, mEdits as Material[]),
    oxides: merge(oxides, oEdits as Oxide[]),
    recipes: merge(recipes, rEdits as Recipe[]),
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

export type SearchType = 'material' | 'oxide' | 'recipe'

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
      subtitle: r.description || '',
    })),
  ]
  const mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'subtitle'],
    storeFields: ['ref', 'type', 'title', 'subtitle'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
  })
  mini.addAll(docs)
  return mini
}
