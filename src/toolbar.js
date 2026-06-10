/*
 * YouTube Playlist Tools — toolbar.js
 *
 * Injects and manages the four-button toolbar into the playlist panel header:
 *   [⮃ Reverse]  [⤮ Shuffle]  [⠿ Reorder]  [🎵 Playlists]
 *
 * Each button reflects live state (active / inactive) from Playback and
 * Sidebar. The toolbar is re-injected whenever YouTube removes it (SPA
 * navigation, panel re-render) via the MutationObserver in content.js.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { Playlist, Playback, Sidebar, Panel } = window.RYP;

  const TOOLBAR_ID = "ryp-toolbar";

  // ── Button factory ────────────────────────────────────────────────────────

  function makeButton(id, icon, label, title) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "ryp-btn";
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-pressed", "false");

    const iconSpan = document.createElement("span");
    iconSpan.className = "ryp-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = icon;

    const labelSpan = document.createElement("span");
    labelSpan.className = "ryp-label";
    labelSpan.textContent = label;

    btn.append(iconSpan, labelSpan);
    return btn;
  }

  function setActive(btn, active, onLabel, offLabel, onTitle, offTitle) {
    if (!btn) return;
    btn.classList.toggle("ryp-active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.title = active ? onTitle : offTitle;
    const labelEl = btn.querySelector(".ryp-label");
    if (labelEl) labelEl.textContent = active ? onLabel : offLabel;
  }

  // ── Toolbar injection ─────────────────────────────────────────────────────

  function injectToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return true;
    const container = Playlist.findHeaderContainer();
    if (!container) return false;

    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Playlist Tools");

    const reverseBtn = makeButton(
      "ryp-btn-reverse", "⮃", "Reverse",
      "Play playlist in reverse — last video first"
    );
    const shuffleBtn = makeButton(
      "ryp-btn-shuffle", "⤮", "Shuffle",
      "Play playlist in a random order"
    );
    const reorderBtn = makeButton(
      "ryp-btn-reorder", "⠿", "Reorder",
      "Drag sidebar items to set a custom play order"
    );
    const saveBtn = makeButton(
      "ryp-btn-save", "💾", "Save",
      "Save the current playlist order as a local snapshot"
    );
    const playlistsBtn = makeButton(
      "ryp-btn-playlists", "🎵", "My Lists",
      "Open saved playlist snapshots"
    );

    toolbar.append(reverseBtn, shuffleBtn, reorderBtn, saveBtn, playlistsBtn);
    container.appendChild(toolbar);

    syncButtonStates();
    bindEvents(reverseBtn, shuffleBtn, reorderBtn, saveBtn, playlistsBtn);
    return true;
  }

  // ── State sync ────────────────────────────────────────────────────────────

  function syncButtonStates() {
    const { reverseOn, shuffleOn } = Playback.getState();
    const reorderOn = Sidebar.isReorderModeOn();
    const panelOn = Panel.isPanelVisible();

    setActive(
      document.getElementById("ryp-btn-reverse"),
      reverseOn,
      "Reverse: ON", "Reverse",
      "Reverse is ON — playing last to first (click to turn off)",
      "Play playlist in reverse — last video first"
    );
    setActive(
      document.getElementById("ryp-btn-shuffle"),
      shuffleOn,
      "Shuffle: ON", "Shuffle",
      "Shuffle is ON — random order (click to turn off)",
      "Play playlist in a random order"
    );
    setActive(
      document.getElementById("ryp-btn-reorder"),
      reorderOn,
      "Reorder: ON", "Reorder",
      "Reorder ON — drag to rearrange (click to exit)",
      "Drag sidebar items to set a custom play order"
    );
    setActive(
      document.getElementById("ryp-btn-playlists"),
      panelOn,
      "My Lists", "My Lists",
      "Close saved snapshots panel",
      "Open saved playlist snapshots"
    );
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents(reverseBtn, shuffleBtn, reorderBtn, saveBtn, playlistsBtn) {
    reverseBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      const { reverseOn } = Playback.getState();
      if (reverseOn) {
        await Playback.disableReverse(listId);
      } else {
        // Turning on reverse disables shuffle/custom order.
        await Playback.enableReverse(listId);
      }
      Sidebar.applyVisualOrder();
      syncButtonStates();
    });

    shuffleBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      const { shuffleOn } = Playback.getState();
      if (shuffleOn) {
        await Playback.disableShuffle(listId);
        Sidebar.applyVisualOrder();
      } else {
        // enableShuffle also jumps to first in shuffled order.
        await Playback.enableShuffle(listId);
        Sidebar.applyVisualOrder();
      }
      syncButtonStates();
    });

    reorderBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      Sidebar.toggleReorderMode();
      syncButtonStates();
    });

    saveBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;

      const name = prompt("Enter a name to save the current playlist state:");
      if (name === null) return; // user cancelled
      const trimmed = name.trim();
      if (!trimmed) {
        alert("Playlist name cannot be empty.");
        return;
      }

      await Panel.saveCurrentOrder(trimmed);
      if (Panel.isPanelVisible()) {
        await Panel.renderList();
      }
      Panel.showToast("✓ Playlist snapshot saved!");
    });

    playlistsBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      Panel.togglePanel();
      syncButtonStates();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Toolbar = { injectToolbar, syncButtonStates };
})();
