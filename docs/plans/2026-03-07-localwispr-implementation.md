# LocalWispr Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Windows desktop voice-to-text utility that streams spoken words directly to the user's cursor in real-time.

**Architecture:** Electron app with React+Tailwind renderer. Main process handles global shortcuts, Soniox WebSocket streaming, and keyboard simulation via nut.js. Renderer handles mic capture, waveform display, and UI views (popup, history, settings). Audio flows from renderer → main → Soniox, and tokens flow from Soniox → main → nut.js (typing) + renderer (display).

**Tech Stack:** electron-vite, React, TypeScript, Tailwind CSS, @nut-tree/nut-js, ws (WebSocket), Soniox stt-rt-v4

---

### Task 1: Project Scaffolding

**Goal:** Create the electron-vite project with React + TypeScript + Tailwind CSS.

**Step 1: Scaffold electron-vite project**

Run:
```bash
npm create @quick-start/electron@latest localwispr-app -- --template react-ts
```

Then move all generated files into the current project root (localtranscriber/).

**Step 2: Install dependencies**

```bash
npm install ws @nut-tree/nut-js electron-store
npm install -D @types/ws tailwindcss @tailwindcss/vite @electron/rebuild
```

**Step 3: Configure Tailwind CSS**

Add Tailwind to `src/renderer/src/assets/main.css`:
```css
@import "tailwindcss";
```

Add Tailwind vite plugin to `electron.vite.config.ts` renderer section:
```ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // ... main and preload stay the same
  renderer: {
    plugins: [tailwindcss()],
    // ... rest of renderer config
  }
})
```

**Step 4: Rebuild native modules for Electron**

```bash
npx @electron/rebuild
```

**Step 5: Verify it runs**

```bash
npm run dev
```

Expected: Electron window opens with default React template content.

**Step 6: Clean up template files**

Remove default template content from `src/renderer/src/App.tsx`. Replace with a minimal dark-themed shell:

```tsx
function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-gray-400">LocalWispr</p>
    </div>
  )
}
export default App
```

---

### Task 2: Data Store (Settings & History Persistence)

**Goal:** Create a simple JSON-file-based store for settings (API key) and history (past transcripts).

**Files:**
- Create: `src/main/store.ts`

**Step 1: Create the store module**

```ts
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const userDataPath = app.getPath('userData')

interface Settings {
  apiKey: string
}

interface HistoryEntry {
  id: string
  text: string
  timestamp: number
}

function readJSON<T>(filename: string, fallback: T): T {
  const filePath = path.join(userDataPath, filename)
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data) as T
  } catch {
    return fallback
  }
}

function writeJSON<T>(filename: string, data: T): void {
  const filePath = path.join(userDataPath, filename)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function getSettings(): Settings {
  return readJSON<Settings>('settings.json', { apiKey: '' })
}

export function saveSettings(settings: Settings): void {
  writeJSON('settings.json', settings)
}

export function getHistory(): HistoryEntry[] {
  return readJSON<HistoryEntry[]>('history.json', [])
}

export function addHistoryEntry(text: string): void {
  const history = getHistory()
  history.unshift({
    id: Date.now().toString(),
    text,
    timestamp: Date.now()
  })
  // Keep last 100 entries
  if (history.length > 100) history.length = 100
  writeJSON('history.json', history)
}

export function deleteHistoryEntry(id: string): void {
  const history = getHistory().filter(e => e.id !== id)
  writeJSON('history.json', history)
}
```

**Step 2: Verify** — Import in main/index.ts temporarily, call `getSettings()`, check no errors on `npm run dev`.

---

### Task 3: Preload Script & IPC Bridge

**Goal:** Set up the IPC bridge so renderer can communicate with main process securely.

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Define the IPC API**

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: { apiKey: string }) => ipcRenderer.invoke('save-settings', settings),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteHistoryEntry: (id: string) => ipcRenderer.invoke('delete-history-entry', id),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),

  // Recording
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  sendAudioChunk: (chunk: ArrayBuffer) => ipcRenderer.send('audio-chunk', chunk),

  // Events from main
  onTranscriptToken: (callback: (token: string, isFinal: boolean) => void) =>
    ipcRenderer.on('transcript-token', (_event, token, isFinal) => callback(token, isFinal)),
  onRecordingStateChange: (callback: (state: string) => void) =>
    ipcRenderer.on('recording-state', (_event, state) => callback(state)),

  // Navigation
  onNavigate: (callback: (view: string) => void) =>
    ipcRenderer.on('navigate', (_event, view) => callback(view)),

  // Remove listeners
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
}

