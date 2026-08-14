# Add-to-Local-Playlist — scoped redesign

**Date:** 2026-08-14
**Status:** approved, implementing
**Affects:** v3.3.0 (unreleased)

## Problem

The "add any video to a local playlist" feature shipped three defects found in live testing:

1. **Wrong video added.** The `＋ Add` pill was injected into every card matching
   `CARD_SELECTORS`, which includes `yt-lockup-view-model` — YouTube's card format for
   *courses and playlists*, not only videos. `extractCardVideoInfo` then took the first
   `a[href*='/watch?v=']` in the card, which on a course card is lesson #1. The button
   appeared to offer "Advanced Python – Complete Course" and added "Lists in Python – 01".

2. **Added videos counted but never shown.** A snapshot's `order` is a list of *positions
   inside a real YouTube playlist*. It is a view over YouTube's data, not a container.
   Appending a foreign `videoId` incremented the count, but playback navigates to
   `&list=<real playlist>`, where the added video does not exist and cannot appear.
   The previous workaround — `syncCustomSnapshotItems`, which injected fake rows into
   YouTube's real sidebar with colliding indices — is what corrupted reverse, reorder and
   the video counts. It was deleted separately.

3. **Buttons everywhere.** Per-card injection ran on every card of every YouTube page.

## The rule

A snapshot is exactly one of two kinds, decided by `sourceListId`:

| Kind | `sourceListId` | Plays via | Contents |
|------|----------------|-----------|----------|
| **View** over a YouTube playlist | the playlist id | `&list=<id>&index=<n>` | YouTube's items, reordered |
| **Local playlist** | `""` | `#ryp_list=<snapshot id>&ryp_index=<n>` | arbitrary videos, rendered by our own panel |

**Add-video targets local playlists only.** Views are never offered as a destination, which
makes "counted but not shown" structurally impossible — no conversion or migration logic.

## Changes

### Remove
- `CARD_SELECTORS`, `injectCardActionButtons`, `extractCardVideoInfo` (`src/content.js`)
- the `pendingRoots` / `MAX_PENDING_ROOTS` mutation-roots machinery — it existed only to make
  whole-document card scanning affordable; the observer returns to a plain throttle
- `.ryp-card-add-pill`, `.ryp-card-add-icon`, `.ryp-card-add-text` (`src/button.css`)

### Keep
- `＋ Add to Playlist` under the video player on watch pages (`injectWatchActionButton`)
- the popup's "Add Current Video to Playlist" button

Both act on the video currently being watched, so the target is never ambiguous.

### Fix
- `showAddToPlaylistModal` lists only local playlists as targets, under a `localPlaylists`
  heading (en/fr/ar) so the absence of playlist snapshots is self-explanatory.
- "Create & Add" writes `sourceListId: ""`. It previously wrote
  `Playlist.getPlaylistId() || "custom"`, so any list created from inside a playlist page was
  born as a view and could never receive further videos.
- Snapshot counts read `videos.length` everywhere (`panel.js`, `popup.js` used `order.length`).

## Migration

None. The feature is new in 3.3.0, which has not been released, so no user data contains
mixed-kind snapshots.

## Tests

`tests/test_add_to_playlist.js`:
- adding a video to a local playlist appends to both `videos` and `order`
- the target filter excludes snapshots that carry a `sourceListId`
- a list created from inside a playlist page still gets `sourceListId: ""`

Translation parity for the new `localPlaylists` key is covered automatically by
`tests/test_translations.js`.

## Addendum — verified 2026-08-14 (Chromium, live YouTube)

Live testing found the virtual-playlist mechanism could never have worked: **YouTube
strips unknown query params from watch URLs**, so `?ryp_list=…` was gone before the
content script ran (`?v=X&ryp_list=Y` → `?v=X`). The URL *fragment* survives untouched,
so the params moved there — `Playlist.rypParams()` / `Playlist.rypHash()`. Verified
end to end: a two-video local playlist plays, both items render in our panel, and
clicking item 2 round-trips with the right selection.

Two further live findings, both fixed:

- **The overview page migrated to `yt-lockup-view-model`.** `ytd-playlist-video-renderer`
  no longer exists there, so the page read zero items. Selectors updated
  (`.ytBadgeShapeText` for duration, `h3` / `ytLockupMetadataViewModelTitle` for title).
- **Scrolling a playlist page loads recommendation shelves built from that same
  element**, which inflated the count 119 → 130 and sent "Play Reverse" to an index
  YouTube rejects (silently resetting to position 1). Items are now filtered by
  `list=<current playlist>`, and the overview no longer sends an `&index=` at all —
  `v` + `list` lets YouTube resolve the position itself.
