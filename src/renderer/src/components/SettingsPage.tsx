import { useState, useEffect } from 'react'

export default function SettingsPage(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
    })
  }, [])

  const handleSave = async (): Promise<void> => {
    await window.api.saveSettings({ apiKey: apiKey.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white p-6 flex flex-col rounded-2xl border border-gray-800">
      <h1 className="text-lg font-semibold mb-6">Settings</h1>

      <label className="text-sm text-gray-300 mb-2">Soniox API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => {
          setApiKey(e.target.value)
          setSaved(false)
        }}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
      />

      <button
        onClick={handleSave}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
      >
        {saved ? 'Saved!' : 'Save'}
      </button>

      <p className="text-xs text-gray-600 mt-4 text-center">
        Press Alt+Shift+L to start dictation. Alt+Shift+K for history.
      </p>
    </div>
  )
}
