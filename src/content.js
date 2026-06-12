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
  //
  // YouTube mutates the DOM constantly (progress bar, chat, ads), so the
  // observer callback only schedules work: the real pass runs at most once
  // per OBSERVER_THROTTLE_MS instead of on every mutation record.

  const OBSERVER_THROTTLE_MS = 150;
  let observerTimer = null;

  function onDomSettled() {
    observerTimer = null;
    if (!Playlist.isPlaylistWatchPage()) return;

    if (!document.getElementById(TOOLBAR_ID)) {
      Toolbar.injectToolbar();
      Toolbar.syncButtonStates();
    }

    // Re-apply visual order and watched badges so YouTube re-renders cannot
    // silently reset our styling.
    Sidebar.applyVisualOrder();
    Sidebar.applyWatchedBadges();
    if (Sidebar.isReorderModeOn()) Sidebar.refreshDraggable();
  }

  const ensureObserver = new MutationObserver(() => {
    if (observerTimer !== null) return;
    observerTimer = setTimeout(onDomSettled, OBSERVER_THROTTLE_MS);
  });

  ensureObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  // ── Message Listener ──────────────────────────────────────────────────────
  const api = typeof browser !== "undefined" ? browser : chrome;
  api.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SAVE_PLAYLIST") {
      if (Playlist.isPlaylistWatchPage()) {
        Panel.saveCurrentOrder(request.name).then(() => {
          if (Panel.isPanelVisible()) {
            Panel.renderList();
          }
          sendResponse({ success: true });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: "Not on a playlist page" });
      }
    }
  });

  window.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("yt-navigate-finish", onNavigate);
  onNavigate();
})();
