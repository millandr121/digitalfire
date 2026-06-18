import { useEffect, useState } from 'react'
import type { Material, Recipe } from './types'

const TOKEN_KEY = 'df-admin-token'

function getToken() { return localStorage.getItem(TOKEN_KEY) }
function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t) }
function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return r
}

// ── Login ─────────────────────────────────────────────────────────────────────

function Login({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr('')
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    if (r.ok) {
      const { token } = await r.json()
      setToken(token)
      onLogin()
    } else {
      setErr('Invalid password')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Admin Login</h1>
          <p className="mt-1 text-sm text-neutral-500">Ceramic Reference — Admin Panel</p>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Admin password"
          autoFocus
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <button
          type="submit"
          disabled={loading || !pw}
          className="w-full rounded bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ── Edit history ──────────────────────────────────────────────────────────────

interface OverrideRow {
  id: number
  section: string
  record_id: string
  data_json: string
  original_json: string | null
  is_new: number
  is_deleted: number
  edited_at: number
}

function History({ onRevert }: { onRevert: () => void }) {
  const [rows, setRows] = useState<OverrideRow[]>([])

  async function load() {
    const r = await api('/admin/history')
    if (r.ok) setRows(await r.json())
  }

  useEffect(() => { load() }, [])

  async function revert(row: OverrideRow) {
    if (!confirm(`Revert ${row.section}/${row.record_id} to original?`)) return
    await api(`/admin/${row.section}/${row.record_id}`, 'DELETE')
    onRevert()
    load()
  }

  if (!rows.length) return <p className="text-sm text-neutral-500">No overrides yet.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-2 font-normal">Section</th>
            <th className="py-2 font-normal">ID</th>
            <th className="py-2 font-normal">Status</th>
            <th className="py-2 font-normal">Edited</th>
            <th className="py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-100">
              <td className="py-1.5 font-mono text-xs text-neutral-600">{row.section}</td>
              <td className="py-1.5 font-mono text-xs text-neutral-800">{row.record_id}</td>
              <td className="py-1.5 text-xs">
                {row.is_deleted ? <span className="text-red-500">deleted</span>
                  : row.is_new ? <span className="text-blue-500">new</span>
                  : <span className="text-amber-500">edited</span>}
              </td>
              <td className="py-1.5 text-xs text-neutral-400">
                {new Date(row.edited_at * 1000).toLocaleString()}
              </td>
              <td className="py-1.5">
                {!row.is_deleted && (
                  <button onClick={() => revert(row)} className="text-xs text-red-400 hover:text-red-600">
                    {row.is_new ? 'Delete' : 'Revert to original'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Material editor ───────────────────────────────────────────────────────────

function MaterialEditor({ material, onSave, onCancel }: {
  material: Material | null
  onSave: () => void
  onCancel: () => void
}) {
  const blank: Material = {
    id: '', name: '', alternate_names: null, description: null,
    analysis: [], oxide_weight: null, formula_weight: null,
    properties: {}, source: 'admin',
  }
  const [form, setForm] = useState<Material>(material ?? blank)
  const [analysisText, setAnalysisText] = useState(
    (material?.analysis ?? []).map((r) => `${r.oxide} ${r.analysis_pct ?? ''}`).join('\n')
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function parseAnalysis(text: string) {
    return text.split('\n').flatMap((line) => {
      const [oxide, pct] = line.trim().split(/\s+/)
      if (!oxide) return []
      return [{ oxide, analysis_pct: pct ? parseFloat(pct) : null, formula: null, tolerance: null }]
    })
  }

  async function save() {
    if (!form.id || !form.name) { setErr('ID and Name are required'); return }
    setSaving(true)
    setErr('')
    const data = { ...form, analysis: parseAnalysis(analysisText) }
    const originalJson = material ? JSON.stringify(material) : null
    const path = material
      ? `/admin/materials/${encodeURIComponent(form.id)}${originalJson ? `?original=${encodeURIComponent(originalJson)}` : ''}`
      : '/admin/materials'
    const r = await api(path, material ? 'PUT' : 'POST', data)
    if (r.ok) {
      onSave()
    } else {
      const body = await r.json().catch(() => ({}))
      setErr((body as { error?: string }).error ?? 'Save failed')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-500">ID (slug)</label>
          <input
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            disabled={!!material}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm disabled:bg-neutral-100 focus:outline-none focus:border-neutral-500"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-neutral-500">Alternate names (semicolon-separated)</label>
          <input
            value={form.alternate_names ?? ''}
            onChange={(e) => setForm({ ...form, alternate_names: e.target.value || null })}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-neutral-500">
            Oxide analysis — one per line: <code className="text-xs">SiO2 45.6</code>
          </label>
          <textarea
            value={analysisText}
            onChange={(e) => setAnalysisText(e.target.value)}
            rows={8}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:border-neutral-500"
          />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded border border-neutral-300 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Recipe editor ─────────────────────────────────────────────────────────────

function RecipeEditor({ recipe, onSave, onCancel }: {
  recipe: Recipe | null
  onSave: () => void
  onCancel: () => void
}) {
  const blank: Recipe = { id: '', code: '', name: '', materials: [], source: 'admin' }
  const [form, setForm] = useState<Recipe>(recipe ?? blank)
  const [materialsText, setMaterialsText] = useState(
    (recipe?.materials ?? []).map((m) => `${m.material} ${m.amount ?? ''}`).join('\n')
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function parseMaterials(text: string) {
    return text.split('\n').flatMap((line) => {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 2) return []
      const amount = parseFloat(parts[parts.length - 1])
      const material = parts.slice(0, -1).join(' ')
      return [{ material, amount: isNaN(amount) ? null : amount, percent: null }]
    })
  }

  async function save() {
    if (!form.id) { setErr('ID is required'); return }
    setSaving(true)
    setErr('')
    const data = { ...form, materials: parseMaterials(materialsText) }
    const originalJson = recipe ? JSON.stringify(recipe) : null
    const path = recipe
      ? `/admin/recipes/${encodeURIComponent(form.id)}${originalJson ? `?original=${encodeURIComponent(originalJson)}` : ''}`
      : '/admin/recipes'
    const r = await api(path, recipe ? 'PUT' : 'POST', data)
    if (r.ok) {
      onSave()
    } else {
      const body = await r.json().catch(() => ({}))
      setErr((body as { error?: string }).error ?? 'Save failed')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-neutral-500">ID</label>
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
            disabled={!!recipe}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm disabled:bg-neutral-100 focus:outline-none focus:border-neutral-500" />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Code</label>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-500" />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-500" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-neutral-500">
            Ingredients — one per line: <code className="text-xs">Silica 325 20</code>
          </label>
          <textarea value={materialsText} onChange={(e) => setMaterialsText(e.target.value)}
            rows={8}
            className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:border-neutral-500" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded border border-neutral-300 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main Admin panel ──────────────────────────────────────────────────────────

type Tab = 'history' | 'materials' | 'recipes'

export function Admin() {
  const [authed, setAuthed] = useState(!!getToken())
  const [tab, setTab] = useState<Tab>('history')
  const [editingMaterial, setEditingMaterial] = useState<Material | 'new' | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | 'new' | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  if (!authed) return <Login onLogin={() => setAuthed(true)} />

  function refresh() { setRefreshKey(k => k + 1) }

  const TABS: [Tab, string][] = [['history', 'Edit History'], ['materials', 'Add Material'], ['recipes', 'Add Recipe']]

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Admin Panel</h1>
          <p className="text-sm text-neutral-500">Manage materials, recipes, and overrides</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="#/materials" className="text-sm text-neutral-500 hover:text-neutral-800">← Back to site</a>
          <button onClick={() => { clearToken(); setAuthed(false) }}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
            Sign out
          </button>
        </div>
      </div>

      <nav className="mb-6 flex gap-1 border-b border-neutral-200">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm ${tab === key ? 'border-b-2 border-neutral-900 font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-neutral-800">Active overrides</h2>
            <button onClick={refresh} className="text-xs text-neutral-400 hover:text-neutral-600">Refresh</button>
          </div>
          <History key={refreshKey} onRevert={refresh} />
        </div>
      )}

      {tab === 'materials' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-neutral-800">Create new material</h2>
          </div>
          {editingMaterial === null ? (
            <button onClick={() => setEditingMaterial('new')}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              + New material
            </button>
          ) : (
            <MaterialEditor
              material={editingMaterial === 'new' ? null : editingMaterial}
              onSave={() => { setEditingMaterial(null); refresh() }}
              onCancel={() => setEditingMaterial(null)}
            />
          )}
          <p className="text-xs text-neutral-400">
            To edit an existing material, navigate to it on the main site and use the Edit button there. (Coming soon)
          </p>
        </div>
      )}

      {tab === 'recipes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-neutral-800">Create new recipe</h2>
          </div>
          {editingRecipe === null ? (
            <button onClick={() => setEditingRecipe('new')}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              + New recipe
            </button>
          ) : (
            <RecipeEditor
              recipe={editingRecipe === 'new' ? null : editingRecipe}
              onSave={() => { setEditingRecipe(null); refresh() }}
              onCancel={() => setEditingRecipe(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
