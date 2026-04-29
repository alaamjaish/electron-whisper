# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LocalWispr** — A Windows-only desktop voice-to-text app that lives in the system tray. Press Alt+Shift+L to record speech, which streams through Soniox's real-time STT API and types the transcription directly at the user's cursor in any application. No clipboard is used during dictation — text is injected via Windows SendInput API.

## Commands

```bash
npm run dev        # Start in dev mode (electron-vite dev)
npm run build      # Build for production (electron-vite build)
npm run build:win  # Build + package Windows installer (electron-builder)
```

No test framework is configured.

## Architecture

**Stack:** Electron + electron-vite + React 19 + TypeScript + Tailwind CSS v4

Three Electron layers with distinct roles:

- **Main process** (`src/main/`) — Orchestrates recording sessions, manages window/tray, handles IPC, connects to Soniox WebSocket, drives text injection
- **Preload** (`src/preload/index.ts`) — IPC bridge exposing `window.api` to renderer
- **Renderer** (`src/renderer/`) — React UI with view-based routing (no router library — main process sends `navigate` IPC to switch views)

### Recording Flow (critical path)

1. User presses Alt+Shift+L → `startRecording()` in main
2. Main saves focused window handle (`GetForegroundWindow`), shows recording popup with `showInactive()` (no focus steal)
3. `RecordingPopup` mounts → starts mic via `getUserMedia` → sends `mic-ready` IPC
4. Main receives `mic-ready` → creates `SonioxClient` → connects WebSocket
5. Renderer sends PCM Int16 audio chunks via IPC → main forwards to Soniox
6. Soniox sends token responses → `SonioxClient` builds full hypothesis (`committedText + pendingText`) → single callback
7. `streamType()` in typing.ts diffs against what's already on screen, sends minimal keystrokes via SendInput
8. User presses Alt+Shift+L again → `stopRecording()` → navigates to 'idle' (unmounts RecordingPopup for clean next session)

### Key Design Decisions

**Append-only typing with MAX_BACKSPACE=3:** Soniox revises hypotheses which could delete large chunks of text. The typing system never backspaces more than 3 chars. For large revisions where text grew, it appends only the new tail. For shrinking revisions, it does nothing.

**Full hypothesis pattern:** `soniox.ts` accumulates all finalized tokens into `committedText` and sends `committedText + pendingText` as a single string. This prevents flicker from separate final/pending callbacks.

**Session unmount pattern:** `stopRecording()` navigates to 'idle' so RecordingPopup unmounts. Next `startRecording()` causes a fresh mount with new mic capture. Without this, React won't re-run the useEffect since the view value doesn't change.

**No React StrictMode:** Removed because double-mount in dev caused duplicate mic-ready signals and double Soniox connections.

**History paste uses clipboard + Ctrl+V:** Unlike dictation (which uses SendInput character-by-character), history paste writes to clipboard and simulates Ctrl+V for instant paste of any length text.

### Windows Native Integration (`src/main/typing.ts`)

Uses `koffi` FFI to call `user32.dll`:
- `SendInput` — inject keystrokes (KEYEVENTF_UNICODE for multilingual support)
- `GetForegroundWindow` / `SetForegroundWindow` — focus management
- `sizeof(INPUT) = 40` on x64, KEYBDINPUT fields at offsets: type=0, wVk=+8, wScan=+10, dwFlags=+12

### Data Storage (`src/main/store.ts`)

JSON files in `app.getPath('userData')`:
- `settings.json` — API key
- `history.json` — last 100 transcriptions

## Global Shortcuts

- **Alt+Shift+L** — Toggle recording
- **Alt+Shift+K** — Toggle history panel


لما تسوي commit اكتب تفاصيل كفاية في الوصف حتى نستطيع نرجع لههم بسهولة بالمستتقبل