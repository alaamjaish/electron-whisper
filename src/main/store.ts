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

function loadEnvFile(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(app.getAppPath(), '..', '.env')
  ]
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, 'utf-8')
      const out: Record<string, string> = {}
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        out[key] = value
      }
      return out
    } catch {
      // try next
    }
  }
  return {}
}

export function getSettings(): Settings {
  const stored = readJSON<Settings>('settings.json', { apiKey: '' })
  if (stored.apiKey) return stored

  // Fallback: read from .env (SONIOX_API_KEY)
  const env = loadEnvFile()
  const envKey = env.SONIOX_API_KEY || process.env.SONIOX_API_KEY || ''
  if (envKey) return { apiKey: envKey }

  return stored
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
