# YouTube Playlist Tools — Reverse, Shuffle & Reorder (Firefox)

> **Reverse, shuffle, drag-reorder, and save YouTube playlists — locally, privately, with zero logins.**

[![Version](https://img.shields.io/badge/version-3.6.0-blue?style=flat-square)](https://github.com/ibhar/YTB_REV_PLAYLIST/releases)
[![Firefox](https://img.shields.io/badge/Firefox-≥140-orange?style=flat-square&logo=firefox)](https://addons.mozilla.org/firefox/addon/reverse-youtube-playlist-order/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Privacy: No data collected](https://img.shields.io/badge/Privacy-No%20data%20collected-brightgreen?style=flat-square)]()

---

## ✨ Features

| Button | What it does |
|--------|-------------|
| **⮃ Reverse** | Plays the playlist last-to-first. Great for watching a series from newest to oldest or a course in chronological upload order. Toggle persists per playlist. |
| **⤮ Shuffle** | Fisher-Yates randomises the play order and remembers it so the same random sequence survives in-app navigation. |
| **⇅ Sort** | Smart sorting presets: Title A→Z, Title Z→A, Shortest first, Longest first, Channel A→Z, Unwatched first, Watched first. |
| **⠿ Reorder** | Enables drag-and-drop on the sidebar with quick ⤒ Top / ⤓ Bottom move helpers. Custom order is saved automatically. |
| **⚡ Load All** | Resolves lazy-loading for long playlists (> 50 items) with a single click. |
| **⏱️ Watch Time** | Live duration calculator showing total time, watched time, remaining time, and 1.25x/1.5x/2x speed estimates. |
| **＋ Add to List** | Add the video you're watching to a local playlist — a list you build yourself, held entirely in local storage and played from the extension's own sidebar. Available under the player and from the popup. |
| **🎵 My Lists** | Opens a slide-in panel to name and save a snapshot of the current order. Playing a snapshot restores its exact saved order — your lists are permanent. |
| **📄 Export list** | Copy a playlist as text, or download it as .txt / .csv, in the order you're playing it. Works on playlists, playlist pages and saved lists. |
| **📤 Import / Export** | Back up all saved playlists to a JSON file and restore them anywhere — portable across devices and browser profiles. |
| **⏯️ Resume** | A one-click prompt jumps back to the video and timestamp where you left off in any playlist. |
| **# Tags** | Add tags to snapshots and filter saved lists by name or tag. |
| **🔁 Loop** | Optional setting: when the active play order ends, start it over instead of stopping. |
| **✓ Watched badges** | A badge appears on fully watched videos with optional auto-skipping. |
| **⌨️ Shortcuts** | Alt+Shift+O Reverse · Alt+Shift+S Shuffle · Alt+Shift+K Add to list · Alt+Shift+L Load all. Rebind them on the browser's extension-shortcuts page. |
| **📊 Your stats** | The popup shows hours watched in playlists, time saved by playback speed and videos finished, with a Share button that copies a ready-made message. Stored locally only. |
| **👋 Welcome page** | Opens on first install: language, a 3-step guide, your shortcuts, and which buttons to show. Reopen it from the popup's "Guide & shortcuts". |

---

## 🔒 Privacy first

- **No API calls.** We never contact YouTube's servers, Google, or any third party.
- **No Google login.** Zero OAuth, zero account access.
- **Only `storage` + `activeTab` permissions.** Everything lives in your browser's own `storage.local` — on your device, nowhere else.
- **No telemetry.** Not even a ping.

---

## 🚀 How it works

A content script runs on `youtube.com` watch and overview pages. It:

1. Reads playlist items to build and calculate the play order.
2. Intercepts the `timeupdate` event ~0.35 s before the video ends to pre-empt YouTube's autoplay-forward and navigate to the correct next item instead.
3. Stores all state (mode flags, custom order, watched video IDs, saved snapshots) in `browser.storage.local`.
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
  backup.js            Shared import/export helpers — validate, merge, download (RYP.Backup)
  state.js             Storage key definitions + read/write helpers (RYP.State)
  playlist.js          DOM reading, navigation, duration parser, lazy-loader (RYP.Playlist)
  playback.js          Reverse / shuffle / smart sorting / custom-order engine (RYP.Playback)
  sidebar.js           Visual ordering, drag-and-drop, quick move buttons (RYP.Sidebar)
  panel.js             Slide-in saved-playlists panel & universal Add to List modal (RYP.Panel)
  toolbar.js           Button injection, sort dropdown, duration pill, overview bar (RYP.Toolbar)
  content.js           Bootstrap: wires modules, MutationObserver, SPA nav events, shortcut commands
  links.js             Store / review URLs for the browser in use (RYP.Links)
  stats.js             Local usage stats + one-time rating prompt (RYP.Stats)
  background.js        Forwards keyboard shortcuts to the tab; opens the welcome page on install
  button.css           Full design-system CSS (tokens, dropdowns, duration pills, modal)
icons/
  icon-16.png
  icon-48.png
  icon-128.png
```

---

## 📋 Changelog

### v3.6.0 — 2026-11
- ✨ **Export a playlist as text or CSV** — copy to the clipboard or download .txt / .csv, in the order shown (Reverse, Shuffle, Sort or custom), from the playlist toolbar, the playlist page, or any saved list in My Lists. The CSV opens correctly in Excel, Arabic included, and is protected against formula injection.
- 🐛 **My Lists card icons** — the delete (trash) icon had no size and was invisible, and the Play triangle overflowed its button.
- 🧱 **Orders are keyed by video id.** Custom, shuffle and sort orders used to store playlist positions, which pointed at the wrong videos as soon as the playlist owner added or removed one (Watch Later shifts on every add). Saved orders now survive edits; old ones are converted automatically as their rows appear, and snapshots replay by id.
- 🧱 **Long playlists.** Shuffle, Sort, Reverse and Save load the whole playlist first (YouTube only renders ~200 rows), and a next video whose row isn't rendered is reached through its URL instead of silently falling back to YouTube's order.
- 🧱 **Your click wins.** Clicking the video right after the current one used to be "corrected" back to the mode's order. Now only a real end-of-video auto-advance is redirected.
- ✨ **Keyboard shortcuts** for Reverse, Shuffle, Add to list and Load all (manifest `commands`, rebindable). Keys were checked against Chrome's reserved list — Alt+Shift+R and Alt+Shift+A are taken by the browser.
- ✨ **Welcome page** on first install, also reachable from the popup.
- ✨ **Your stats** card in the popup with a Share button.
- ✨ **One-time rating prompt** after five real uses; never shown again. The review link now opens the store of the browser you're in (it always pointed to AMO).
- 🐛 **Watched badges** were hidden on a fresh install until a setting was saved, so the "Show watched badges" toggle looked like it did nothing.
- 🐛 Backups of Watch Later / Liked videos snapshots were rejected on import; import dropped channels and re-importing your own backup duplicated lists.
- 🐛 Reorder did nothing on local playlists; Reset left their custom order behind; Resume on a local playlist opened a broken URL; seeking back after an end-of-order stop let YouTube autoplay.

### v3.5.0 — 2026-09
- 🐛 **Refreshing no longer jumps to the next video.** Reloading the page, or opening a playlist video in a new tab, skipped ahead in Reverse/Shuffle/custom orders: YouTube started rewriting the playlist position in the address bar on every load, which read as an auto-advance.
- 🐛 **No more replaying the same video after a refresh** — positions now come from the playlist panel, not the address bar.

### v3.4.0 — 2026-09
- ✨ **Disable autoplay** — a setting that stops each playlist video just before its end instead of letting YouTube (or the extension's own order) roll into the next one. The end of a Reverse/Shuffle order now holds as well.
- ✨ **Button visibility** — hide any toolbar button you never use (Reverse, Shuffle, Sort, Reorder, Reset, Save, My Lists, Duration, Load All, Add to Playlist) from the popup's settings.
- ✨ **Settings travel with backups** — export now includes your settings, and import restores them alongside your playlists.
- 🐛 **Add to Playlist button** now always sits under the video, next to Like/Share; it used to land in the playlist panel header and squeeze the playlist title.

### v3.3.0 — 2026-08
- ✨ **Smart Sorting Dropdown** — 1-click sorting presets: Title A→Z, Title Z→A, Duration (shortest/longest), Channel A→Z, Watched/Unwatched first.
- ✨ **Lazy Loading "Load All" Resolver** — one-click fast auto-scroll loader for long playlists (> 50 items) so Reverse, Shuffle, Sort, and Snapshots work on the 100% complete playlist.
- ✨ **Playlist Duration & Speed Calculator** — live pill displaying total duration, watched time, remaining time, and speed breakdowns (1.25x, 1.5x, 1.75x, 2.0x).
- ✨ **Overview Page Support (`/playlist?list=...`)** — Play in Reverse, Play Shuffled, or Save Snapshot directly from YouTube playlist overview tables.
- ✨ **Local playlists** — build your own playlist from videos you watch, via the ＋ button under the player or the popup. Local playlists live only in browser storage and play from the extension's own sidebar, so they can hold any video regardless of what YouTube's playlists contain.
- ✨ **Quick Move Helpers** — ⤒ Move to Top and ⤓ Move to Bottom action buttons in sidebar Reorder mode.
- 🎨 **Responsive Toolbar Redesign** — compact density with dropdown menus preventing wrapping on narrow sidebars and small screens.

### v3.2.0 — 2026-07
- ✨ **Snapshot tags and filtering** — add comma-separated tags and search saved snapshots by name or tag
- ✨ **Safer snapshot saves** — when snapshots already exist for a playlist, choose one to update or create a new snapshot
- 🐛 **My Lists state sync** — the toolbar button now resets when the panel closes from its close button, an outside click, or navigation
- 🐛 **Firefox popup storage fixed** — popup and toolbar storage access now consistently uses Firefox's Promise API
- 🐛 **Ordering and navigation fixes** — reversed snapshots save correctly, drag/drop follows the visible order, and stale SPA state can no longer overwrite another playlist
- 🗂 **Backup schema v2** — tags are included in exports, imports are validated more strictly, and exact duplicates are skipped safely

### v3.1.0 — 2026-06
- ✨ **Resume where you left off** — playback position is recorded per playlist (locally); a toast offers a one-click jump back to your last video + timestamp. Toggle in settings.
- ✨ **Import/Export in the in-page panel** — backup buttons no longer require opening the popup; logic shared via `src/backup.js`
- ✨ **Snapshot tags and safer updates** — filter by tags and choose whether to update an existing snapshot from the same playlist or create a new one
- 🐛 **Player Next/Prev follow the active order** — pressing YouTube's next button (or Shift+N/Shift+P) in reverse/shuffle/custom mode no longer exits the playlist; it now navigates by the extension's order
- 🐛 **Sidebar auto-scrolls to the playing video** when a reordering mode is active (previously the scroller rested at the visual bottom after reversing)
- 🐛 **RTL fixes** — save dialog, toasts, and meta text now mirror and translate correctly in Arabic
- 🐛 **Popup import actually works** — Firefox closes browser-action popups when the OS file picker opens, so import now runs in a dedicated tab with drag-and-drop support
- 🎨 **Popup redesign** — language selector always visible in the header, labeled Export/Import buttons in a footer bar, snapshot count badge, section header, and more generous spacing

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

## ❤️ Support

If this extension saves you time, consider supporting its development:

→ **[Support this project](./SUPPORT.md)**

---

## 📄 License

[MIT](./LICENSE) © 2025-2026 benmoussa
