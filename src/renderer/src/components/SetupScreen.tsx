import { useState } from 'react'

export default function SetupScreen(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    if (!apiKey.trim()) return
    setSaving(true)
    await window.api.saveSettings({ apiKey: apiKey.trim() })
    setSaving(false)
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white p-6 flex flex-col rounded-2xl border border-gray-800">
      <h1 className="text-lg font-semibold mb-1">Welcome to LocalTranscriber</h1>
      <p className="text-sm text-gray-400 mb-6">
        Enter your Soniox API key to get started. Get one at{' '}
        <span className="text-blue-400">console.soniox.com</span>.
      </p>

      <label className="text-sm text-gray-300 mb-2">API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="Paste your Soniox API key here"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-6"
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />

      <button
        onClick={handleSave}
        disabled={!apiKey.trim() || saving}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
      >
        {saving ? 'Saving...' : 'Save & Start'}
      </button>

      <p className="text-xs text-gray-600 mt-4 text-center">
        Your key is stored locally on this device only.
      </p>
    </div>
  )
}
