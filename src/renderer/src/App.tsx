import { useState, useEffect } from 'react'
import RecordingPopup from './components/RecordingPopup'
import SetupScreen from './components/SetupScreen'
import SettingsPage from './components/SettingsPage'
import HistoryPanel from './components/HistoryPanel'

type View = 'setup' | 'idle' | 'recording' | 'history' | 'settings'

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('idle')

  useEffect(() => {
    window.api.onNavigate((newView) => {
      setView(newView as View)
    })
    return (): void => {
      window.api.removeAllListeners('navigate')
    }
  }, [])

  return (
    <div className="w-full h-full">
      {view === 'recording' && <RecordingPopup />}
      {view === 'setup' && <SetupScreen />}
      {view === 'settings' && <SettingsPage />}
      {view === 'history' && <HistoryPanel />}
    </div>
  )
}

export default App
