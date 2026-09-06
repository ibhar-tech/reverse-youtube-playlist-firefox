# Chrome Web Store screenshots

The Chrome Web Store has no screenshot API, so these go up by hand. The five
PNGs in this folder are copies of the AMO set (1280×800, 24-bit RGB, no alpha —
exactly what the store accepts; it takes at most five).

Regenerate the source set with `python3 tests/capture_screenshots.py`, then
copy the five you want here.

## Upload steps

1. Open the Developer Dashboard: https://chrome.google.com/webstore/devconsole
2. Pick **YT Playlist Tools** (item `gbdcdgleohhjajeabaebidlfhenlgmgo`).
3. Left menu → **Store listing** → scroll to **Graphic assets**.
4. Under **Screenshots**, delete the old 3.2.0 images (hover → ✕), then click
   **Upload** and add the five files in this order:
   1. `screenshot-1-reverse.png` — reverse mode + toolbar
   2. `screenshot-2-sort.png` — sort dropdown
   3. `screenshot-5-local-playlist.png` — local playlist + Add to Local Playlist button
   4. `screenshot-7-popup.png` — popup with saved lists
   5. `screenshot-8-settings.png` — the 3.4.0 settings: disable autoplay, button visibility
5. Drag to reorder if the store scrambled them. Click **Save draft**.
6. Click **Submit for review**. If a version is already under review (the
   3.4.0 package submitted today), the listing changes ride along with it —
   there is no separate review for graphics.

Optional, same section: a **small promo tile** (440×280) is what makes the
listing eligible for featuring; the store falls back to the icon without it.
