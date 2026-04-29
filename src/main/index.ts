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
  session,
  powerMonitor
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
import { configureLogger, getLogFilePath, log } from './logger'

type View = 'setup' | 'idle' | 'recording' | 'history' | 'settings'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let rendererReady = false
let isRecording = false
let currentView: View = 'idle'
let sonioxClient: SonioxClient | null = null
let audioSampleRate = 48000
let recordingSessionId = 0
let sonioxConnecting = false
let micReady = false
let audioStarted = false
let micReadyTimer: ReturnType<typeof setTimeout> | null = null
let audioStartedTimer: ReturnType<typeof setTimeout> | null = null
let pendingAudioChunks: Buffer[] = []

const RECORDING_POPUP_WIDTH = 130
const RECORDING_POPUP_HEIGHT = 34
const MIC_READY_TIMEOUT_MS = 10000
const AUDIO_STARTED_TIMEOUT_MS = 12000
const MAX_PENDING_AUDIO_CHUNKS = 150

process.on('uncaughtException', (err) => {
  log('FATAL', 'Uncaught exception', err)
})

process.on('unhandledRejection', (reason) => {
  log('FATAL', 'Unhandled rejection', reason)
})

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer)
}

function clearRecordingGuards(): void {
  clearTimer(micReadyTimer)
  clearTimer(audioStartedTimer)
  micReadyTimer = null
  audioStartedTimer = null
  micReady = false
  audioStarted = false
  pendingAudioChunks = []
}

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

function navigateTo(view: View): void {
  currentView = view
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return
  if (!rendererReady || mainWindow.webContents.isLoading()) {
    log('MAIN', `Queued navigation to ${view}; renderer not ready yet`)
    return
  }
  mainWindow.webContents.send('navigate', view)
}

function ensureWindow(): BrowserWindow {
  if (!mainWindow) {
    createWindow()
  }
  return mainWindow!
}

function showSetup(): void {
  const win = ensureWindow()
  navigateTo('setup')
  win.setSize(400, 300)
  win.center()
  win.show()
  win.focus()
}

function showCurrentOrSettings(): void {
  const win = ensureWindow()
  if (currentView === 'recording') {
    centerWindowOnActiveDisplay(RECORDING_POPUP_WIDTH, RECORDING_POPUP_HEIGHT)
    win.showInactive()
    return
  }
  if (currentView === 'setup' || currentView === 'history' || currentView === 'settings') {
    win.show()
    win.focus()
    navigateTo(currentView)
    return
  }
  showSettings()
}

function createWindow(): void {
  if (mainWindow) return

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  rendererReady = false

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

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    log('MAIN', 'Window loaded, waiting for renderer-ready...')
    const settings = getSettings()

    if (!settings.apiKey) {
      showSetup()
      log('MAIN', 'No API key found; showing setup screen')
    } else {
      log('MAIN', `API key found (${settings.apiKey.substring(0, 8)}...), app ready in tray`)
      log('MAIN', 'Shortcuts: Alt+Shift+L = record, Alt+Shift+K = history')
    }
  })

  mainWindow.on('focus', () => {
    if (currentView === 'recording') {
      log('MAIN', 'Recording popup received focus; restoring previous window')
      restoreFocusedWindow()
    }
  })

  mainWindow.on('closed', () => {
    log('MAIN', 'Window closed')
    rendererReady = false
    mainWindow = null
  })
}

function createTray(): void {
  if (tray) return

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

  tray.setToolTip('LocalTranscriber')
  tray.setContextMenu(contextMenu)
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  const recordRegistered = globalShortcut.register('Alt+Shift+L', () => toggleRecording())
  const historyRegistered = globalShortcut.register('Alt+Shift+K', () => toggleHistory())

  if (!recordRegistered) {
    log('SHORTCUT', 'FAILED to register Alt+Shift+L. Another app or stale process may own it.')
  } else {
    log('SHORTCUT', 'Registered Alt+Shift+L')
  }

  if (!historyRegistered) {
    log('SHORTCUT', 'FAILED to register Alt+Shift+K. Another app or stale process may own it.')
  } else {
    log('SHORTCUT', 'Registered Alt+Shift+K')
  }
}

function toggleRecording(): void {
  if (isRecording) {
    stopRecording('shortcut toggle')
  } else {
    startRecording()
  }
}