contextBridge.exposeInMainWorld('api', api)
```

**Step 2: Add TypeScript types for the API**

Create `src/preload/index.d.ts`:
```ts
export interface ElectronAPI {
  getSettings: () => Promise<{ apiKey: string }>
  saveSettings: (settings: { apiKey: string }) => Promise<void>
  getHistory: () => Promise<Array<{ id: string; text: string; timestamp: number }>>
  deleteHistoryEntry: (id: string) => Promise<void>
  copyToClipboard: (text: string) => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  sendAudioChunk: (chunk: ArrayBuffer) => void
  onTranscriptToken: (callback: (token: string, isFinal: boolean) => void) => void
  onRecordingStateChange: (callback: (state: string) => void) => void
  onNavigate: (callback: (view: string) => void) => void
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
```

---

### Task 4: Main Process — Window, Tray, Shortcuts

**Goal:** Set up the main Electron window, system tray, and global keyboard shortcuts.

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Rewrite the main process entry**

```ts
import { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, clipboard, nativeImage, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getSettings, saveSettings, getHistory, addHistoryEntry, deleteHistoryEntry } from './store'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let currentView: 'setup' | 'idle' | 'recording' | 'history' | 'settings' = 'idle'

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: 320,
    height: 120,
    x: Math.round(screenWidth / 2 - 160),
    y: Math.round(screenHeight / 2 - 60),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Check if API key exists on ready
  mainWindow.webContents.on('did-finish-load', () => {
    const settings = getSettings()
    if (!settings.apiKey) {
      currentView = 'setup'
      mainWindow?.setSize(400, 300)
      mainWindow?.center()
      mainWindow?.show()
      mainWindow?.webContents.send('navigate', 'setup')
    }
  })
}

