import { log } from './logger'

let sendInputFn: ((count: number, buf: Buffer, size: number) => number) | null = null
let getForegroundWindowFn: (() => unknown) | null = null
let setForegroundWindowFn: ((hwnd: unknown) => number) | null = null
let loaded = false

const INPUT_KEYBOARD = 1
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_KEYUP = 0x0002
const VK_BACK = 0x08
const INPUT_SIZE = 40
const MAX_BACKSPACE = 3

function init(): boolean {
  if (loaded) return sendInputFn !== null
  loaded = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    sendInputFn = user32.func('uint SendInput(uint nInputs, void *pInputs, int cbSize)')
    getForegroundWindowFn = user32.func('void *GetForegroundWindow()')
    setForegroundWindowFn = user32.func('int SetForegroundWindow(void *hWnd)')
    log('TYPING', 'koffi loaded OK - SendInput + focus management')
    return true
  } catch (err) {
    log('TYPING', `FAILED to load koffi: ${err}`)
    return false
  }
}

function writeKey(buf: Buffer, offset: number, vk: number, scan: number, flags: number): void {
  buf.writeUInt32LE(INPUT_KEYBOARD, offset)
  buf.writeUInt16LE(vk, offset + 8)
  buf.writeUInt16LE(scan, offset + 10)
  buf.writeUInt32LE(flags, offset + 12)
}

function commonPrefix(a: string, b: string): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i
  }
  return len
}

let savedHwnd: unknown = null

export function saveFocusedWindow(): void {
  if (!init() || !getForegroundWindowFn) return
  try {
    savedHwnd = getForegroundWindowFn()
    log('TYPING', `Saved focused window handle (${savedHwnd ? typeof savedHwnd : 'empty'})`)
  } catch (err) {
    savedHwnd = null
    log('TYPING', `Failed to save focused window handle: ${err}`)
  }
}

export function restoreFocusedWindow(): void {
  if (!savedHwnd || !setForegroundWindowFn) return
  try {
    log('TYPING', 'Restoring focus to saved window')
    const ok = setForegroundWindowFn(savedHwnd)
    if (!ok) {
      log('TYPING', 'SetForegroundWindow returned false')
    }
  } catch (err) {
    log('TYPING', `Failed to restore focus: ${err}`)
  }
}

let screenText = ''
let lastHypothesis = ''

function sendKeystrokes(backspaces: number, text: string): void {
  if (!sendInputFn) return
  const totalEvents = (backspaces + text.length) * 2
  if (totalEvents === 0) return

  const buffer = Buffer.alloc(totalEvents * INPUT_SIZE, 0)
  let offset = 0
  for (let i = 0; i < backspaces; i++) {
    writeKey(buffer, offset, VK_BACK, 0, 0)
    offset += INPUT_SIZE
    writeKey(buffer, offset, VK_BACK, 0, KEYEVENTF_KEYUP)
    offset += INPUT_SIZE
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE)
    offset += INPUT_SIZE
    writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
    offset += INPUT_SIZE
  }

  const sent = sendInputFn(totalEvents, buffer, INPUT_SIZE)
  if (sent !== totalEvents) {
    log('TYPING', `SendInput only sent ${sent}/${totalEvents} events`)
  }
}

export function streamType(fullText: string): void {
  if (!init() || !sendInputFn) return
  const prevHypothesis = lastHypothesis
  lastHypothesis = fullText
  if (fullText === screenText) return

  const shared = commonPrefix(screenText, fullText)
  const charsToDelete = screenText.length - shared

  if (charsToDelete <= MAX_BACKSPACE) {
    const newChars = fullText.substring(shared)
    if (charsToDelete === 0 && newChars.length === 0) return

    if (charsToDelete > 0) {
      log('TYPING', `Backspace ${charsToDelete} + type "${newChars}" (screen: ${screenText.length}->${fullText.length} chars)`)
    } else {
      log('TYPING', `Append: "${newChars}" (screen: ${screenText.length}->${fullText.length} chars)`)
    }

    sendKeystrokes(charsToDelete, newChars)
    screenText = fullText
    return
  }

  // The screen has diverged from the hypothesis (a revision landed further back
  // than the backspace budget). The diverged region is frozen on screen; from here
  // we diff against the PREVIOUS HYPOTHESIS, never against screen length — a
  // length-based offset into a diverged string types shifted/duplicated fragments.
  const sharedHyp = commonPrefix(prevHypothesis, fullText)

  if (sharedHyp === prevHypothesis.length) {
    // Pure append: everything before is unchanged, only new speech was added.
    const newChars = fullText.substring(prevHypothesis.length)
    if (newChars.length > 0) {
      log('TYPING', `Diverged (revision ${charsToDelete} back) - typing new speech only: "${newChars}"`)
      sendKeystrokes(0, newChars)
      screenText += newChars
    }
    return
  }

  // Small revision at the very end of the hypothesis whose old tail is actually
  // on screen: safe to fix with backspaces even while diverged earlier.
  const revisedTail = prevHypothesis.substring(sharedHyp)
  if (revisedTail.length <= MAX_BACKSPACE && screenText.endsWith(revisedTail)) {
    const newChars = fullText.substring(sharedHyp)
    log('TYPING', `Diverged tail fix: backspace ${revisedTail.length} + type "${newChars}"`)
    sendKeystrokes(revisedTail.length, newChars)
    screenText = screenText.substring(0, screenText.length - revisedTail.length) + newChars
    return
  }

  log('TYPING', `Revision ${prevHypothesis.length - sharedHyp} chars back in hypothesis; screen frozen - skipped`)
}

const VK_CONTROL = 0x11
const VK_V = 0x56

export function pasteText(text: string): void {
  if (!init() || !sendInputFn || text.length === 0) return

  log('TYPING', `Paste via Ctrl+V (${text.length} chars)`)
  const buffer = Buffer.alloc(4 * INPUT_SIZE, 0)
  writeKey(buffer, 0, VK_CONTROL, 0, 0)
  writeKey(buffer, INPUT_SIZE, VK_V, 0, 0)
  writeKey(buffer, INPUT_SIZE * 2, VK_V, 0, KEYEVENTF_KEYUP)
  writeKey(buffer, INPUT_SIZE * 3, VK_CONTROL, 0, KEYEVENTF_KEYUP)
  const sent = sendInputFn(4, buffer, INPUT_SIZE)
  if (sent !== 4) {
    log('TYPING', `SendInput only sent ${sent}/4 paste events`)
  }
}

export function resetTyping(): void {
  log('TYPING', `Reset (was ${screenText.length} chars on screen)`)
  screenText = ''
  lastHypothesis = ''
}
