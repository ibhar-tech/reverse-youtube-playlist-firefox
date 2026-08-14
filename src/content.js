/*
 * YouTube Playlist Tools — content.js
 *
 * Bootstrap: wires modules together and drives the observe/navigate lifecycle.
 * Supports /watch (with or without playlist) and /playlist overview pages.
 *
 * Load order (manifest.json):
 *   backup → state → playlist → playback → sidebar → panel → toolbar → content
 */
(() => {
  "use strict";

  const { Playlist, Playback, Sidebar, Panel, Toolbar } = window.RYP;
  const TOOLBAR_ID = "ryp-toolbar";
  const ADD_VIDEO_BTN_ID = "ryp-add-video-btn";
  let navigationEpoch = 0;
  let activeListId = null;
  let stateReadyListId = null;

  // ── Navigation handler ────────────────────────────────────────────────────

  async function onNavigate() {
    const epoch = ++navigationEpoch;

    // Ensure panel drawer & modal system is ready on all pages
    Panel.injectPanel();

    // 1. Overview playlist page (/playlist?list=...)
    if (Playlist.isOverviewPlaylistPage()) {
      stateReadyListId = null;
      Sidebar.disableReorderMode();
      Panel.togglePanel(false);
      activeListId = null;
      Toolbar.injectOverviewToolbar();
      return;
    }

    // 2. Not a watch page at all
    if (!Playlist.isWatchPage()) {
      stateReadyListId = null;
      Sidebar.disableReorderMode();
      Panel.togglePanel(false);
      activeListId = null;
      Playback.handleNavigation();
      return;
    }

    // 3. Any watch page: inject "+ Add to Local Playlist" button under the video player
    injectWatchActionButton();

    // 4. Standalone watch page (no playlist)
    if (!Playlist.isPlaylistWatchPage()) {
      stateReadyListId = null;
      document.getElementById(TOOLBAR_ID)?.remove();
      Sidebar.disableReorderMode();
      Panel.togglePanel(false);
      activeListId = null;
      Playback.handleNavigation();
      return;
    }

    // 5. Watch page with playlist
    const listId = Playlist.getPlaylistId();
    if (listId !== activeListId) {
      stateReadyListId = null;
      document.getElementById(TOOLBAR_ID)?.remove();
      Sidebar.disableReorderMode();
      activeListId = listId;
    }

    // Inject Virtual Playlist Sidebar if playing a virtual snapshot
    if (Playlist.isVirtualPlaylist()) {
      await Sidebar.injectVirtualPlaylistPanel();
    }

    // Restore persisted modes for this playlist.
    const loaded = await Playback.loadState(listId);
    if (!loaded || epoch !== navigationEpoch || Playlist.getPlaylistId() !== listId) return;
    stateReadyListId = listId;

    // Inject UI (idempotent — each returns early if already present).
    Toolbar.injectToolbar();
    Panel.injectPanel();

    // Apply visual state to the sidebar.
    Sidebar.applyVisualOrder();
    await Sidebar.applyWatchedBadges();
    if (epoch !== navigationEpoch || Playlist.getPlaylistId() !== listId) return;

    // Update duration stats
    Toolbar.updateDurationStats();

    // With CSS reordering active, YouTube's own auto-scroll lands on the
    // wrong visual spot — re-scroll to the playing item.
    const { reverseOn, customOrder } = Playback.getState();
    if (location.pathname === "/watch" && (reverseOn || customOrder)) {
      Sidebar.scrollToCurrentItem();
      setTimeout(() => Sidebar.scrollToCurrentItem(), 300);
    }

    // Sync toolbar button appearance to the loaded state.
    Toolbar.syncButtonStates();

    // Let the playback engine register the new index (handles fallback forward-skip).
    Playback.handleNavigation();
  }

  // ── In-page Watch Video Action Button ──────────────────────────────────────

  function extractCurrentVideoInfo() {
    const videoId = new URLSearchParams(location.search).get("v") || "";
    const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title");
    const title = titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, "").trim();
    const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "";
    const durationStr = document.querySelector(".ytp-time-duration")?.textContent?.trim() || "";

    return { videoId, title, thumbnail, durationStr };
  }

  function injectWatchActionButton() {
    if (!Playlist.isWatchPage()) return;
    const videoId = new URLSearchParams(location.search).get("v");
    if (!videoId) return;

    const existing = document.getElementById(ADD_VIDEO_BTN_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    // Find YouTube video action button container
    const targets = [
      "ytd-watch-metadata #actions #top-level-buttons-computed",
      "#top-level-buttons-computed",
      "ytd-watch-metadata #actions-inner #menu",
      "ytd-watch-metadata #actions-inner",
      "ytd-watch-metadata #actions",
      "#actions #menu ytd-menu-renderer",
      "#actions-inner #menu",
      "#actions #top-level-buttons-computed",
      "ytd-watch-metadata #owner #subscribe-button",
      "ytd-watch-metadata #owner",
      "#owner",
    ];

    let container = null;
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) {
        container = el;
        break;
      }
    }

    if (!container) return;

    const btn = document.createElement("button");
    btn.id = ADD_VIDEO_BTN_ID;
    btn.className = "ryp-btn ryp-action-bar-btn";
    btn.type = "button";
    btn.title = Panel.t("addCurrentVideo") || "Add to Local Playlist";

    const iconSpan = document.createElement("span");
    iconSpan.className = "ryp-icon";
    iconSpan.textContent = "＋";

    const labelSpan = document.createElement("span");
    labelSpan.className = "ryp-label";
    labelSpan.textContent = Panel.t("addToPlaylistTitle") || "Add to Playlist";

    btn.append(iconSpan, labelSpan);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const videoData = extractCurrentVideoInfo();
      Panel.showAddToPlaylistModal(videoData);
    });

    if (container.id === "top-level-buttons-computed" || container.matches?.("#top-level-buttons-computed")) {
      container.prepend(btn);
    } else {
      container.appendChild(btn);
    }
  }

  // ── Mutation observer ─────────────────────────────────────────────────────

  const OBSERVER_THROTTLE_MS = 180;
  let observerTimer = null;
  // The pass awaits, so a later timer can fire mid-flight; without this guard
  // the first pass's finally-block reconnects the observer while the second is
  // still mutating the DOM, and the two feed each other.
  let passRunning = false;

  async function onDomSettled() {
    observerTimer = null;
    if (passRunning) return;
    passRunning = true;
    try {
      await runDomPass();
    } finally {
      passRunning = false;
    }
  }

  async function runDomPass() {
    if (Playlist.isOverviewPlaylistPage()) {
      Toolbar.injectOverviewToolbar();
      return;
    }

    if (!Playlist.isWatchPage()) return;

    injectWatchActionButton();

    if (!Playlist.isPlaylistWatchPage()) return;

    if (Playlist.isVirtualPlaylist()) {
      await Sidebar.injectVirtualPlaylistPanel();
    }

    if (stateReadyListId !== Playlist.getPlaylistId()) return;

    ensureObserver.disconnect();

    try {
      if (!document.getElementById(TOOLBAR_ID)) {
        const injected = Toolbar.injectToolbar();
        if (injected) {
          console.log("[RYP] Toolbar injected on", location.pathname);
        }
        Toolbar.syncButtonStates();
      }

      Sidebar.applyVisualOrder();
      Sidebar.applyWatchedBadges();
      Toolbar.updateDurationStats();
      if (Sidebar.isReorderModeOn()) Sidebar.refreshDraggable();
    } finally {
      ensureObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  const ensureObserver = new MutationObserver(() => {
    if (observerTimer !== null) return;
    observerTimer = setTimeout(onDomSettled, OBSERVER_THROTTLE_MS);
  });

  ensureObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Message Listener ──────────────────────────────────────────────────────

  const api = typeof browser !== "undefined" ? browser : chrome;
  api.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SAVE_PLAYLIST") {
      if (Playlist.isPlaylistWatchPage()) {
        Panel.saveCurrentOrder(
          request.name,
          request.updateSnapshotId,
          request.tags,
          request.sourceListId
        ).then(() => {
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

    if (request.action === "GET_CURRENT_VIDEO_INFO") {
      const info = extractCurrentVideoInfo();
      sendResponse({ success: true, data: info });
      return true;
    }

    if (request.action === "OPEN_ADD_TO_PLAYLIST_MODAL") {
      const info = extractCurrentVideoInfo();
      Panel.showAddToPlaylistModal(info);
      sendResponse({ success: true });
      return true;
    }
  });

  document.addEventListener("yt-navigate-finish", onNavigate);
  onNavigate();
})();
