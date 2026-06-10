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

  // ── SVG Helpers & Icons ───────────────────────────────────────────────────

  function svg(viewBox, strokeWidth, paths) {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, "svg");
    node.setAttribute("class", "ryp-icon-svg");
    node.setAttribute("viewBox", viewBox);
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", String(strokeWidth));
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    
    for (const p of paths) {
      const pNode = document.createElementNS(ns, p.tag);
      for (const [attr, val] of Object.entries(p.attrs)) {
        pNode.setAttribute(attr, val);
      }
      node.appendChild(pNode);
    }
    return node;
  }

  const ICONS = {
    reverse: () => svg("0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "17 1 21 5 17 9" } },
      { tag: "path", attrs: { d: "M3 11V9a4 4 0 0 1 4-4h14" } },
      { tag: "polyline", attrs: { points: "7 23 3 19 7 15" } },
      { tag: "path", attrs: { d: "M21 13v2a4 4 0 0 1-4 4H3" } }
    ]),
    shuffle: () => svg("0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "16 3 21 3 21 8" } },
      { tag: "line", attrs: { x1: "4", y1: "20", x2: "21", y2: "3" } },
      { tag: "polyline", attrs: { points: "21 16 21 21 16 21" } },
      { tag: "line", attrs: { x1: "15", y1: "15", x2: "21", y2: "21" } },
      { tag: "line", attrs: { x1: "4", y1: "4", x2: "9", y2: "9" } }
    ]),
    reorder: () => svg("0 0 24 24", 2.2, [
      { tag: "line", attrs: { x1: "9", y1: "5", x2: "15", y2: "5" } },
      { tag: "line", attrs: { x1: "9", y1: "9", x2: "15", y2: "9" } },
      { tag: "line", attrs: { x1: "9", y1: "13", x2: "15", y2: "13" } },
      { tag: "line", attrs: { x1: "9", y1: "17", x2: "15", y2: "17" } }
    ]),
    save: () => svg("0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" } },
      { tag: "polyline", attrs: { points: "17 21 17 13 7 13 7 21" } },
      { tag: "polyline", attrs: { points: "7 3 7 8 15 8" } }
    ]),
    playlists: () => svg("0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" } }
    ])
  };

  // ── Button factory ────────────────────────────────────────────────────────

  function makeButton(id, iconKey, label, title) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "ryp-btn";
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-pressed", "false");

    const iconSpan = document.createElement("span");
    iconSpan.className = "ryp-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.appendChild(ICONS[iconKey]());

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
      "ryp-btn-reverse", "reverse", "Reverse",
      "Play playlist in reverse — last video first"
    );
    const shuffleBtn = makeButton(
      "ryp-btn-shuffle", "shuffle", "Shuffle",
      "Play playlist in a random order"
    );
    const reorderBtn = makeButton(
      "ryp-btn-reorder", "reorder", "Reorder",
      "Drag sidebar items to set a custom play order"
    );
    const saveBtn = makeButton(
      "ryp-btn-save", "save", "Save",
      "Save the current playlist order as a local snapshot"
    );
    const playlistsBtn = makeButton(
      "ryp-btn-playlists", "playlists", "My Lists",
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

      Panel.showSaveModal({
        title: "Save Playlist Snapshot",
        placeholder: "e.g. My Custom Sort",
        defaultValue: "",
        confirmLabel: "Save",
        onConfirm: async (name) => {
          await Panel.saveCurrentOrder(name);
          if (Panel.isPanelVisible()) {
            await Panel.renderList();
          }
          Panel.showToast("✓ Playlist snapshot saved!");
        }
      });
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
