// Direct Unicode typing via Windows SendInput API — no clipboard
// Append-only with small correction margin (max 3 char backspace)
// Focus management to prevent popup drag from stealing cursor

let sendInputFn: ((count: number, buf: Buffer, size: number) => number) | null = null
let getForegroundWindowFn: (() => unknown) | null = null
let setForegroundWindowFn: ((hwnd: unknown) => number) | null = null
let loaded = false

const INPUT_KEYBOARD = 1
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_KEYUP = 0x0002
const VK_BACK = 0x08
const INPUT_SIZE = 40 // sizeof(INPUT) on x64 Windows
const MAX_BACKSPACE = 3 // never delete more than this many chars

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
    console.log('[TYPING] Loaded: SendInput + focus management')
    return true
  } catch (err) {
    console.error('[TYPING] Failed to load koffi:', err)
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

function sendChars(text: string): void {
  if (!sendInputFn || text.length === 0) return
  const totalEvents = text.length * 2
  const buffer = Buffer.alloc(totalEvents * INPUT_SIZE, 0)
  let offset = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE)
    offset += INPUT_SIZE
    writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
    offset += INPUT_SIZE
  }
  sendInputFn(totalEvents, buffer, INPUT_SIZE)
}

// ── Focus management ──

let savedHwnd: unknown = null

export function saveFocusedWindow(): void {
  if (!init() || !getForegroundWindowFn) return
  savedHwnd = getForegroundWindowFn()
}

export function restoreFocusedWindow(): void {
  if (!savedHwnd || !setForegroundWindowFn) return
  setForegroundWindowFn(savedHwnd)
}

// ── Streaming typing (recording) ──

let screenText = ''

export function streamType(fullText: string): void {
  if (!init() || !sendInputFn) return
  if (fullText === screenText) return

  const shared = commonPrefix(screenText, fullText)
  const charsToDelete = screenText.length - shared

  if (charsToDelete <= MAX_BACKSPACE) {
    // Small correction or pure append — allow it
    const newChars = fullText.substring(shared)
    const totalEvents = (charsToDelete + newChars.length) * 2
    if (totalEvents === 0) return

    const buffer = Buffer.alloc(totalEvents * INPUT_SIZE, 0)
    let offset = 0
    for (let i = 0; i < charsToDelete; i++) {
      writeKey(buffer, offset, VK_BACK, 0, 0)
      offset += INPUT_SIZE
      writeKey(buffer, offset, VK_BACK, 0, KEYEVENTF_KEYUP)
      offset += INPUT_SIZE
    }
    for (let i = 0; i < newChars.length; i++) {
      const code = newChars.charCodeAt(i)
      writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE)
      offset += INPUT_SIZE
      writeKey(buffer, offset, 0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      offset += INPUT_SIZE
    }
    sendInputFn(totalEvents, buffer, INPUT_SIZE)
    screenText = fullText
  } else if (fullText.length > screenText.length) {
    // Large revision but text grew — only append the new tail, never delete
    const newChars = fullText.substring(screenText.length)
    if (newChars.length > 0) {
      sendChars(newChars)
      screenText = screenText + newChars
    }
  }
  // If text shrank with large revision: do nothing, keep what's on screen
}

// ── One-shot paste (history) — clipboard + Ctrl+V for instant paste ──

const VK_CONTROL = 0x11
const VK_V = 0x56

export function pasteText(text: string): void {
  if (!init() || !sendInputFn || text.length === 0) return

  // Set clipboard externally (caller sets it), then Ctrl+V = 4 events
  const buffer = Buffer.alloc(4 * INPUT_SIZE, 0)
  writeKey(buffer, 0, VK_CONTROL, 0, 0)
  writeKey(buffer, INPUT_SIZE, VK_V, 0, 0)
  writeKey(buffer, INPUT_SIZE * 2, VK_V, 0, KEYEVENTF_KEYUP)
  writeKey(buffer, INPUT_SIZE * 3, VK_CONTROL, 0, KEYEVENTF_KEYUP)
  sendInputFn(4, buffer, INPUT_SIZE)
}

export function resetTyping(): void {
  screenText = ''
}
