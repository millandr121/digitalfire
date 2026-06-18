import { useEffect, useState } from 'react'
import { addToNotebook, removeFromNotebook, isInNotebook, type NotebookItemType } from '../notebook'

interface Props {
  id: string
  type: NotebookItemType
  label: string
  data: Record<string, unknown>
}

export function AddToNotebook({ id, type, label, data }: Props) {
  const [inNb, setInNb] = useState(() => isInNotebook(id))

  useEffect(() => {
    const handler = () => setInNb(isInNotebook(id))
    window.addEventListener('notebook-changed', handler)
    return () => window.removeEventListener('notebook-changed', handler)
  }, [id])

  function toggle() {
    if (inNb) removeFromNotebook(id)
    else addToNotebook({ id, type, label, note: '', data })
  }

  return (
    <button
      onClick={toggle}
      className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
        inNb
          ? 'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700'
          : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-800'
      }`}
    >
      {inNb ? '✓ In notebook' : '+ Add to notebook'}
    </button>
  )
}
