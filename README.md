# Reverse YouTube Playlist (Firefox)

A small, single-purpose Firefox extension that plays a YouTube playlist in
**reverse order** — bottom to top (oldest-first becomes newest-first, etc.).

It adds a **Reverse** toggle button to the playlist panel on a watch page. When
toggled ON, ending a video (autoplay) or clicking the player's *Next* button
takes you to the **previous** item in the playlist instead of the next one. When
you reach the top of the list, playback stops.

## How it works

This is **purely client-side**. It does not log into your Google account, use
the YouTube Data API, or change the saved order of your playlist on YouTube's
servers. A content script:

1. Reads the ordered list of items from the playlist panel
   (`ytd-playlist-panel-video-renderer`).
2. Intercepts "advance" actions — the `<video>` `ended` event (autoplay) and
   clicks on the `.ytp-next-button`.
3. Navigates to the **previous** item's URL instead.

The toggle state is remembered per-playlist via `storage.local`, so it survives
in-app (single-page-app) navigation between videos in the same playlist.

## Install for development (temporary)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select the `manifest.json` file in this folder.
4. Open any multi-video playlist watch URL, e.g.
   `https://www.youtube.com/watch?v=...&list=...`.

Temporary add-ons are removed when Firefox restarts.

### Smoother dev loop (optional)

```bash
npm install -g web-ext
web-ext run        # launches Firefox with the extension auto-reloaded on save
web-ext lint       # validates the manifest before any packaging/submission
```

## Usage

- Open a playlist watch page; a **Reverse** button appears in the playlist panel.
- Click it to toggle reverse playback (the button highlights blue when ON).
- Let a video end, or press Next — it goes to the previous video.
- At the first item, playback stops (no wrap-around).

## Known limitations

- **YouTube's DOM changes often.** If the button stops appearing or reversal
  stops working after a YouTube update, the selectors at the top of
  `src/content.js` (the `SEL` object) are the place to fix.
- Reverses **playback/navigation only** — the visible sidebar list is not
  re-ordered, and your saved playlist is never modified.
- Icons use a single SVG (supported by Firefox); Chrome would need raster PNGs.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (Firefox `gecko` settings, content script registration) |
| `src/content.js` | Core logic: button injection, list reading, next/ended interception, navigation, persistence |
| `src/button.css` | Styling for the injected Reverse button |
| `icons/icon.svg` | Extension icon |
