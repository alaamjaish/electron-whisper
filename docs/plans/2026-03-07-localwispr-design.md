# LocalWispr Design

## Overview
LocalWispr is a Windows desktop voice-to-text utility. User presses a shortcut, speaks, and words stream directly to their cursor in real-time. A separate history view lets them revisit and copy past transcripts.

## Architecture

Three layers:
- **Electron Main Process** — global shortcuts, system tray, auto-start, keyboard simulation, file storage
- **Electron Renderer (React + Tailwind)** — recording popup, history panel, settings/setup screens
- **Soniox API** — WebSocket streaming with model `stt-rt-v4`

## User Flows

### First Launch
1. App starts, shows setup screen
2. User pastes Soniox API key
3. Key saved to `settings.json`
4. App minimizes to system tray

### Dictation (Alt+Shift+L)
1. User presses Alt+Shift+L
2. Tiny dark popup appears (centered, draggable) with mic icon + waveform
3. Mic captures audio, streams to Soniox via WebSocket
4. Words returned in real-time, typed at cursor via nut.js keyboard simulation
5. User presses Alt+Shift+L again to stop
6. Popup closes, full transcript saved to history

### History (Alt+Shift+K)
1. User presses Alt+Shift+K
2. History panel shows past transcripts with timestamps
3. User can copy text or delete entries
4. Press Alt+Shift+K again to close

## Tech Stack
- Electron (framework)
- React + Tailwind CSS (UI)
- TypeScript (language)
- nut.js (keyboard simulation)
- Soniox WebSocket API, model stt-rt-v4
- Electron Forge (packaging)

## Data Storage
Simple JSON files in user's app data folder:
- `settings.json` — API key
- `history.json` — Array of { id, text, timestamp }

## UI Specs
- Dark theme (dark background, light text)
- Recording popup: tiny, centered, draggable, shows mic + animated waveform + "Recording..." label
- History panel: scrollable list, each entry has copy and delete buttons, shows timestamp
- Settings page: API key input field, save button

## Shortcuts
- Alt+Shift+L — toggle recording
- Alt+Shift+K — toggle history
