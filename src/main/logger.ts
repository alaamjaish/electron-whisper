import * as fs from 'fs'
import * as path from 'path'

let logFilePath: string | null = null

const MAX_LOG_SIZE = 10 * 1024 * 1024
const ROTATE_CHECK_INTERVAL = 500
let writesSinceCheck = 0

function oldLogPath(current: string): string {
  return current.replace(/\.log$/, '.old.log')
}

function rotateIfNeeded(): void {
  if (!logFilePath) return
  try {
    const { size } = fs.statSync(logFilePath)
    if (size <= MAX_LOG_SIZE) return
    const old = oldLogPath(logFilePath)
    fs.rmSync(old, { force: true })
    fs.renameSync(logFilePath, old)
    fs.appendFileSync(
      logFilePath,
      `===== ${new Date().toISOString()} log rotated (previous ${(size / 1024 / 1024).toFixed(1)} MB moved to ${old}) =====\n`,
      'utf-8'
    )
  } catch {
    // rotation is best-effort; never let it break logging
  }
}

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
    // Legacy cleanup: logs written before rotation existed can be hundreds of MB.
    // Anything over 5x the cap is deleted outright instead of archived.
    try {
      const { size } = fs.statSync(logFilePath)
      if (size > MAX_LOG_SIZE * 5) {
        fs.rmSync(logFilePath, { force: true })
      }
    } catch {
      // no existing log file
    }
    rotateIfNeeded()
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
    if (++writesSinceCheck >= ROTATE_CHECK_INTERVAL) {
      writesSinceCheck = 0
      rotateIfNeeded()
    }
    fs.appendFileSync(logFilePath, `${message}\n`, 'utf-8')
  } catch (err) {
    console.error('[LOGGER] Failed to write log:', err)
  }
}