function startRecording(): void {
  log('MAIN', '--- START RECORDING triggered ---')
  const settings = getSettings()
  if (!settings.apiKey) {
    log('MAIN', 'No API key; redirecting to setup')
    showSetup()
    return
  }

  const win = ensureWindow()

  if (sonioxClient) {
    log('MAIN', 'Cleaning up previous Soniox client before new session')
    sonioxClient.disconnect()
    sonioxClient = null
  }

  isRecording = true
  recordingSessionId++
  sonioxConnecting = false
  clearRecordingGuards()
  resetTyping()
  navigateTo('recording')

  const sessionId = recordingSessionId
  micReadyTimer = setTimeout(() => {
    if (isRecording && recordingSessionId === sessionId && !micReady) {
      failRecording('Microphone did not become ready in time')
    }
  }, MIC_READY_TIMEOUT_MS)

  log('MAIN', `Session #${recordingSessionId} started`)
  saveFocusedWindow()

  centerWindowOnActiveDisplay(RECORDING_POPUP_WIDTH, RECORDING_POPUP_HEIGHT)
  navigateTo('recording')
  win.showInactive()
  log('MAIN', 'Waiting for mic-ready and first audio chunk from renderer...')
}

function startAudioTimer(sessionId: number): void {
  clearTimer(audioStartedTimer)
  audioStartedTimer = setTimeout(() => {
    if (isRecording && recordingSessionId === sessionId && !audioStarted) {
      failRecording('Microphone became ready, but no audio chunks were produced')
    }
  }, AUDIO_STARTED_TIMEOUT_MS)
}

function handleAudioStarted(source: string): void {
  if (!isRecording) return
  if (!audioStarted) {
    audioStarted = true
    clearTimer(audioStartedTimer)
    audioStartedTimer = null
    log('AUDIO', `Audio stream started (${source})`)
  }
  startSonioxIfNeeded(source)
}

function startSonioxIfNeeded(source: string): void {
  if (!isRecording || sonioxConnecting || sonioxClient) return
  sonioxConnecting = true
  log('MAIN', `Starting Soniox connection after ${source}`)
  void connectSoniox(recordingSessionId)
}

function getPcmStats(buf: Buffer): { rms: number; peak: number } {
  if (buf.length < 2) return { rms: 0, peak: 0 }
  let sumSquares = 0
  let peak = 0
  const samples = Math.floor(buf.length / 2)

  for (let i = 0; i < samples; i++) {
    const sample = buf.readInt16LE(i * 2)
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sumSquares += sample * sample
  }

  return {
    rms: Math.sqrt(sumSquares / samples) / 32768,
    peak: peak / 32768
  }
}

async function connectSoniox(sessionId: number): Promise<void> {
  const settings = getSettings()
  log('MAIN', `Connecting to Soniox (sample rate: ${audioSampleRate})...`)

  const client = new SonioxClient(
    settings.apiKey,
    audioSampleRate,
    (fullText) => {
      if (!isRecording || recordingSessionId !== sessionId) return
      log('TRANSCRIPT', `"${fullText.length > 80 ? fullText.substring(0, 80) + '...' : fullText}" (${fullText.length} chars)`)
      mainWindow?.webContents.send('transcript-token', fullText)
      streamType(fullText)
    },
    (fullText) => {
      log('TRANSCRIPT', `=== SESSION FINISHED === Total: ${fullText.length} chars`)
      log('TRANSCRIPT', `Final text: "${fullText.substring(0, 200)}"`)
      if (fullText.trim()) {
        addHistoryEntry(fullText.trim())
        log('HISTORY', 'Entry saved to history')
      }
    },
    (reason) => {
      if (recordingSessionId !== sessionId) return
      failRecording(`Soniox connection failed: ${reason}`)
    }
  )

  sonioxClient = client

  try {
    await client.connect()
    if (!isRecording || recordingSessionId !== sessionId || sonioxClient !== client) {
      log('MAIN', 'Soniox connected for stale session; disconnecting')
      client.disconnect()
      return
    }

    sonioxConnecting = false
    log('MAIN', 'Soniox connected and ready for audio')

    if (pendingAudioChunks.length > 0) {
      log('AUDIO', `Flushing ${pendingAudioChunks.length} pending chunks queued before Soniox was ready`)
      for (const chunk of pendingAudioChunks) {
        client.sendAudio(chunk)
      }
      pendingAudioChunks = []
    }
  } catch (err) {
    if (sonioxClient === client) {
      sonioxClient = null
    }
    sonioxConnecting = false
    if (isRecording && recordingSessionId === sessionId) {
      failRecording(`Failed to connect to Soniox: ${err}`)
    }
  }
}

