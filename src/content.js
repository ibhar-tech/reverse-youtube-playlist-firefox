/*
 * YouTube Playlist Tools — content.js
 *
 * Bootstrap: wires modules together and drives the observe/navigate lifecycle.
 * All feature logic lives in the individual modules (state, playlist, playback,
 * sidebar, panel, toolbar). This file is intentionally thin.
 *
 * Load order (manifest.json):
 *   state → playlist → playback → sidebar → panel → toolbar → content
 */
(() => {
  "use strict";

  const { Playlist, Playback, Sidebar, Panel, Toolbar } = window.RYP;
  const TOOLBAR_ID = "ryp-toolbar";

  // ── Navigation handler ────────────────────────────────────────────────────

  async function onNavigate() {
    if (!Playlist.isPlaylistWatchPage()) {
      Playback.handleNavigation();
      return;
    }

    const listId = Playlist.getPlaylistId();

    // Restore persisted modes for this playlist.
    await Playback.loadState(listId);

    // Inject UI (idempotent — each returns early if already present).
    Toolbar.injectToolbar();
    Panel.injectPanel();

    // Apply visual state to the sidebar.
    Sidebar.applyVisualOrder();
    await Sidebar.applyWatchedBadges();

    // Sync toolbar button appearance to the loaded state.
    Toolbar.syncButtonStates();

    // Let the playback engine register the new index (handles fallback forward-skip).
    Playback.handleNavigation();
  }

  // ── Mutation observer ─────────────────────────────────────────────────────
  // Re-injects toolbar whenever YouTube removes it (SPA navigation, panel
  // re-render triggered by window resize or DevTools).

  const ensureObserver = new MutationObserver(() => {
    if (!Playlist.isPlaylistWatchPage()) return;

    if (!document.getElementById(TOOLBAR_ID)) {
      Toolbar.injectToolbar();
      Toolbar.syncButtonStates();
    }

    // Re-apply visual order and watched badges after every DOM mutation so
    // YouTube re-renders cannot silently reset our styling.
    Sidebar.applyVisualOrder();
    if (Sidebar.isReorderModeOn()) Sidebar.refreshDraggable();
  });

  ensureObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  window.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("yt-navigate-finish", onNavigate);
  onNavigate();
})();
