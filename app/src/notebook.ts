export type NotebookItemType = 'material' | 'recipe' | 'oxide' | 'calc'

export interface NotebookItem {
  id: string         // unique key
  type: NotebookItemType
  label: string      // display name
  note: string       // user-editable note
  data: Record<string, unknown>  // raw data snapshot
  addedAt: number    // Date.now()
}

const KEY = 'df-notebook'

export function loadNotebook(): NotebookItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function saveNotebook(items: NotebookItem[]): void {
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function addToNotebook(item: Omit<NotebookItem, 'addedAt'>): void {
  const items = loadNotebook()
  if (items.find(x => x.id === item.id)) return // already in notebook
  saveNotebook([...items, { ...item, addedAt: Date.now() }])
  window.dispatchEvent(new CustomEvent('notebook-changed'))
}

export function removeFromNotebook(id: string): void {
  saveNotebook(loadNotebook().filter(x => x.id !== id))
  window.dispatchEvent(new CustomEvent('notebook-changed'))
}

export function updateNote(id: string, note: string): void {
  saveNotebook(loadNotebook().map(x => x.id === id ? { ...x, note } : x))
  window.dispatchEvent(new CustomEvent('notebook-changed'))
}

export function clearNotebook(): void {
  saveNotebook([])
  window.dispatchEvent(new CustomEvent('notebook-changed'))
}

export function isInNotebook(id: string): boolean {
  return loadNotebook().some(x => x.id === id)
}