function createTray(): void {
  // Use a simple icon — create a 16x16 icon programmatically
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Start Dictation (Alt+Shift+L)', click: () => toggleRecording() },
    { label: 'History (Alt+Shift+K)', click: () => toggleHistory() },
    { type: 'separator' },
    { label: 'Settings', click: () => showSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('LocalWispr')
  tray.setContextMenu(contextMenu)
}

function registerShortcuts(): void {
  globalShortcut.register('Alt+Shift+L', () => toggleRecording())
  globalShortcut.register('Alt+Shift+K', () => toggleHistory())
}

function toggleRecording(): void {
  if (isRecording) {
    stopRecording()
  } else {
    startRecording()
  }
}

function startRecording(): void {
  const settings = getSettings()
  if (!settings.apiKey) {
    currentView = 'setup'
    mainWindow?.setSize(400, 300)
    mainWindow?.center()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('navigate', 'setup')
    return
  }

  isRecording = true
  currentView = 'recording'
  mainWindow?.setSize(320, 120)
  mainWindow?.center()
  mainWindow?.showInactive() // Show without stealing focus!
  mainWindow?.webContents.send('navigate', 'recording')
  mainWindow?.webContents.send('recording-state', 'recording')
}

function stopRecording(): void {
  isRecording = false
  currentView = 'idle'
  mainWindow?.webContents.send('recording-state', 'stopped')
  mainWindow?.hide()
}

function toggleHistory(): void {
  if (currentView === 'history') {
    currentView = 'idle'
    mainWindow?.hide()
  } else {
    currentView = 'history'
    mainWindow?.setSize(400, 500)
    mainWindow?.center()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('navigate', 'history')
  }
}

function showSettings(): void {
  currentView = 'settings'
  mainWindow?.setSize(400, 300)
  mainWindow?.center()
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send('navigate', 'settings')
}

// IPC Handlers
function setupIPC(): void {
  ipcMain.handle('get-settings', () => getSettings())
  ipcMain.handle('save-settings', (_event, settings) => {
    saveSettings(settings)
    currentView = 'idle'
    mainWindow?.hide()
  })
  ipcMain.handle('get-history', () => getHistory())
  ipcMain.handle('delete-history-entry', (_event, id) => deleteHistoryEntry(id))
  ipcMain.handle('copy-to-clipboard', (_event, text) => clipboard.writeText(text))
  ipcMain.handle('start-recording', () => startRecording())
  ipcMain.handle('stop-recording', () => stopRecording())
}

// App lifecycle
app.whenReady().then(() => {
  setupIPC()
  createWindow()
  createTray()
  registerShortcuts()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', (e: Event) => {
  e.preventDefault() // Keep app running in tray
})
```

**Step 2: Verify** — `npm run dev`. App should start, show nothing (hidden), tray icon appears, Alt+Shift+L shows a small window.

---

### Task 5: Recording Popup UI

**Goal:** Build the tiny dark draggable popup with mic icon and waveform animation.

**Files:**
- Create: `src/renderer/src/components/RecordingPopup.tsx`
- Create: `src/renderer/src/components/Waveform.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Create Waveform component**

```tsx
import { useEffect, useRef } from 'react'

interface WaveformProps {
  audioLevel: number // 0 to 1
  isActive: boolean
}

export default function Waveform({ audioLevel, isActive }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>(new Array(20).fill(0.05))

  useEffect(() => {
    if (!isActive) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const draw = () => {
      const bars = barsRef.current
      // Shift bars left and add new value
      bars.shift()
      bars.push(audioLevel * 0.8 + Math.random() * 0.2)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const barWidth = canvas.width / bars.length
      const centerY = canvas.height / 2

      bars.forEach((level, i) => {
        const barHeight = Math.max(2, level * canvas.height * 0.8)
        const x = i * barWidth + 2
        const y = centerY - barHeight / 2

        ctx.fillStyle = '#3b82f6'
        ctx.roundRect(x, y, barWidth - 4, barHeight, 2)
        ctx.fill()
      })

      animationId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animationId)
  }, [audioLevel, isActive])

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={40}
      className="opacity-90"
    />
  )
}
```

**Step 2: Create RecordingPopup component**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import Waveform from './Waveform'

export default function RecordingPopup() {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)

  const startAudioCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
      streamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)

      // Analyser for waveform visualization
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      // ScriptProcessor to capture PCM data and send to main
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      source.connect(processor)
      processor.connect(audioContext.destination)

      processor.onaudioprocess = (event) => {
        const float32Data = event.inputBuffer.getChannelData(0)
        // Convert Float32 to Int16 PCM
        const int16Data = new Int16Array(float32Data.length)
        for (let i = 0; i < float32Data.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Data[i]))
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        window.api.sendAudioChunk(int16Data.buffer)
      }

      // Update audio level for waveform
      const updateLevel = () => {
        if (!analyserRef.current) return
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        const avg = data.reduce((sum, val) => sum + val, 0) / data.length
        setAudioLevel(avg / 255)
        animFrameRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()

      setIsRecording(true)
    } catch (err) {
      console.error('Mic access error:', err)
    }
  }, [])

  const stopAudioCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    audioContextRef.current?.close()
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current = null
    audioContextRef.current = null
    analyserRef.current = null
    setIsRecording(false)
    setAudioLevel(0)
  }, [])

  useEffect(() => {
    // Listen for recording state changes from main
    window.api.onRecordingStateChange((state) => {
      if (state === 'recording') {
        startAudioCapture()
      } else if (state === 'stopped') {
        stopAudioCapture()
      }
    })

    return () => {
      stopAudioCapture()
      window.api.removeAllListeners('recording-state')
    }
  }, [startAudioCapture, stopAudioCapture])

  return (
    <div
      className="w-full h-full flex items-center gap-3 px-4 bg-gray-900/95 rounded-2xl border border-gray-700/50 backdrop-blur-sm select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Mic icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500/20' : 'bg-gray-700'}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isRecording ? '#ef4444' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>

      {/* Waveform */}
      <Waveform audioLevel={audioLevel} isActive={isRecording} />

      {/* Status text */}
      <span className="text-xs text-gray-400 whitespace-nowrap">
        {isRecording ? 'Recording...' : 'Starting...'}
      </span>
    </div>
  )
}
```

**Step 3: Update App.tsx to route between views**

```tsx
import { useState, useEffect } from 'react'
import RecordingPopup from './components/RecordingPopup'

type View = 'setup' | 'idle' | 'recording' | 'history' | 'settings'

