import {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  nativeImage,
  screen,
  session
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getSettings, saveSettings, getHistory, addHistoryEntry, deleteHistoryEntry } from './store'
import { SonioxClient } from './soniox'
import {
  streamType,
  resetTyping,
  pasteText,
  saveFocusedWindow,
  restoreFocusedWindow
} from './typing'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let currentView: 'setup' | 'idle' | 'recording' | 'history' | 'settings' = 'idle'
let sonioxClient: SonioxClient | null = null
let audioSampleRate = 48000
let recordingSessionId = 0 // Track sessions to ignore stale audio
let sonioxConnecting = false // Guard against double mic-ready
const RECORDING_POPUP_WIDTH = 130
const RECORDING_POPUP_HEIGHT = 34

function centerWindowOnActiveDisplay(width: number, height: number): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursorPoint)

  mainWindow?.setBounds({
    width,
    height,
    x: Math.round(workArea.x + workArea.width / 2 - width / 2),
    y: Math.round(workArea.y + workArea.height / 2 - height / 2)
  })
}

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    x: Math.round(screenWidth / 2 - 200),
    y: Math.round(screenHeight / 2 - 150),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // Auto-grant mic permission
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(false)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[MAIN] Window loaded')
    const settings = getSettings()

    if (!settings.apiKey) {
      currentView = 'setup'
      mainWindow?.setSize(400, 300)
      mainWindow?.center()
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.webContents.send('navigate', 'setup')
      console.log('[MAIN] Showing setup screen (no API key)')
    } else {
      console.log('[MAIN] API key found, app ready in tray')
    }
  })

  // If recording popup steals focus (e.g. user drags it), give focus back immediately
  mainWindow.on('focus', () => {
    if (currentView === 'recording') {
      restoreFocusedWindow()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray(): void {
  const iconDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'mklEQVQ4T2NkoBAwUqifYdAb8P9/A8N/BkYGRkZGBgYGJob/DAz/GZgYGf4zMjIwMDMz' +
    'MDAxMzEwsbAwMDGzMDCxsDIwsbIxMLGyMzCxcTAwsXMyMLFxMTCx8zAwcfAwMHHyMjBx' +
    '8TMw8QkyMPELMzDxizAw8YsyMPGLMTDxSzAw8UsyMAlIMTAJSDMwCcgwMAnKMjABAOJH' +
    'GRG2h8bTAAAAAElFTkSuQmCC'

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromDataURL(iconDataUrl)
  } catch {
    icon = nativeImage.createEmpty()
  }

  if (icon.isEmpty()) {
    const size = 16
    const buffer = Buffer.alloc(size * size * 4, 0)
    for (let i = 0; i < size * size; i++) {
      buffer[i * 4] = 59
      buffer[i * 4 + 1] = 130
      buffer[i * 4 + 2] = 246
      buffer[i * 4 + 3] = 255
    }
    icon = nativeImage.createFromBuffer(buffer, { width: size, height: size })
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Start Dictation (Alt+Shift+L)', click: (): void => toggleRecording() },
    { label: 'History (Alt+Shift+K)', click: (): void => toggleHistory() },
    { type: 'separator' },
    { label: 'Settings', click: (): void => showSettings() },
    { type: 'separator' },
    { label: 'Quit', click: (): void => app.quit() }
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

  // Clean up any previous session
  if (sonioxClient) {
    sonioxClient.disconnect()
    sonioxClient = null
  }

  isRecording = true
  recordingSessionId++
  sonioxConnecting = false
  resetTyping()
  currentView = 'recording'

  console.log(`[MAIN] Starting recording session #${recordingSessionId}`)

  // Save which app has focus BEFORE showing our popup
  saveFocusedWindow()

  centerWindowOnActiveDisplay(RECORDING_POPUP_WIDTH, RECORDING_POPUP_HEIGHT)
  mainWindow?.webContents.send('navigate', 'recording')
  mainWindow?.showInactive()
}

async function connectSoniox(): Promise<void> {
  const settings = getSettings()
  console.log(`[MAIN] Mic ready! Connecting to Soniox (sample rate: ${audioSampleRate})...`)

  try {
    sonioxClient = new SonioxClient(
      settings.apiKey,
      audioSampleRate,
      (fullText) => {
        if (!isRecording) return
        mainWindow?.webContents.send('transcript-token', fullText)
        streamType(fullText)
      },
      (fullText) => {
        console.log(`[SONIOX] Finished. Full: "${fullText.substring(0, 100)}"`)
        if (fullText.trim()) {
          addHistoryEntry(fullText.trim())
        }
      }
    )
    await sonioxClient.connect()
    sonioxConnecting = false
    console.log('[MAIN] Soniox connected and ready for audio!')
  } catch (err) {
    sonioxConnecting = false
    console.error('[MAIN] Failed to connect to Soniox:', err)
    stopRecording()
  }
}

function stopRecording(): void {
  if (!isRecording && !sonioxClient) return

  console.log(`[MAIN] Stopping recording session #${recordingSessionId}`)
  isRecording = false
  currentView = 'idle'

  // Navigate away from recording so RecordingPopup unmounts (fresh mount next time)
  mainWindow?.webContents.send('navigate', 'idle')

  if (sonioxClient) {
    sonioxClient.stop()
    // Wait for final tokens, then disconnect
    const client = sonioxClient
    sonioxClient = null
    setTimeout(() => {
      client.disconnect()
    }, 3000)
  }

  mainWindow?.hide()
}

function toggleHistory(): void {
  if (currentView === 'history') {
    currentView = 'idle'
    mainWindow?.hide()
  } else {
    if (isRecording) stopRecording()
    saveFocusedWindow() // Remember where cursor was before showing history
    currentView = 'history'
    mainWindow?.setSize(400, 500)
    mainWindow?.center()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('navigate', 'history')
  }
}

function showSettings(): void {
  if (isRecording) stopRecording()
  currentView = 'settings'
  mainWindow?.setSize(400, 300)
  mainWindow?.center()
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send('navigate', 'settings')
}

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
  ipcMain.handle('paste-at-cursor', (_event, text) => {
    mainWindow?.hide()
    clipboard.writeText(text)
    setTimeout(() => {
      restoreFocusedWindow()
      pasteText(text)
    }, 150)
  })
  ipcMain.handle('start-recording', () => startRecording())
  ipcMain.handle('stop-recording', () => stopRecording())

  // Renderer tells us the actual sample rate
  ipcMain.on('sample-rate', (_event, rate: number) => {
    audioSampleRate = rate
    console.log(`[AUDIO] Sample rate: ${rate}`)
  })

  // Renderer tells us mic is capturing — NOW connect to Soniox
  ipcMain.on('mic-ready', () => {
    console.log('[AUDIO] Mic ready signal received from renderer')
    if (isRecording && !sonioxConnecting && !sonioxClient) {
      sonioxConnecting = true
      connectSoniox()
    }
  })

  // Audio chunks from renderer
  let chunkCount = 0
  let currentSessionId = 0

  ipcMain.on('audio-chunk', (_event, chunk: ArrayBuffer) => {
    // Reset counter for new sessions
    if (currentSessionId !== recordingSessionId) {
      currentSessionId = recordingSessionId
      chunkCount = 0
    }

    // Only forward if we're actively recording
    if (!isRecording) return

    chunkCount++
    const buf = Buffer.from(new Uint8Array(chunk))

    if (chunkCount === 1) {
      console.log(`[AUDIO] First chunk of session #${recordingSessionId}, size: ${buf.length} bytes`)
    }
    if (chunkCount % 100 === 0) {
      console.log(`[AUDIO] ${chunkCount} chunks sent`)
    }

    if (sonioxClient) {
      sonioxClient.sendAudio(buf)
    }
  })
}

// App lifecycle
app.whenReady().then(() => {
  setupIPC()
  createWindow()
  createTray()
  registerShortcuts()

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Keep the tray app alive when all windows are closed.
})
