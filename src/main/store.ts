import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { log } from './logger'

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
  const settings = readJSON<Settings>('settings.json', { apiKey: '' })
  log('STORE', `getSettings -> apiKey=${settings.apiKey ? settings.apiKey.substring(0, 8) + '...' : '(empty)'}`)
  return settings
}

export function saveSettings(settings: Settings): void {
  log('STORE', `saveSettings -> apiKey=${settings.apiKey?.substring(0, 8)}...`)
  writeJSON('settings.json', settings)
}

export function getHistory(): HistoryEntry[] {
  const history = readJSON<HistoryEntry[]>('history.json', [])
  log('STORE', `getHistory -> ${history.length} entries`)
  return history
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
  log('STORE', `addHistoryEntry -> "${text.substring(0, 60)}..." (now ${history.length} entries)`)
}

export function deleteHistoryEntry(id: string): void {
  const history = getHistory().filter((e) => e.id !== id)
  writeJSON('history.json', history)
  log('STORE', `deleteHistoryEntry id=${id} -> ${history.length} entries remaining`)
}
