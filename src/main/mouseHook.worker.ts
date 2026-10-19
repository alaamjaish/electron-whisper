// Runs on its own thread: a WH_MOUSE_LL hook sees every mouse event system-wide,
// and Windows waits on the hook thread for each one. On the busy main thread that
// would make the whole system's pointer stutter, so the hook lives here, in a thread
// that does nothing but pump messages.
import { parentPort } from 'worker_threads'

const WH_MOUSE_LL = 14
const WM_XBUTTONDOWN = 0x020b
const WM_XBUTTONUP = 0x020c
const XBUTTON1 = 1
const XBUTTON2 = 2
const MSG_SIZE = 48

type Message =
  | { type: 'ready'; threadId: number }
  | { type: 'press'; button: number }
  | { type: 'error'; message: string }

function send(message: Message): void {
  parentPort?.postMessage(message)
}

function run(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
    x: 'int32',
    y: 'int32',
    mouseData: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t'
  })
  const LowLevelMouseProc = koffi.proto(
    'intptr_t __stdcall LowLevelMouseProc(int nCode, uintptr_t wParam, void *lParam)'
  )

  const SetWindowsHookExW = user32.func(
    'void * __stdcall SetWindowsHookExW(int idHook, LowLevelMouseProc *lpfn, void *hmod, uint32_t dwThreadId)'
  )
  const CallNextHookEx = user32.func(
    'intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)'
  )
  const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)')
  const GetMessageW = user32.func(
    'int __stdcall GetMessageW(void *lpMsg, void *hWnd, uint32_t wMsgFilterMin, uint32_t wMsgFilterMax)'
  )
  const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(void *lpModuleName)')
  const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()')
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()')

  // Keep this callback cheap: it runs for every mouse move on the system.
  const hookProc = koffi.register(
    (nCode: number, wParam: number, lParam: unknown): number => {
      if (nCode >= 0 && (wParam === WM_XBUTTONDOWN || wParam === WM_XBUTTONUP)) {
        const info = koffi.decode(lParam, MSLLHOOKSTRUCT)
        const button = (info.mouseData >>> 16) & 0xffff
        if (button === XBUTTON1 || button === XBUTTON2) {
          if (wParam === WM_XBUTTONDOWN) send({ type: 'press', button })
          // Swallow both down and up, so apps never see a half Back/Forward click.
          return 1
        }
      }
      return CallNextHookEx(null, nCode, wParam, lParam)
    },
    koffi.pointer(LowLevelMouseProc)
  )

  const hook = SetWindowsHookExW(WH_MOUSE_LL, hookProc, GetModuleHandleW(null), 0)
  if (!hook) {
    send({ type: 'error', message: `SetWindowsHookExW failed (GetLastError=${GetLastError()})` })
    koffi.unregister(hookProc)
    return
  }

  send({ type: 'ready', threadId: GetCurrentThreadId() })

  // The hook is called from inside GetMessageW. It returns 0 on WM_QUIT, which
  // main posts to this thread to stop the hook.
  const msg = Buffer.alloc(MSG_SIZE)
  for (;;) {
    const result = GetMessageW(msg, null, 0, 0)
    if (result === 0 || result === -1) break
  }

  UnhookWindowsHookEx(hook)
  koffi.unregister(hookProc)
}

try {
  run()
} catch (err) {
  send({ type: 'error', message: String(err) })
}
