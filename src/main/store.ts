import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const userDataPath = app.getPath('userData')

export interface Settings {
  apiKey: string
}

export interface HistoryEntry {
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
  if (history.length > 100) history.length = 100
  writeJSON('history.json', history)
}

export function deleteHistoryEntry(id: string): void {
  const history = getHistory().filter((e) => e.id !== id)
  writeJSON('history.json', history)
}
