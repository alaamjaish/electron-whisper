import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { createInterface } from 'readline'
import { log } from './logger'

// Side buttons on the mouse. XBUTTON1 is the rear one (Back, nearer the wrist),
// XBUTTON2 the front one (Forward, nearer the screen).
const XBUTTON1 = 1
const XBUTTON2 = 2
// A second press of the same button inside this window is treated as bounce.
const DEBOUNCE_MS = 300
// Restart backoff for a helper that dies; reset once it has run this long.
const RESTART_DELAYS_MS = [1000, 3000, 10000, 30000]
const STABLE_AFTER_MS = 60000
// How often the helper re-installs its hook (see the C# below).
const HOOK_REFRESH_MS = 120000

// The low-level mouse hook runs in its own helper process (Windows PowerShell +
// a few lines of C#), never inside Electron. Windows calls a WH_MOUSE_LL hook for
// every mouse event system-wide; the first version ran it in a worker thread via
// koffi and took the whole app down with a native crash (0x80000003) after a few
// minutes. Out of process, a helper crash costs at most a restart of the helper.
// The helper prints "ready", "press 1" / "press 2", or "error <code>", and exits
// when its stdin closes, so it can't outlive the app.
const HOOK_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class LtSideButtons {
  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  static HookProc proc;
  static IntPtr hook;
  static void Say(string line) { try { Console.Out.WriteLine(line); Console.Out.Flush(); } catch { Environment.Exit(0); } }
  public static void Run() {
    proc = Callback;
    hook = SetWindowsHookEx(14, proc, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) { Say("error " + Marshal.GetLastWin32Error()); return; }
    var watch = new Thread(() => { try { while (Console.In.Read() != -1) { } } catch { } Environment.Exit(0); });
    watch.IsBackground = true;
    watch.Start();
    // Windows silently drops a hook that ever answers too slowly, with no signal.
    // Re-hook on a timer: the new hook goes in before the old one comes out, so
    // there is no gap, and the newest hook swallows the press before the old sees it.
    var refresh = new System.Windows.Forms.Timer();
    refresh.Interval = REFRESH_MS;
    refresh.Tick += (s, e) => {
      IntPtr fresh = SetWindowsHookEx(14, proc, GetModuleHandle(null), 0);
      if (fresh == IntPtr.Zero) { Say("error " + Marshal.GetLastWin32Error()); return; }
      UnhookWindowsHookEx(hook);
      hook = fresh;
    };
    refresh.Start();
    Say("ready");
    Application.Run();
  }
  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    int msg = wParam.ToInt32();
    if (nCode >= 0 && (msg == 0x020B || msg == 0x020C)) {
      int button = (int)((uint)Marshal.ReadInt32(lParam, 8) >> 16);
      if (button == 1 || button == 2) {
        if (msg == 0x020B) Say("press " + button);
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }
}
'@
[LtSideButtons]::Run()
`

type Handlers = { onRecord: () => void; onHistory: () => void }

let handlers: Handlers | null = null
let enabled = false
let helper: ChildProcessWithoutNullStreams | null = null
let helperStartedAt = 0
let restartAttempt = 0
let restartTimer: ReturnType<typeof setTimeout> | null = null
const lastPress = new Map<number, number>()

function powershellPath(): string {
  const root = process.env['SystemRoot'] || 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
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

function scheduleRestart(): void {
  if (!enabled || restartTimer) return
  if (Date.now() - helperStartedAt > STABLE_AFTER_MS) restartAttempt = 0
  const delay = RESTART_DELAYS_MS[Math.min(restartAttempt, RESTART_DELAYS_MS.length - 1)]
  restartAttempt++
  log('MOUSE', `Restarting side-button helper in ${delay / 1000}s`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (enabled && !helper) startHelper()
  }, delay)
}

function startHelper(): void {
  const script = HOOK_SCRIPT.replace('REFRESH_MS', String(HOOK_REFRESH_MS))
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true }
    )
  } catch (err) {
    log('MOUSE', 'Could not start side-button helper', err)
    scheduleRestart()
    return
  }
  helper = child
  helperStartedAt = Date.now()

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (helper !== child) return
    const text = line.trim()
    if (text === 'ready') {
      log('MOUSE', `Side-button hook installed (helper pid ${child.pid}; rear = record, front = history)`)
    } else if (text.startsWith('press ')) {
      handlePress(Number(text.slice(6)))
    } else if (text.startsWith('error ')) {
      log('MOUSE', `Side-button hook FAILED: SetWindowsHookEx error ${text.slice(6)}`)
    }
  })
  createInterface({ input: child.stderr }).on('line', (line) => {
    // PowerShell wraps stderr in CLIXML; keep only the error records.
    const text = line.trim()
    if (!text || text === '#< CLIXML') return
    if (text.startsWith('<') && !text.includes('S="Error"')) return
    log('MOUSE', `helper stderr: ${text}`)
  })
  child.on('error', (err) => log('MOUSE', 'Side-button helper error', err))
  child.on('exit', (code, signal) => {
    if (helper !== child) return
    helper = null
    log('MOUSE', `Side-button helper exited (code ${code}, signal ${signal})`)
    scheduleRestart()
  })
}

function stopHelper(): void {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  const child = helper
  if (!child) return
  helper = null
  log('MOUSE', 'Removing side-button hook')
  // Closing stdin makes the helper exit by itself; kill() is the fallback.
  child.stdin.end()
  setTimeout(() => {
    if (child.exitCode === null) child.kill()
  }, 1000).unref()
}

export function startMouseButtons(h: Handlers): void {
  handlers = h
  enabled = true
  restartAttempt = 0
  if (!helper) startHelper()
}

export function stopMouseButtons(): void {
  enabled = false
  stopHelper()
}

// Windows silently drops a low-level hook that ever times out, and gives no
// signal; a fresh helper after sleep/unlock keeps the buttons alive.
export function restartMouseButtons(): void {
  if (!enabled || !handlers) return
  log('MOUSE', 'Reinstalling side-button hook')
  stopHelper()
  startHelper()
}
