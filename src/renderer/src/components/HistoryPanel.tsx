import { useState, useEffect } from 'react'

interface HistoryEntry {
  id: string
  text: string
  timestamp: number
}

export default function HistoryPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    window.api.getHistory().then(setEntries)
  }, [])

  const handleCopy = async (entry: HistoryEntry): Promise<void> => {
    await window.api.copyToClipboard(entry.text)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const handlePaste = async (entry: HistoryEntry): Promise<void> => {
    await window.api.pasteAtCursor(entry.text)
  }

  const handleDelete = async (id: string): Promise<void> => {
    await window.api.deleteHistoryEntry(id)
    setEntries(entries.filter((e) => e.id !== id))
  }

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white flex flex-col rounded-2xl border border-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">History</h1>
        <p className="text-xs text-gray-500 mt-1">Press Alt+Shift+K to close</p>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 && (
          <p className="text-sm text-gray-500 text-center mt-8">No transcripts yet</p>
        )}

        {entries.map((entry) => (
          <div
            key={entry.id}
            className="group p-3 rounded-lg hover:bg-gray-900/50 mb-1 cursor-pointer"
            onClick={() => handlePaste(entry)}
          >
            <p className="text-sm text-gray-200 mb-2 line-clamp-3">{entry.text}</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{formatTime(entry.timestamp)}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCopy(entry)}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                >
                  {copiedId === entry.id ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