function App(): JSX.Element {
  const [view, setView] = useState<View>('idle')

  useEffect(() => {
    window.api.onNavigate((newView) => {
      setView(newView as View)
    })
    return () => window.api.removeAllListeners('navigate')
  }, [])

  return (
    <div className="w-full h-full">
      {view === 'recording' && <RecordingPopup />}
      {view === 'setup' && <div className="p-4 bg-gray-950 text-white">Setup (coming next)</div>}
      {view === 'history' && <div className="p-4 bg-gray-950 text-white">History (coming next)</div>}
      {view === 'settings' && <div className="p-4 bg-gray-950 text-white">Settings (coming next)</div>}
    </div>
  )
}

export default App
```

**Step 4: Update renderer index.html** — make body transparent for the rounded popup:

In `src/renderer/index.html`, add to the body style:
```html
<body style="margin: 0; background: transparent; overflow: hidden;">
```

**Step 5: Verify** — `npm run dev`, press Alt+Shift+L. A small dark rounded popup should appear in the center with a mic icon. Press again to hide.

---

### Task 6: Soniox WebSocket Integration

**Goal:** Connect to Soniox, stream audio, receive transcription tokens.

**Files:**
- Create: `src/main/soniox.ts`
- Modify: `src/main/index.ts` (wire up audio IPC)

**Step 1: Create the Soniox client module**

```ts
import WebSocket from 'ws'

interface SonioxToken {
  text: string
  is_final: boolean
  start_ms?: number
  end_ms?: number
  confidence?: number
}

interface SonioxResponse {
  tokens: SonioxToken[]
  finished?: boolean
}

type TokenCallback = (text: string, isFinal: boolean) => void
type FinishCallback = (fullText: string) => void

export class SonioxClient {
  private ws: WebSocket | null = null
  private apiKey: string
  private onToken: TokenCallback
  private onFinish: FinishCallback
  private fullTranscript = ''
  private pendingText = ''

  constructor(apiKey: string, onToken: TokenCallback, onFinish: FinishCallback) {
    this.apiKey = apiKey
    this.onToken = onToken
    this.onFinish = onFinish
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
      this.fullTranscript = ''
      this.pendingText = ''

      this.ws.on('open', () => {
        // Send config as first message
        const config = {
          api_key: this.apiKey,
          model: 'stt-rt-v4',
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          enable_endpoint_detection: true
        }
        this.ws!.send(JSON.stringify(config))
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const response: SonioxResponse = JSON.parse(data.toString())

          if (response.finished) {
            this.onFinish(this.fullTranscript.trim())
            return
          }

          if (response.tokens && response.tokens.length > 0) {
            // Collect final tokens — these are confirmed words
            let newFinalText = ''
            let newPendingText = ''

            for (const token of response.tokens) {
              if (token.is_final) {
                newFinalText += token.text
              } else {
                newPendingText += token.text
              }
            }

            if (newFinalText) {
              // Calculate only the NEW text to type (diff from what we already typed)
              this.fullTranscript += newFinalText
              this.onToken(newFinalText, true)
            }

            if (newPendingText) {
              this.pendingText = newPendingText
              this.onToken(newPendingText, false)
            }
          }
        } catch (err) {
          console.error('Soniox parse error:', err)
        }
      })

      this.ws.on('error', (err) => {
        console.error('Soniox WebSocket error:', err)
        reject(err)
      })

      this.ws.on('close', () => {
        this.ws = null
      })
    })
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
    }
  }

  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send empty frame to signal end-of-audio
      this.ws.send('')
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
```

**Step 2: Wire up audio IPC and Soniox in main/index.ts**

Add to the main process (import SonioxClient, handle audio chunks):

```ts
import { SonioxClient } from './soniox'

let sonioxClient: SonioxClient | null = null

// In the startRecording function, after showing the window:
// Connect to Soniox
async function connectSoniox(): Promise<void> {
  const settings = getSettings()
  sonioxClient = new SonioxClient(
    settings.apiKey,
    (text, isFinal) => {
      // Send token to renderer for display
      mainWindow?.webContents.send('transcript-token', text, isFinal)

      // If final, type the text at cursor
      if (isFinal) {
        typeText(text) // We'll implement this in Task 7
      }
    },
    (fullText) => {
      // Recording finished — save to history
      if (fullText.trim()) {
        addHistoryEntry(fullText.trim())
      }
    }
  )

  await sonioxClient.connect()
}

