import { useEffect, useState } from 'react'
import { loadNotebook, removeFromNotebook, updateNote, clearNotebook, type NotebookItem } from '../notebook'

// Group items by type for display
const TYPE_LABELS: Record<string, string> = {
  material: 'Materials', recipe: 'Recipes', oxide: 'Oxides', calc: 'Calculations'
}

interface Props {
  onClose: () => void
}

export function NotebookPanel({ onClose }: Props) {
  const [items, setItems] = useState<NotebookItem[]>(loadNotebook)

  useEffect(() => {
    const handler = () => setItems(loadNotebook())
    window.addEventListener('notebook-changed', handler)
    return () => window.removeEventListener('notebook-changed', handler)
  }, [])

  const byType = new Map<string, NotebookItem[]>()
  for (const item of items) {
    if (!byType.has(item.type)) byType.set(item.type, [])
    byType.get(item.type)!.push(item)
  }

  function handlePrint() {
    onClose()
    setTimeout(() => window.print(), 100)
  }

  return (
    // Fixed overlay: semi-transparent backdrop + right-side panel
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-neutral-900">Notebook</h2>
            <p className="text-xs text-neutral-400">{items.length} item{items.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <>
                <button
                  onClick={handlePrint}
                  className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                >
                  Print / PDF
                </button>
                <button
                  onClick={() => { if (confirm('Clear all notebook items?')) clearNotebook() }}
                  className="text-xs text-neutral-400 hover:text-red-500"
                >
                  Clear all
                </button>
              </>
            )}
            <button onClick={onClose} className="ml-1 text-xl text-neutral-400 hover:text-neutral-700">×</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {items.length === 0 && (
            <div className="py-12 text-center text-sm text-neutral-400">
              <p className="text-2xl mb-2">📋</p>
              <p>Your notebook is empty.</p>
              <p className="mt-1">Click "Add to notebook" on any material, recipe, or oxide.</p>
            </div>
          )}
          {['material', 'recipe', 'oxide', 'calc'].map((type) => {
            const group = byType.get(type)
            if (!group) return null
            return (
              <section key={type}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{TYPE_LABELS[type]}</h3>
                <div className="space-y-2">
                  {group.map((item) => (
                    <NotebookCard key={item.id} item={item} onRemove={() => removeFromNotebook(item.id)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NotebookCard({ item, onRemove }: { item: NotebookItem; onRemove: () => void }) {
  const [note, setNote] = useState(item.note)

  function handleNoteBlur() {
    updateNote(item.id, note)
  }

  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm text-neutral-900">{item.label}</span>
        <button onClick={onRemove} className="text-neutral-300 hover:text-red-400 text-sm leading-none flex-shrink-0">×</button>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={handleNoteBlur}
        placeholder="Add a note…"
        rows={2}
        className="mt-2 w-full resize-none rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 placeholder-neutral-300 focus:border-neutral-400 focus:outline-none"
      />
    </div>
  )
}