function failRecording(reason: string): void {
  log('ERROR', reason)
  mainWindow?.webContents.send('recording-state', 'error', reason)
  stopRecording(reason)
}

function stopRecording(reason = 'user'): void {
  if (!isRecording && !sonioxClient && !sonioxConnecting) return

  log('MAIN', `--- STOP RECORDING session #${recordingSessionId}; reason=${reason} ---`)
  isRecording = false
  sonioxConnecting = false
  clearRecordingGuards()
  mainWindow?.webContents.send('recording-state', 'stopped', reason)
  navigateTo('idle')

  if (sonioxClient) {
    log('MAIN', 'Sending stop signal to Soniox, waiting 3s for final tokens...')
    const client = sonioxClient
    sonioxClient = null
    client.stop()
    setTimeout(() => {
      log('MAIN', 'Disconnecting Soniox WebSocket')
      client.disconnect()
    }, 3000)
  }

  mainWindow?.hide()
  log('MAIN', 'Recording popup hidden, back to idle')
}

function toggleHistory(): void {
  const win = ensureWindow()
  if (currentView === 'history') {
    log('MAIN', 'Hiding history panel')
    navigateTo('idle')
    win.hide()
  } else {
    log('MAIN', 'Showing history panel')
    if (isRecording) stopRecording('open history')
    saveFocusedWindow()
    navigateTo('history')
    win.setSize(400, 500)
    win.center()
    win.show()
    win.focus()
  }
}

function showSettings(): void {
  log('MAIN', 'Showing settings')
  const win = ensureWindow()
  if (isRecording) stopRecording('open settings')
  navigateTo('settings')
  win.setSize(400, 300)
  win.center()
  win.show()
  win.focus()
}

function setupIPC(): void {
  log('IPC', 'Setting up IPC handlers...')

  ipcMain.handle('get-settings', () => {
    log('IPC', 'get-settings')
    return getSettings()
  })
  ipcMain.handle('save-settings', (_event, settings) => {
    log('IPC', `save-settings (key: ${settings.apiKey?.substring(0, 8)}...)`)
    saveSettings(settings)
    navigateTo('idle')
    mainWindow?.hide()
  })
  ipcMain.handle('get-history', () => {
    const history = getHistory()
    log('IPC', `get-history -> ${history.length} entries`)
    return history
  })
  ipcMain.handle('delete-history-entry', (_event, id) => {
    log('IPC', `delete-history-entry id=${id}`)
    deleteHistoryEntry(id)
  })
  ipcMain.handle('copy-to-clipboard', (_event, text) => {
    log('IPC', `copy-to-clipboard (${text.length} chars)`)
    clipboard.writeText(text)
  })
  ipcMain.handle('paste-at-cursor', (_event, text) => {
    log('IPC', `paste-at-cursor (${text.length} chars)`)
    mainWindow?.hide()
    clipboard.writeText(text)
    setTimeout(() => {
      restoreFocusedWindow()
      pasteText(text)
    }, 150)
  })
  ipcMain.handle('start-recording', () => {
    log('IPC', 'start-recording (from renderer)')
    startRecording()
  })
  ipcMain.handle('stop-recording', () => {
    log('IPC', 'stop-recording (from renderer)')
    stopRecording('renderer request')
  })

  ipcMain.on('renderer-ready', () => {
    rendererReady = true
    log('IPC', `renderer-ready; currentView=${currentView}`)
    if (currentView !== 'idle') {
      mainWindow?.webContents.send('navigate', currentView)
    }
  })

  ipcMain.on('sample-rate', (_event, rate: number) => {
    audioSampleRate = rate
    log('AUDIO', `Sample rate received from renderer: ${rate} Hz`)
  })

  ipcMain.on('mic-ready', () => {
    log('AUDIO', `Mic ready signal received; isRecording=${isRecording}`)
    if (!isRecording) return
    micReady = true
    clearTimer(micReadyTimer)
    micReadyTimer = null
    startAudioTimer(recordingSessionId)
  })

  ipcMain.on('mic-devices', (_event, devices: string[]) => {
    log('AUDIO', `Available input devices: ${devices.join(' | ') || '(none)'}`)
  })

  ipcMain.on('mic-device', (_event, device: string) => {
    log('AUDIO', `Selected input device: ${device}`)
  })

  ipcMain.on('audio-started', () => {
    handleAudioStarted('renderer audio-started signal')
  })

  ipcMain.on('mic-error', (_event, message: string) => {
    if (!isRecording) return
    failRecording(`Renderer microphone error: ${message}`)
  })

  let chunkCount = 0
  let currentSessionId = 0
  let totalBytes = 0
  let rmsSum = 0
  let peakMax = 0

  ipcMain.on('audio-chunk', (_event, chunk: ArrayBuffer) => {
    if (currentSessionId !== recordingSessionId) {
      currentSessionId = recordingSessionId
      chunkCount = 0
      totalBytes = 0
      rmsSum = 0
      peakMax = 0
    }

    if (!isRecording) return

    const buf = Buffer.from(new Uint8Array(chunk))
    const stats = getPcmStats(buf)
    chunkCount++
    totalBytes += buf.length
    rmsSum += stats.rms
    peakMax = Math.max(peakMax, stats.peak)

    if (!audioStarted) {
      handleAudioStarted('first audio chunk')
    }

    if (chunkCount === 1) {
      log('AUDIO', `First chunk of session #${recordingSessionId}, size: ${buf.length} bytes, rms=${stats.rms.toFixed(4)}, peak=${stats.peak.toFixed(4)}`)
    }
    if (chunkCount % 50 === 0) {
      const secs = (totalBytes / (audioSampleRate * 2)).toFixed(1)
      const avgRms = rmsSum / 50
      log('AUDIO', `${chunkCount} chunks sent (~${secs}s, ${(totalBytes / 1024).toFixed(0)} KB, avgRms=${avgRms.toFixed(4)}, peak=${peakMax.toFixed(4)})`)
      if (avgRms < 0.0001 && peakMax < 0.0001) {
        log('AUDIO', 'WARNING: microphone stream is silent. Check selected input device or Windows microphone mute/privacy settings.')
      }
      rmsSum = 0
      peakMax = 0
    }

    if (sonioxClient) {
      sonioxClient.sendAudio(buf)
    } else {
      pendingAudioChunks.push(buf)
      if (pendingAudioChunks.length > MAX_PENDING_AUDIO_CHUNKS) {
        pendingAudioChunks.shift()
      }
      startSonioxIfNeeded('first queued audio chunk')
    }
  })

  log('IPC', 'All IPC handlers registered')
}

