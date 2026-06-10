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
  let activeLang = "en";

  const TRANSLATIONS = {
    en: {
      extensionName: "Playlist Tools",
      saveLabel: "Save current play order as a snapshot:",
      saveInputPlaceholder: "e.g. My Custom Sort",
      clearWatched: "Clear watched badges",
      savedSnapshots: "Saved Snapshots",
      noSnapshots: "No snapshots yet.",
      emptyHint: "Enter a name above and hit Save.",
      play: "Play",
      delete: "Delete",
      save: "Save",
      saveConfirm: "Playlist snapshot saved!",
      clearWatchedConfirm: "Watched badges cleared."
    },
    fr: {
      extensionName: "Outils Playlist",
      saveLabel: "Enregistrer l'ordre de lecture actuel :",
      saveInputPlaceholder: "ex: Cours inversé",
      clearWatched: "Effacer vidéos vues",
      savedSnapshots: "Instantannés",
      noSnapshots: "Aucun instantané.",
      emptyHint: "Saisissez un nom ci-dessus et cliquez sur Enreg.",
      play: "Lire",
      delete: "Supprimer",
      save: "Enreg.",
      saveConfirm: "Instantané enregistré !",
      clearWatchedConfirm: "Badges de vidéos vues effacés."
    },
    ar: {
      extensionName: "أدوات قائمة التشغيل",
      saveLabel: "حفظ الترتيب الحالي كلقطة:",
      saveInputPlaceholder: "مثال: ترتيب عكسي",
      clearWatched: "مسح شارات المشاهدة",
      savedSnapshots: "اللقطات المحفوظة",
      noSnapshots: "لا توجد لقطات بعد.",
      emptyHint: "أدخل اسمًا أعلاه واضغط حفظ.",
      play: "تشغيل",
      delete: "حذف",
      save: "حفظ",
      saveConfirm: "تم حفظ لقطة قائمة التشغيل!",
      clearWatchedConfirm: "تمت إزالة شارات المشاهدة."
    }
  };

  const api = typeof browser !== "undefined" ? browser : chrome;

  function applyPanelSettings(settings) {
    const lang = settings?.lang || "en";
    activeLang = lang;
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    
    // Toggle compact mode
    document.body.classList.toggle("ryp-compact", !!settings?.compact);
    
    // Toggle hide badges mode
    document.body.classList.toggle("ryp-hide-badges", !settings?.showBadges);
    
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    
    // Apply layout direction
    panel.dir = lang === "ar" ? "rtl" : "ltr";
    
    // Translate static strings
    const titleSpan = panel.querySelector(".ryp-panel-title");
    if (titleSpan && titleSpan.childNodes[1]) {
      titleSpan.childNodes[1].textContent = " " + dict.extensionName;
    }
    
    const saveLabel = panel.querySelector(".ryp-save-label");
    if (saveLabel) saveLabel.textContent = dict.saveLabel;
    
    const saveInput = panel.querySelector(".ryp-save-input");
    if (saveInput) saveInput.placeholder = dict.saveInputPlaceholder;
    
    const saveConfirm = panel.querySelector(".ryp-save-confirm");
    if (saveConfirm && saveConfirm.childNodes[1]) {
      saveConfirm.childNodes[1].textContent = " " + dict.save;
    }
    
    const clearWatched = panel.querySelector(".ryp-clear-watched");
    if (clearWatched && clearWatched.childNodes[1]) {
      clearWatched.childNodes[1].textContent = " " + dict.clearWatched;
    }
    
    const sectionTitle = panel.querySelector(".ryp-panel-section-title");
    if (sectionTitle) sectionTitle.textContent = dict.savedSnapshots;
    
    // Re-render list
    renderList();
  }

  // Listen for settings changes from the popup
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.ryp_settings) {
      applyPanelSettings(changes.ryp_settings.newValue);
    }
  });

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

  // ── SVG Helper & Icons ────────────────────────────────────────────────────
  function svg(className, viewBox, strokeWidth, paths) {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, "svg");
    node.setAttribute("class", className);
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
    panel: () => svg("ryp-panel-icon-svg", "0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "17 1 21 5 17 9" } },
      { tag: "path", attrs: { d: "M3 11V9a4 4 0 0 1 4-4h14" } },
      { tag: "polyline", attrs: { points: "7 23 3 19 7 15" } },
      { tag: "path", attrs: { d: "M21 13v2a4 4 0 0 1-4 4H3" } }
    ]),
    close: () => svg("ryp-close-icon-svg", "0 0 24 24", 2, [
      { tag: "line", attrs: { x1: "18", y1: "6", x2: "6", y2: "18" } },
      { tag: "line", attrs: { x1: "6", y1: "6", x2: "18", y2: "18" } }
    ]),
    save: () => svg("ryp-save-icon-svg", "0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" } },
      { tag: "polyline", attrs: { points: "17 21 17 13 7 13 7 21" } },
      { tag: "polyline", attrs: { points: "7 3 7 8 15 8" } }
    ]),
    clear: () => svg("ryp-clear-icon-svg", "0 0 24 24", 2, [
      { tag: "polyline", attrs: { points: "3 6 5 6 21 6" } },
      { tag: "path", attrs: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } }
    ]),
    play: () => svg("ryp-play-icon-svg", "0 0 24 24", 2, [
      { tag: "polygon", attrs: { points: "5 3 19 12 5 21 5 3" } }
    ]),
    trash: () => svg("ryp-trash-icon-svg", "0 0 24 24", 2, [
      { tag: "polyline", attrs: { points: "3 6 5 6 21 6" } },
      { tag: "path", attrs: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } },
      { tag: "line", attrs: { x1: "10", y1: "11", x2: "10", y2: "17" } },
      { tag: "line", attrs: { x1: "14", y1: "11", x2: "14", y2: "17" } }
    ]),
    folder: () => svg("ryp-folder-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" } }
    ])
  };

  // ── Panel injection ───────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Header
    const iconSpan = el("span", { className: "ryp-panel-icon" });
    iconSpan.appendChild(ICONS.panel());
    
    const titleTextNode = document.createTextNode(" Playlist Tools");
    const titleSpan = el("span", { className: "ryp-panel-title" }, [iconSpan, titleTextNode]);
    
    const closeBtn = el("button", {
      className: "ryp-panel-close",
      id: "ryp-panel-close",
      title: "Close panel",
      "aria-label": "Close",
    });
    closeBtn.appendChild(ICONS.close());
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
    });
    saveConfirmBtn.appendChild(ICONS.save());
    saveConfirmBtn.appendChild(document.createTextNode(" Save"));

    const saveRow = el("div", { className: "ryp-save-row" }, [saveInput, saveConfirmBtn]);
    const clearWatchedBtn = el("button", {
      className: "ryp-clear-watched",
      id: "ryp-clear-watched",
      title: "Remove all watched badges for this playlist",
    });
    clearWatchedBtn.appendChild(ICONS.clear());
    clearWatchedBtn.appendChild(document.createTextNode(" Clear watched badges"));

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

    // Load and apply settings
    api.storage.local.get("ryp_settings", (res) => {
      const settings = res.ryp_settings || {};
      applyPanelSettings(settings);
    });
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

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    if (playlists.length === 0) {
      const emptyIcon = el("div", { className: "ryp-empty-icon" });
      emptyIcon.appendChild(ICONS.folder());
      const emptyText = el("p", { textContent: dict.noSnapshots });
      const hint = el("p", { className: "ryp-empty-hint" });
      
      const strongSave = el("strong", { textContent: dict.save });
      if (activeLang === "ar") {
        hint.appendChild(document.createTextNode("أدخل اسمًا أعلاه واضغط "));
        hint.appendChild(strongSave);
        hint.appendChild(document.createTextNode("."));
      } else if (activeLang === "fr") {
        hint.appendChild(document.createTextNode("Saisissez un nom ci-dessus et cliquez sur "));
        hint.appendChild(strongSave);
        hint.appendChild(document.createTextNode("."));
      } else {
        hint.appendChild(document.createTextNode("Enter a name above and hit "));
        hint.appendChild(strongSave);
        hint.appendChild(document.createTextNode("."));
      }
      
      listEl.appendChild(el("div", { className: "ryp-empty-state" }, [emptyIcon, emptyText, hint]));
      return;
    }

    for (const pl of playlists) {
      const date = new Date(pl.savedAt).toLocaleDateString(activeLang, {
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
        title: dict.play,
      });
      playBtn.appendChild(ICONS.play());
      playBtn.appendChild(document.createTextNode(" " + dict.play));
      playBtn.dataset.id = pl.id;

      const deleteBtn = el("button", {
        className: "ryp-action-delete",
        title: dict.delete,
      });
      deleteBtn.setAttribute("aria-label", `${dict.delete} ${pl.name}`);
      deleteBtn.appendChild(ICONS.trash());
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

  // ── Custom Modal ──────────────────────────────────────────────────────────

  function showSaveModal({ title, placeholder, defaultValue, confirmLabel, onConfirm }) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    const titleEl = el("h3", { className: "ryp-modal-title", textContent: title });
    
    const input = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: placeholder || "",
      maxlength: "80"
    });
    input.value = defaultValue || "";

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: "Cancel" });
    const confirmBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-confirm", textContent: confirmLabel || "Confirm" });
    
    const buttonsRow = el("div", { className: "ryp-modal-buttons" }, [cancelBtn, confirmBtn]);
    const modal = el("div", { className: "ryp-modal-content" }, [
      titleEl,
      input,
      buttonsRow
    ]);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);

    const close = () => {
      overlay.classList.add("ryp-modal-closing");
      setTimeout(() => overlay.remove(), 220);
    };

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const handleConfirm = () => {
      const val = input.value.trim();
      if (!val) {
        input.classList.add("ryp-input-error");
        input.focus();
        setTimeout(() => input.classList.remove("ryp-input-error"), 1200);
        return;
      }
      onConfirm(val);
      close();
    };

    confirmBtn.addEventListener("click", handleConfirm);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConfirm();
      if (e.key === "Escape") close();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Panel = {
    injectPanel,
    togglePanel,
    isPanelVisible: () => panelVisible,
    showToast,
    saveCurrentOrder,
    renderList,
    showSaveModal,
  };
})();
