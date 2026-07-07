import { useState, useEffect } from 'react'

interface MicOption {
  deviceId: string
  label: string
}

export default function SettingsPage(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [micDeviceId, setMicDeviceId] = useState('')
  const [mics, setMics] = useState<MicOption[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
      setMicDeviceId(settings.micDeviceId || '')
    })

    const loadMics = async (): Promise<void> => {
      try {
        // Labels are only exposed after mic permission is granted, so open
        // (and immediately stop) a throwaway stream first.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const devices = await navigator.mediaDevices.enumerateDevices()
        stream.getTracks().forEach((track) => track.stop())
        setMics(
          devices
            .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unnamed microphone' }))
        )
      } catch (err) {
        console.error('[SETTINGS] Failed to enumerate microphones:', err)
      }
    }
    loadMics()
  }, [])

  const handleSave = async (): Promise<void> => {
    await window.api.saveSettings({ apiKey: apiKey.trim(), micDeviceId })
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

      <label className="text-sm text-gray-300 mb-2">Microphone</label>
      <select
        value={micDeviceId}
        onChange={(e) => {
          setMicDeviceId(e.target.value)
          setSaved(false)
        }}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
      >
        <option value="">Automatic (recommended)</option>
        {mics.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>

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
