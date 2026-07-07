# LocalTranscriber

A Windows desktop voice-to-text companion. Press a shortcut, speak, and the text streams in at your cursor — in any application, with no clipboard hijacking.

LocalTranscriber lives in your system tray. Tap **Alt+Shift+L** to start recording, tap it again to stop. Your speech is streamed in real time to [Soniox](https://soniox.com)'s real-time STT API, and the transcription is typed directly into whatever window you were using — Word, your browser, Slack, a code editor, anything that accepts text input.

> **Status:** Windows-only today. macOS / Linux ports are open contributions — see [Porting to macOS / Linux](#porting-to-macos--linux) below.

## Features

- **Global hotkey** — Alt+Shift+L to toggle recording from anywhere
- **Direct cursor injection** — text appears where you're typing; no copy/paste, no clipboard surprises
- **Real-time streaming** — see words land as you speak (powered by Soniox `stt-rt-v5`)
- **Resilient connection** — if the Soniox handshake hangs, the app retries with a fresh socket while buffering your speech, so nothing is lost
- **History panel** — Alt+Shift+K opens the last 100 transcripts; click to paste, copy, or delete
- **Tiny recording popup** — non-focus-stealing pill that shows mic level, elapsed time, and connection state (amber dot = connecting, red = live)
- **Microphone picker** — automatic selection by default, or pin a specific input device in Settings
- **Auto-start with Windows** — runs quietly in the system tray
- **Local API key storage** — your Soniox key stays on your machine

## Requirements

- Windows 10 or 11
- Node.js 20+ and npm
- A [Soniox](https://console.soniox.com) account and API key (free tier available)
- A working microphone (the app picks the best non-virtual input device automatically, or choose one in Settings)

## Getting your Soniox API key

LocalTranscriber uses [Soniox](https://soniox.com) for transcription. You'll need an API key:

1. Sign up at [console.soniox.com](https://console.soniox.com)
2. Create an API key from the dashboard
3. Paste it into the setup screen the first time you launch the app

The key is stored locally in your Windows user data folder (`%APPDATA%/localtranscriber/settings.json`) and is never sent anywhere except directly to Soniox over WebSocket.

## Install & run (from source)

```bash
git clone https://github.com/alaamjaish/electron-whisper.git
cd electron-whisper
npm install
npm run dev
```

On first launch you'll be asked for your Soniox API key. After saving, the window disappears into the tray. Press **Alt+Shift+L** anywhere on Windows to start dictating.

## Build a Windows installer

```bash
npm run build:win
```

This produces an NSIS installer in `dist/`. Double-click to install; LocalTranscriber will run on startup and live in the system tray.

## Usage

| Shortcut | What it does |
|---|---|
| **Alt+Shift+L** | Start / stop recording |
| **Alt+Shift+K** | Open / close history panel |
| Tray menu | Quick access to Start, History, Settings, Quit |

While recording, a small pill appears centered on your active display showing the mic level and elapsed time. It does **not** steal focus — you keep typing into whatever window you had active. Speak, and the text streams in there.

The pill's dot doubles as a connection indicator: **amber** means the app is still connecting (or retrying) to Soniox — keep talking, your audio is buffered — and **red** means transcription is live.

The history panel shows the last 100 transcripts. Click any entry to paste it into your previously focused window. Hover for Copy / Delete.

## How it works

```
[ Mic ] → [ Renderer (React) ] → IPC → [ Main (Electron) ] → WebSocket → [ Soniox stt-rt-v5 ]
                                                                                  │
                                                                                  ▼
[ Active window ] ← Windows SendInput ← [ typing.ts ] ← hypothesis tokens ────────┘
```

- The renderer captures PCM audio at the system sample rate via `getUserMedia` and a `ScriptProcessorNode`.
- PCM Int16 chunks are sent via IPC to the main process.
- The main process forwards them to Soniox's WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`).
- Soniox streams back token responses with `is_final` flags. Final tokens are accumulated into a "committed text" buffer; provisional tokens are appended for live preview.
- On every hypothesis update, [`streamType()`](src/main/typing.ts) diffs the new full text against what's already on screen and sends the minimal sequence of keystrokes via Windows `SendInput` (using `koffi` to call `user32.dll`).
- Hypotheses can revise — but the typing layer caps backspaces at 3 characters to avoid destructive edits in user documents. When a revision lands further back than that, the already-typed region is frozen and the diff switches to comparing consecutive hypotheses, so only genuinely new speech is typed — never shifted or duplicated fragments.
- If the WebSocket handshake hangs (flaky network), the main process retries up to 3 times with a fresh socket while your audio waits in a queue, then flushes it once connected.

For deeper architectural notes see [CLAUDE.md](CLAUDE.md), which is written for AI coding assistants but is just as useful for human contributors.

## Porting to macOS / Linux

LocalTranscriber is Windows-only because the text-injection layer ([`src/main/typing.ts`](src/main/typing.ts)) talks directly to `user32.dll` via [`koffi`](https://www.npmjs.com/package/koffi). Everything else — UI, audio capture, Soniox client, history, settings — is cross-platform.

The cleanest path to a Mac or Linux port:

1. **Fork this repo.**
2. **Open it with an AI coding assistant** like [Claude Code](https://claude.com/claude-code), Cursor, or Aider. The repo includes a [CLAUDE.md](CLAUDE.md) at the root that gives the agent the architectural map it needs.
3. **Give the agent this prompt:**

   > Read `CLAUDE.md` and `src/main/typing.ts`. The whole text-injection layer (SendInput, GetForegroundWindow, SetForegroundWindow) is Windows-only via `koffi` calling `user32.dll`. Replace that file's implementation with the macOS equivalent using either:
   > - `CGEventCreateKeyboardEvent` / `CGEventPost` via FFI to `ApplicationServices.framework`, or
   > - `osascript` shelling out to AppleScript `tell application "System Events" to keystroke ...` (simpler but slower).
   >
   > Keep the public API the same: `streamType(fullText)`, `pasteText(text)`, `resetTyping()`, `saveFocusedWindow()`, `restoreFocusedWindow()`. Update [`src/main/index.ts`](src/main/index.ts) only if you need to reroute around macOS's accessibility-permission flow. Also update the global shortcut in `registerShortcuts()` if Alt+Shift+L conflicts with macOS — `Cmd+Shift+L` is a reasonable substitute.

4. The same approach works for Linux — replace the Windows FFI calls with X11 (`XTestFakeKeyEvent` via `libXtst`) or Wayland (`ydotool`, with caveats).

If you ship a working port, please open a PR or post a link in [Issues](https://github.com/alaamjaish/electron-whisper/issues) — others would love to use it.

## Project layout

```
src/
  main/                Electron main process
    index.ts           App lifecycle, tray, shortcuts, recording orchestration, IPC
    soniox.ts          Soniox WebSocket client
    typing.ts          Windows SendInput / focus management (the platform-specific bit)
    store.ts           JSON persistence for settings + history
    logger.ts          File + console logger
  preload/
    index.ts           contextBridge IPC API
    index.d.ts         TypeScript surface for window.api
  renderer/
    index.html
    src/
      App.tsx          View router
      components/
        SetupScreen.tsx     First-run API key prompt
        SettingsPage.tsx    Edit API key + pick microphone
        RecordingPopup.tsx  The dictation pill (mic, waveform, timer)
        HistoryPanel.tsx    Recent transcripts
```

## Tech stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/)
- React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/) (via `@tailwindcss/vite`)
- [`koffi`](https://www.npmjs.com/package/koffi) for FFI into `user32.dll`
- [`ws`](https://www.npmjs.com/package/ws) for the Soniox WebSocket
- [Soniox](https://soniox.com/) `stt-rt-v5` model

## Privacy

LocalTranscriber sends audio chunks directly to Soniox over an authenticated WebSocket while you are recording, and that's it. No analytics, no telemetry, no third-party servers. Your API key, your transcript history, and the application log all live on your machine in `%APPDATA%/localtranscriber/`.

When you're not recording, no audio is captured.

## Troubleshooting

**"Microphone did not become ready in time"** — Windows blocked microphone access. Settings → Privacy → Microphone → allow desktop apps.

**Shortcut doesn't fire** — another app may already own Alt+Shift+L. Quit conflicting apps or fork this repo and change the binding in `registerShortcuts()` in [`src/main/index.ts`](src/main/index.ts).

**Text appears in the wrong window** — LocalTranscriber saves the foreground window the moment you press the shortcut and types into that. If you click a different window after starting recording, your clicks win. Press the shortcut while focused on your target.

**The dot stays amber and nothing types** — the connection to Soniox is slow or down. The app retries automatically (up to 3 attempts) and buffers what you say in the meantime; if it still fails, the popup closes. Check your internet connection and try again.

**Wrong microphone picked up** — open Settings (tray menu) and choose your device from the Microphone dropdown instead of Automatic.

**Logs** — `%APPDATA%/localtranscriber/app.log` has timestamped logs of every session (capped at 10 MB, rotated to `app.old.log`). Attach it to issues.

## Contributing

Pull requests welcome. Good first contributions:

- macOS / Linux port (see above)
- Configurable shortcuts in the Settings page
- Optional language picker / Soniox model picker
- A proper "open external link" handler for the API key signup link in the setup screen

## License

[MIT](LICENSE) — © Alaa M. Jaish