function setupPowerHandlers(): void {
  powerMonitor.on('suspend', () => {
    log('POWER', 'System suspend detected')
    if (isRecording) {
      stopRecording('system suspend')
    } else if (sonioxClient) {
      sonioxClient.disconnect()
      sonioxClient = null
      sonioxConnecting = false
    }
  })

  powerMonitor.on('resume', () => {
    log('POWER', 'System resume detected; re-registering shortcuts')
    if (isRecording) {
      stopRecording('system resume cleanup')
    }
    if (sonioxClient) {
      sonioxClient.disconnect()
      sonioxClient = null
      sonioxConnecting = false
    }
    clearRecordingGuards()
    registerShortcuts()
  })

  powerMonitor.on('lock-screen', () => {
    log('POWER', 'Screen locked')
    if (isRecording) {
      stopRecording('screen locked')
    }
  })

  powerMonitor.on('unlock-screen', () => {
    log('POWER', 'Screen unlocked; re-registering shortcuts')
    registerShortcuts()
  })
}

app.whenReady().then(() => {
  configureLogger(app.getPath('userData'))
  log('APP', '========================================')
  log('APP', '  LocalTranscriber starting up...')
  log('APP', `  Electron ${process.versions.electron}`)
  log('APP', `  Node ${process.versions.node}`)
  log('APP', `  Chrome ${process.versions.chrome}`)
  log('APP', `  userData: ${app.getPath('userData')}`)
  log('APP', `  logFile: ${getLogFilePath() ?? '(not configured)'}`)
  log('APP', '========================================')

  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  log('APP', `Single instance lock result: ${gotSingleInstanceLock}`)
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    log('APP', 'Second instance requested; focusing existing instance')
    showCurrentOrSettings()
  })

  setupIPC()
  createWindow()
  createTray()
  registerShortcuts()
  setupPowerHandlers()
  log('APP', 'Tray + shortcuts registered. App ready.')

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  })
})

app.on('will-quit', () => {
  log('APP', 'Quitting; unregistering shortcuts')
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  log('APP', 'All windows closed; tray keeps running')
})
