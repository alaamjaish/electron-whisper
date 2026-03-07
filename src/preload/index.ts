import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Settings
  getSettings: (): Promise<{ apiKey: string }> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: { apiKey: string }): Promise<void> =>
    ipcRenderer.invoke('save-settings', settings),

  // History
  getHistory: (): Promise<Array<{ id: string; text: string; timestamp: number }>> =>
    ipcRenderer.invoke('get-history'),
  deleteHistoryEntry: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-history-entry', id),
  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('copy-to-clipboard', text),
  pasteAtCursor: (text: string): Promise<void> => ipcRenderer.invoke('paste-at-cursor', text),

  // Recording
  startRecording: (): Promise<void> => ipcRenderer.invoke('start-recording'),
  stopRecording: (): Promise<void> => ipcRenderer.invoke('stop-recording'),
  sendAudioChunk: (chunk: ArrayBuffer): void => ipcRenderer.send('audio-chunk', chunk),
  sendSampleRate: (rate: number): void => ipcRenderer.send('sample-rate', rate),
  sendMicReady: (): void => ipcRenderer.send('mic-ready'),

  // Events from main
  onTranscriptToken: (callback: (token: string, isFinal: boolean) => void): void => {
    ipcRenderer.on('transcript-token', (_event, token, isFinal) => callback(token, isFinal))
  },
  onRecordingStateChange: (callback: (state: string) => void): void => {
    ipcRenderer.on('recording-state', (_event, state) => callback(state))
  },
  onNavigate: (callback: (view: string) => void): void => {
    ipcRenderer.on('navigate', (_event, view) => callback(view))
  },

  // Cleanup
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('api', api)