// Handle audio chunks from renderer
ipcMain.on('audio-chunk', (_event, chunk: ArrayBuffer) => {
  if (sonioxClient) {
    sonioxClient.sendAudio(Buffer.from(chunk))
  }
})

// Update startRecording to call connectSoniox
// Update stopRecording to call sonioxClient.stop() and sonioxClient.disconnect()
```

Integrate these into the existing `startRecording()` and `stopRecording()` functions.

---

### Task 7: Text Insertion with nut.js

**Goal:** Type received transcription text at the user's cursor position.

**Files:**
- Create: `src/main/typing.ts`
- Modify: `src/main/index.ts`

**Step 1: Create the typing module**

```ts
import { keyboard } from '@nut-tree/nut-js'

// Configure nut.js for fast typing
keyboard.config.autoDelayMs = 0

export async function typeText(text: string): Promise<void> {
  try {
    await keyboard.type(text)
  } catch (err) {
    console.error('Typing error:', err)
    // Fallback: use clipboard paste
    const { clipboard } = await import('electron')
    clipboard.writeText(text)
    // Simulate Ctrl+V
    await keyboard.pressKey(/* Key.LeftControl, Key.V */)
    await keyboard.releaseKey(/* Key.LeftControl, Key.V */)
  }
}
```

**Note:** The exact import for Key enum depends on nut.js version. Check the installed version's API. The `keyboard.type(text)` function should handle most cases. The fallback clipboard approach is there for robustness.

**Step 2: Import and use in main/index.ts**

Replace the `typeText(text)` placeholder call with the real import.

**Step 3: Verify** — Open Notepad, press Alt+Shift+L, speak. Words should appear in Notepad. Press Alt+Shift+L again to stop.

---

### Task 8: Setup Screen & Settings UI

**Goal:** First-time API key entry screen + settings page accessible from tray.

**Files:**
- Create: `src/renderer/src/components/SetupScreen.tsx`
- Create: `src/renderer/src/components/SettingsPage.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Create SetupScreen**

```tsx
import { useState } from 'react'

export default function SetupScreen() {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    await window.api.saveSettings({ apiKey: apiKey.trim() })
    setSaving(false)
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white p-6 flex flex-col">
      <h1 className="text-lg font-semibold mb-1">Welcome to LocalWispr</h1>
      <p className="text-sm text-gray-400 mb-6">
        Enter your Soniox API key to get started. You can get one at soniox.com
      </p>

      <label className="text-sm text-gray-300 mb-2">API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="Enter your Soniox API key"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-6"
      />

      <button
        onClick={handleSave}
        disabled={!apiKey.trim() || saving}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
      >
        {saving ? 'Saving...' : 'Save & Start'}
      </button>
    </div>
  )
}
```

**Step 2: Create SettingsPage**

```tsx
import { useState, useEffect } from 'react'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
    })
  }, [])

  const handleSave = async () => {
    await window.api.saveSettings({ apiKey: apiKey.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white p-6 flex flex-col">
      <h1 className="text-lg font-semibold mb-6">Settings</h1>

      <label className="text-sm text-gray-300 mb-2">Soniox API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => { setApiKey(e.target.value); setSaved(false) }}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
      />

      <button
        onClick={handleSave}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
      >
        {saved ? 'Saved!' : 'Save'}
      </button>
    </div>
  )
}
```

**Step 3: Update App.tsx** — Add the new components to the view router:

```tsx
import SetupScreen from './components/SetupScreen'
import SettingsPage from './components/SettingsPage'

// In the return:
{view === 'setup' && <SetupScreen />}
{view === 'settings' && <SettingsPage />}
```

---

### Task 9: History Panel

**Goal:** Build the history view with copy and delete functionality.

**Files:**
- Create: `src/renderer/src/components/HistoryPanel.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Create HistoryPanel**

```tsx
import { useState, useEffect } from 'react'

