/// <reference types="vite/client" />

interface ElectronAPI {
  getSettings: () => Promise<{ apiKey: string }>
  saveSettings: (settings: { apiKey: string }) => Promise<void>
  getHistory: () => Promise<Array<{ id: string; text: string; timestamp: number }>>
  deleteHistoryEntry: (id: string) => Promise<void>
  copyToClipboard: (text: string) => Promise<void>
  pasteAtCursor: (text: string) => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  sendAudioChunk: (chunk: ArrayBuffer) => void
  sendSampleRate: (rate: number) => void
  sendMicReady: () => void
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
