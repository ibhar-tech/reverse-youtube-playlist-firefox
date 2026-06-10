/*
 * YouTube Playlist Tools — panel.js
 *
 * Injects a slide-in in-page panel for managing saved local playlists.
 * The panel is attached to document.body and toggled by the toolbar button.
 *
 * Features:
 *  - "Save Current Order" with a name input (saves to storage.local)
 *  - Lists all saved playlists with play and delete actions
 *  - "Clear Watched" shortcut for the current playlist
 *  - Zero external requests — all data lives in browser storage
 *
 * Security note: all user-supplied strings (playlist names) are inserted
 * via textContent / setAttribute, never innerHTML, to avoid XSS.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { State, Playlist, Playback } = window.RYP;

  const PANEL_ID = "ryp-saved-panel";
  let panelVisible = false;

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ── Panel injection ───────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Header
    const iconSpan = el("span", { className: "ryp-panel-icon", textContent: "⮃" });
    const titleSpan = el("span", { className: "ryp-panel-title" }, [iconSpan, " Playlist Tools"]);
    const closeBtn = el("button", {
      className: "ryp-panel-close",
      id: "ryp-panel-close",
      title: "Close panel",
      "aria-label": "Close",
      textContent: "✕",
    });
    const header = el("div", { className: "ryp-panel-header" }, [titleSpan, closeBtn]);

    // Save section
    const saveLabel = el("p", { className: "ryp-save-label", textContent: "Save current play order as a snapshot:" });
    const saveInput = el("input", {
      type: "text",
      id: "ryp-save-name",
      className: "ryp-save-input",
      placeholder: "e.g. Reversed Course",
      maxlength: "80",
    });
    const saveConfirmBtn = el("button", {
      className: "ryp-save-confirm",
      id: "ryp-save-confirm",
      title: "Save snapshot",
      textContent: "💾 Save",
    });
    const saveRow = el("div", { className: "ryp-save-row" }, [saveInput, saveConfirmBtn]);
    const clearWatchedBtn = el("button", {
      className: "ryp-clear-watched",
      id: "ryp-clear-watched",
      title: "Remove all watched badges for this playlist",
      textContent: "✕ Clear watched badges",
    });
    const saveSection = el("div", { className: "ryp-panel-save-section" }, [
      saveLabel, saveRow, clearWatchedBtn,
    ]);

    // List
    const sectionTitle = el("div", { className: "ryp-panel-section-title", textContent: "Saved Snapshots" });
    const listContainer = el("div", { className: "ryp-panel-list", id: "ryp-panel-list" });

    // Panel root
    const panel = el("div", {
      id: PANEL_ID,
      role: "dialog",
      "aria-label": "Saved Playlists",
    }, [header, saveSection, sectionTitle, listContainer]);

    document.body.appendChild(panel);
    bindPanelEvents(panel);
  }

  function bindPanelEvents(panel) {
    panel
      .querySelector("#ryp-panel-close")
      .addEventListener("click", () => togglePanel(false));

    panel.querySelector("#ryp-save-confirm").addEventListener("click", async () => {
      const input = document.getElementById("ryp-save-name");
      const name = input.value.trim();
      if (!name) {
        input.classList.add("ryp-input-error");
        input.focus();
        setTimeout(() => input.classList.remove("ryp-input-error"), 1200);
        return;
      }
      await saveCurrentOrder(name);
      input.value = "";
      await renderList();
      showToast("✓ Playlist snapshot saved!");
    });

    panel.querySelector("#ryp-clear-watched").addEventListener("click", async () => {
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      await Playback.clearWatched(listId);
      await window.RYP.Sidebar.applyWatchedBadges();
      showToast("Watched badges cleared for this playlist.");
    });

    // Close when clicking outside the panel.
    document.addEventListener("click", (e) => {
      if (
        panelVisible &&
        !panel.contains(e.target) &&
        e.target.id !== "ryp-btn-playlists"
      ) {
        togglePanel(false);
      }
    });
  }

  // ── Save logic ────────────────────────────────────────────────────────────

  async function saveCurrentOrder(name) {
    const listId = Playlist.getPlaylistId();
    if (!listId) return;
    const items = Playlist.readItems();
    if (items.length === 0) return;

    const { customOrder } = Playback.getState();
    const order =
      customOrder && customOrder.length > 0
        ? customOrder
        : items.map((it) => it.index);

    const entry = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      sourceListId: listId,
      order,
      videos: items.map((it) => ({
        index: it.index,
        videoId: it.videoId,
        title: it.title,
        thumbnail: it.thumbnail,
      })),
      savedAt: new Date().toISOString(),
    };

    const saved = (await State.get(State.keys.savedPlaylists)) || [];
    saved.unshift(entry);
    await State.set(State.keys.savedPlaylists, saved);
  }

  // ── List rendering ────────────────────────────────────────────────────────

  async function renderList() {
    const listEl = document.getElementById("ryp-panel-list");
    if (!listEl) return;

    const playlists = (await State.get(State.keys.savedPlaylists)) || [];
    listEl.replaceChildren(); // clear safely without innerHTML

    if (playlists.length === 0) {
      const emptyIcon = el("div", { className: "ryp-empty-icon", textContent: "🎵" });
      const emptyText = el("p", { textContent: "No snapshots yet." });
      const hint = el("p", { className: "ryp-empty-hint" });
      hint.appendChild(document.createTextNode("Enter a name above and hit "));
      hint.appendChild(el("strong", { textContent: "Save" }));
      hint.appendChild(document.createTextNode("."));
      listEl.appendChild(el("div", { className: "ryp-empty-state" }, [emptyIcon, emptyText, hint]));
      return;
    }

    for (const pl of playlists) {
      const date = new Date(pl.savedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      // Info column
      const nameEl = el("div", { className: "ryp-saved-name" });
      nameEl.textContent = pl.name; // textContent — safe
      nameEl.title = pl.name;
      const metaEl = el("div", {
        className: "ryp-saved-meta",
        textContent: `${pl.order.length} videos · ${date}`,
      });
      const infoCol = el("div", { className: "ryp-saved-info" }, [nameEl, metaEl]);

      // Action buttons — dataset set separately, never via innerHTML
      const playBtn = el("button", {
        className: "ryp-action-play",
        title: "Open and play this snapshot",
        textContent: "▶ Play",
      });
      playBtn.dataset.id = pl.id;

      const deleteBtn = el("button", {
        className: "ryp-action-delete",
        title: "Delete this snapshot",
        textContent: "✕",
      });
      deleteBtn.setAttribute("aria-label", `Delete ${pl.name}`);
      deleteBtn.dataset.id = pl.id;

      const actionsCol = el("div", { className: "ryp-saved-actions" }, [playBtn, deleteBtn]);
      const card = el("div", { className: "ryp-saved-card" }, [infoCol, actionsCol]);

      playBtn.addEventListener("click", () => {
        if (!pl || pl.order.length === 0) return;
        const firstIndex = pl.order[0];
        const firstVideo = pl.videos.find((v) => v.index === firstIndex);
        if (!firstVideo) return;
        const url = `https://www.youtube.com/watch?v=${firstVideo.videoId}&list=${pl.sourceListId}&index=${firstIndex}`;
        window.open(url, "_self");
      });

      deleteBtn.addEventListener("click", async () => {
        let saved = (await State.get(State.keys.savedPlaylists)) || [];
        saved = saved.filter((p) => p.id !== pl.id);
        await State.set(State.keys.savedPlaylists, saved);
        await renderList();
      });

      listEl.appendChild(card);
    }
  }

  // ── Visibility ────────────────────────────────────────────────────────────

  function togglePanel(forceState) {
    panelVisible = forceState !== undefined ? forceState : !panelVisible;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return panelVisible;
    panel.classList.toggle("ryp-panel-visible", panelVisible);
    if (panelVisible) renderList();
    return panelVisible;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(message) {
    const existing = document.getElementById("ryp-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "ryp-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message; // textContent — safe
    document.body.appendChild(toast);
    // Force reflow so the entrance animation triggers.
    void toast.offsetWidth;
    toast.classList.add("ryp-toast-show");
    setTimeout(() => toast.remove(), 3200);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Panel = {
    injectPanel,
    togglePanel,
    isPanelVisible: () => panelVisible,
    showToast,
    saveCurrentOrder,
    renderList,
  };
})();
