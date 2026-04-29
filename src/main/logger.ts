import * as fs from 'fs'
import * as path from 'path'

let logFilePath: string | null = null

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
  }
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export function configureLogger(userDataPath: string): void {
  logFilePath = path.join(userDataPath, 'app.log')
  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.appendFileSync(logFilePath, `\n===== ${new Date().toISOString()} app start =====\n`, 'utf-8')
  } catch (err) {
    console.error('[LOGGER] Failed to initialize file logging:', err)
  }
}

export function getLogFilePath(): string | null {
  return logFilePath
}

export function log(tag: string, ...args: unknown[]): void {
  const ts = new Date().toISOString()
  const message = `[${ts}][${tag}] ${args.map(stringifyArg).join(' ')}`
  console.log(message)

  if (!logFilePath) return
  try {
    fs.appendFileSync(logFilePath, `${message}\n`, 'utf-8')
  } catch (err) {
    console.error('[LOGGER] Failed to write log:', err)
  }
}
