import type { Worker } from 'worker_threads'
import createMouseHookWorker from './mouseHook.worker?nodeWorker'
import { log } from './logger'

// Side buttons on the mouse. XBUTTON1 is the rear one (Back, nearer the wrist),
// XBUTTON2 the front one (Forward, nearer the screen).
const XBUTTON1 = 1
const XBUTTON2 = 2
const WM_QUIT = 0x0012
// A second press of the same button inside this window is treated as bounce.
const DEBOUNCE_MS = 300
const STOP_TIMEOUT_MS = 1000

type Handlers = { onRecord: () => void; onHistory: () => void }
type WorkerMessage =
  | { type: 'ready'; threadId: number }
  | { type: 'press'; button: number }
  | { type: 'error'; message: string }

let handlers: Handlers | null = null
let enabled = false
let worker: Worker | null = null
let workerThreadId = 0
const lastPress = new Map<number, number>()

let postThreadMessageFn: ((threadId: number, msg: number, wParam: number, lParam: number) => number) | null = null

function postQuit(threadId: number): boolean {
  try {
    if (!postThreadMessageFn) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const user32 = koffi.load('user32.dll')
      postThreadMessageFn = user32.func(
        'int __stdcall PostThreadMessageW(uint32_t idThread, uint32_t Msg, uintptr_t wParam, intptr_t lParam)'
      )
    }
    return postThreadMessageFn!(threadId, WM_QUIT, 0, 0) !== 0
  } catch (err) {
    log('MOUSE', `PostThreadMessageW failed: ${err}`)
    return false
  }
}

function handlePress(button: number): void {
  const now = Date.now()
  if (now - (lastPress.get(button) ?? 0) < DEBOUNCE_MS) return
  lastPress.set(button, now)

  if (button === XBUTTON1) {
    log('MOUSE', 'Rear side button -> toggle recording')
    handlers?.onRecord()
  } else if (button === XBUTTON2) {
    log('MOUSE', 'Front side button -> toggle history')
    handlers?.onHistory()
  }
}

function startWorker(): void {
  const w = createMouseHookWorker({})
  worker = w
  workerThreadId = 0

  w.on('message', (message: WorkerMessage) => {
    if (worker !== w) {
      // Stopped before its hook was up: shut it down now that its thread is known.
      if (message.type === 'ready') postQuit(message.threadId)
      return
    }
    if (message.type === 'ready') {
      workerThreadId = message.threadId
      log('MOUSE', 'Side-button hook installed (rear = record, front = history)')
    } else if (message.type === 'press') {
      handlePress(message.button)
    } else if (message.type === 'error') {
      log('MOUSE', `Side-button hook FAILED: ${message.message}`)
    }
  })
  w.on('error', (err) => log('MOUSE', 'Side-button worker crashed', err))
  w.on('exit', (code) => {
    log('MOUSE', `Side-button worker exited (code ${code})`)
    if (worker === w) {
      worker = null
      workerThreadId = 0
    }
  })
}

export function startMouseButtons(h: Handlers): void {
  handlers = h
  enabled = true
  if (worker) return
  try {
    startWorker()
  } catch (err) {
    log('MOUSE', 'Could not start side-button worker', err)
  }
}

export function stopMouseButtons(): void {
  enabled = false
  stopWorker()
}

function stopWorker(): void {
  const w = worker
  if (!w) return
  worker = null
  log('MOUSE', 'Removing side-button hook')
  // The worker sits in GetMessageW, where terminate() can't reach it; WM_QUIT is
  // the clean way out (it unhooks). Before 'ready' it is still in JS, and the
  // message handler above posts WM_QUIT once the thread id arrives.
  if (workerThreadId) postQuit(workerThreadId)
  setTimeout(() => void w.terminate(), STOP_TIMEOUT_MS).unref()
  workerThreadId = 0
}

// Windows silently drops a low-level hook that ever times out, and gives no
// signal; reinstalling after sleep/unlock keeps the buttons alive.
export function restartMouseButtons(): void {
  if (!enabled || !handlers) return
  log('MOUSE', 'Reinstalling side-button hook')
  stopWorker()
  startMouseButtons(handlers)
}
