# YouTube Playlist Tools — Reverse, Shuffle & Reorder (Firefox)

> **Reverse, shuffle, drag-reorder, and save YouTube playlists — locally, privately, with zero logins.**

[![Version](https://img.shields.io/badge/version-3.0.0-blue?style=flat-square)](https://github.com/ibhar/YTB_REV_PLAYLIST/releases)
[![Firefox](https://img.shields.io/badge/Firefox-≥140-orange?style=flat-square&logo=firefox)](https://addons.mozilla.org/firefox/addon/reverse-youtube-playlist-order/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Privacy: No data collected](https://img.shields.io/badge/Privacy-No%20data%20collected-brightgreen?style=flat-square)]()

---

## ✨ Features

| Button | What it does |
|--------|-------------|
| **⮃ Reverse** | Plays the playlist last-to-first. Great for watching a series from newest to oldest or a course in chronological upload order. Toggle persists per playlist. |
| **⤮ Shuffle** | Fisher-Yates randomises the play order and remembers it so the same random sequence survives in-app navigation. |
| **⠿ Reorder** | Enables drag-and-drop on the sidebar. Drag any video to a new position; the custom order is saved automatically. |
| **🎵 My Lists** | Opens a slide-in panel to name and save a snapshot of the current order. Playing a snapshot restores its exact saved order — your lists are permanent. |
| **📤 Import / Export** | Back up all saved playlists to a JSON file and restore them anywhere — portable across devices and Firefox profiles. |
| **🔁 Loop** | Optional setting: when the active play order ends, start it over instead of stopping. |
| **✓ Watched badges** | A blue ✓ badge appears on any video you've fully watched. Tracked by video ID, so badges survive playlist edits. Optional auto-skip of watched videos. |

---

## 🔒 Privacy first

- **No API calls.** We never contact YouTube's servers, Google, or any third party.
- **No Google login.** Zero OAuth, zero account access.
- **Only `storage` + `activeTab` permissions.** Everything lives in your browser's own `storage.local` — on your device, nowhere else.
- **No telemetry.** Not even a ping.

---

## 🚀 How it works

A content script runs on `youtube.com` watch pages that have a `?list=` parameter. It:

1. Reads sidebar items (`ytd-playlist-panel-video-renderer`) to build the play order.
2. Intercepts the `timeupdate` event ~0.35 s before the video ends to pre-empt YouTube's autoplay-forward and navigate to the correct next item instead.
3. Stores all state (mode flags, custom order, watched indices, saved snapshots) in `browser.storage.local` keyed by playlist ID.
4. Re-injects the toolbar after every YouTube SPA navigation via a `MutationObserver` + `yt-navigate-finish` listener.

Nothing is changed on YouTube's servers. Purely client-side.

---

## 📦 Install for development

```bash
# Option A: Load as temporary add-on
# 1. Open Firefox → about:debugging#/runtime/this-firefox
# 2. Click "Load Temporary Add-on…" → select manifest.json

# Option B: web-ext (auto-reload on save)
npm install -g web-ext
web-ext run          # launches Firefox, reloads on every file save
web-ext lint         # validate manifest before submission
```

---

## 🗂 Project structure

```
manifest.json          MV3 manifest — file load order, permissions, metadata
src/
  state.js             Storage key definitions + read/write helpers (RYP.State)
  playlist.js          DOM reading, navigation, YouTube selector constants (RYP.Playlist)
  playback.js          Reverse / shuffle / custom-order engine + watch tracking (RYP.Playback)
  sidebar.js           Visual ordering, drag-and-drop, watched badges (RYP.Sidebar)
  panel.js             Slide-in saved-playlists panel (RYP.Panel)
  toolbar.js           Button injection and state sync (RYP.Toolbar)
  content.js           Bootstrap: wires modules, MutationObserver, SPA nav events
  button.css           Full design-system CSS (tokens, buttons, panel, toast, badges)
icons/
  icon-16.png
  icon-48.png
  icon-128.png
```

---

## ⚙️ Architecture — module namespace

All modules share the `window.RYP` global namespace. Script load order in `manifest.json` guarantees each module's dependencies are defined before it runs:

```
window.RYP.State     ← state.js
window.RYP.Playlist  ← playlist.js   (needs State)
window.RYP.Playback  ← playback.js   (needs State, Playlist)
window.RYP.Sidebar   ← sidebar.js    (needs Playlist, Playback, State)
window.RYP.Panel     ← panel.js      (needs State, Playlist, Playback)
window.RYP.Toolbar   ← toolbar.js    (needs Playlist, Playback, Sidebar, Panel)
bootstrap            ← content.js    (needs all of the above)
```

---

## 🐛 Known limitations

- **YouTube's DOM changes often.** If the toolbar stops appearing, the selectors in `src/playlist.js` (`SEL` object) are the place to fix.
- **Sidebar items must be loaded.** YouTube lazy-loads playlist items on scroll; the custom order only covers what's visible at enable time.
- **Watched tracking is per-device.** No cloud sync — by design.

---

## 📋 Changelog

### v3.0.0 — 2026-06
- ✨ **Import / Export** — back up saved playlists to a JSON file and restore them anywhere
- ✨ **Permanent playlists** — playing a saved snapshot now restores its exact saved order
- ✨ **Loop mode** — optional setting to restart the active play order when it ends
- 🐛 **Watched tracking fixed in reverse/shuffle modes** — videos are now marked before the pre-end navigation
- 🐛 **Watched badges keyed by video ID** — badges no longer drift when the playlist owner edits the list (legacy data migrates automatically)
- 🐛 **Clean stop at end of order** — reverse playback no longer falls through to YouTube's autoplay-forward
- 🐛 **Popup Save section** only appears on watch pages where saving actually works
- ⚡ **Performance** — MutationObserver work is throttled and skipped when no mode is active

### v2.0.0 — 2026-06
- ✨ **Shuffle mode** — persistent Fisher-Yates random order
- ✨ **Drag-to-reorder** — custom play order via sidebar drag-and-drop
- ✨ **Save snapshots** — name and save any custom order to `storage.local`
- ✨ **"My Lists" in-page panel** — slide-in panel to manage saved snapshots
- ✨ **Watched badges** — ✓ badge on fully-played videos
- ♻️ **Modular rewrite** — split into 6 focused modules (state, playlist, playback, sidebar, panel, toolbar)
- 🎨 **Full CSS design system** — tokens, dark-mode compatible, micro-animations

### v1.0.6 — 2025
- 🐛 Selector fixes for YouTube DOM updates

### v1.0.0 — 2025
- 🎉 Initial release: Reverse playback mode

---

## 📄 License

[MIT](./LICENSE) © 2025-2026 benmoussa