interface HistoryEntry {
  id: string
  text: string
  timestamp: number
}

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    window.api.getHistory().then(setEntries)
  }, [])

  const handleCopy = async (entry: HistoryEntry) => {
    await window.api.copyToClipboard(entry.text)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const handleDelete = async (id: string) => {
    await window.api.deleteHistoryEntry(id)
    setEntries(entries.filter(e => e.id !== id))
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">History</h1>
        <p className="text-xs text-gray-500 mt-1">Press Alt+Shift+K to close</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 && (
          <p className="text-sm text-gray-500 text-center mt-8">No transcripts yet</p>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="group p-3 rounded-lg hover:bg-gray-900 mb-1">
            <p className="text-sm text-gray-200 mb-2 line-clamp-3">{entry.text}</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{formatTime(entry.timestamp)}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCopy(entry)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {copiedId === entry.id ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="text-xs text-red-400 hover:text-red-300"
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
```

**Step 2: Update App.tsx** — Add HistoryPanel:

```tsx
import HistoryPanel from './components/HistoryPanel'

// In the return:
{view === 'history' && <HistoryPanel />}
```

---

### Task 10: Auto-Start, Tray Icon & Packaging

**Goal:** Make the app auto-start with Windows, create a proper tray icon, and configure packaging.

**Files:**
- Modify: `src/main/index.ts`
- Modify: `package.json`

**Step 1: Add auto-start**

In main/index.ts, add to the `app.whenReady()` block:

```ts
app.setLoginItemSettings({
  openAtLogin: true,
  path: app.getPath('exe')
})
```

**Step 2: Create a tray icon**

Create a simple SVG mic icon and convert to nativeImage. Or use a 16x16 PNG icon file at `resources/icon.png`.

For now, create a programmatic icon in the `createTray()` function:

```ts
function createTray(): void {
  // Create a simple 16x16 mic icon
  const size = 16
  const canvas = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="1" width="4" height="8" rx="2" fill="white"/>
    <path d="M4 7v1a4 4 0 0 0 8 0V7" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="8" y1="12" x2="8" y2="15" stroke="white" stroke-width="1.5"/>
  </svg>`
  const icon = nativeImage.createFromBuffer(
    Buffer.from(canvas),
    { width: size, height: size }
  )
  // Fallback: use a simple empty icon if SVG doesn't work
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)

  // ... rest of tray setup
}
```

**Step 3: Configure electron-builder for packaging**

In `package.json`, ensure the build config exists (electron-vite includes this by default):

```json
{
  "build": {
    "appId": "com.localwispr.app",
    "productName": "LocalWispr",
    "win": {
      "target": ["nsis"],
      "icon": "resources/icon.png"
    },
    "nsis": {
      "oneClick": true,
      "allowToChangeInstallationDirectory": false
    }
  }
}
```

**Step 4: Build**

```bash
npm run build
```

This creates the distributable in the `dist/` folder.

---

### Task 11: Integration & Final Wiring

**Goal:** Connect all pieces together, ensure the full flow works end-to-end.

**Checklist:**
1. Alt+Shift+L starts recording → popup shows → mic captures → audio streams to Soniox → tokens come back → words typed at cursor → Alt+Shift+L stops → transcript saved to history
2. Alt+Shift+K opens history → shows past transcripts → copy/delete work → Alt+Shift+K closes
3. First launch shows setup → API key saved → app ready
4. Tray menu works → Settings opens → API key can be changed
5. App auto-starts with Windows
6. App stays in tray when all windows closed

**Key integration points to verify:**
- `showInactive()` keeps previous window focused during recording
- Audio chunks flow correctly from renderer → main → Soniox WebSocket
- nut.js types text in the previously focused window
- History persists across app restarts
- Window sizes are correct for each view (320x120 for recording, 400x500 for history, 400x300 for setup/settings)

---

## Notes for Implementation

- **nut.js + Electron:** Run `npx @electron/rebuild` after installing nut.js to ensure native modules are built for Electron's Node version.
- **ScriptProcessorNode deprecation:** ScriptProcessorNode is deprecated in favor of AudioWorklet. It still works in Electron. If issues arise, migrate to AudioWorklet.
- **Mic permissions:** Electron auto-grants mic permissions when `webPreferences.sandbox` is false. If issues arise, add a permission handler in main process.
- **Fallback for typing:** If nut.js doesn't work reliably, fall back to clipboard + Ctrl+V paste approach (save original clipboard, write text, simulate paste, restore clipboard).
- **Tray icon:** If programmatic SVG icon doesn't render, create a real 16x16 PNG file at `resources/icon.png`.
