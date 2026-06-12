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
      clearWatchedConfirm: "Watched badges cleared.",
      export: "Export",
      import: "Import",
      exportTitle: "Export saved playlists to a file",
      importTitle: "Import saved playlists from a file",
      exportEmpty: "Nothing to export yet.",
      importDone: "✓ Imported {added} playlist(s), skipped {skipped} duplicate(s).",
      importInvalid: "Invalid backup file — nothing imported.",
      duplicate: "Duplicate",
      copySuffix: "(copy)",
      resume: "Resume",
      resumeMessage: "Continue where you left off — {title} · {time}",
      cancel: "Cancel",
      close: "Close",
      videosWord: "videos"
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
      clearWatchedConfirm: "Badges de vidéos vues effacés.",
      export: "Exporter",
      import: "Importer",
      exportTitle: "Exporter les playlists sauvegardées",
      importTitle: "Importer des playlists depuis un fichier",
      exportEmpty: "Rien à exporter pour l'instant.",
      importDone: "✓ {added} playlist(s) importée(s), {skipped} doublon(s) ignoré(s).",
      importInvalid: "Fichier de sauvegarde invalide — rien n'a été importé.",
      duplicate: "Dupliquer",
      copySuffix: "(copie)",
      resume: "Reprendre",
      resumeMessage: "Reprendre où vous étiez — {title} · {time}",
      cancel: "Annuler",
      close: "Fermer",
      videosWord: "vidéos"
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
      clearWatchedConfirm: "تمت إزالة شارات المشاهدة.",
      export: "تصدير",
      import: "استيراد",
      exportTitle: "تصدير قوائم التشغيل المحفوظة إلى ملف",
      importTitle: "استيراد قوائم تشغيل من ملف",
      exportEmpty: "لا يوجد شيء للتصدير بعد.",
      importDone: "✓ تم استيراد {added} قائمة، وتخطي {skipped} مكررة.",
      importInvalid: "ملف نسخ احتياطي غير صالح — لم يتم استيراد أي شيء.",
      duplicate: "تكرار",
      copySuffix: "(نسخة)",
      resume: "متابعة",
      resumeMessage: "المتابعة من حيث توقفت — {title} · {time}",
      cancel: "إلغاء",
      close: "إغلاق",
      videosWord: "فيديو"
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

    const exportBtn = panel.querySelector("#ryp-export-btn");
    if (exportBtn && exportBtn.childNodes[1]) {
      exportBtn.childNodes[1].textContent = " " + dict.export;
      exportBtn.title = dict.exportTitle;
    }

    const importBtn = panel.querySelector("#ryp-import-btn");
    if (importBtn && importBtn.childNodes[1]) {
      importBtn.childNodes[1].textContent = " " + dict.import;
      importBtn.title = dict.importTitle;
    }
    
    const sectionTitle = panel.querySelector(".ryp-panel-section-title");
    if (sectionTitle) sectionTitle.textContent = dict.savedSnapshots;

    const closeBtn = panel.querySelector(".ryp-panel-close");
    if (closeBtn) {
      closeBtn.title = dict.close;
      closeBtn.setAttribute("aria-label", dict.close);
    }
    
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
    ]),
    download: () => svg("ryp-download-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" } },
      { tag: "polyline", attrs: { points: "7 10 12 15 17 10" } },
      { tag: "line", attrs: { x1: "12", y1: "15", x2: "12", y2: "3" } }
    ]),
    upload: () => svg("ryp-upload-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" } },
      { tag: "polyline", attrs: { points: "17 8 12 3 7 8" } },
      { tag: "line", attrs: { x1: "12", y1: "3", x2: "12", y2: "15" } }
    ]),
    copy: () => svg("ryp-copy-icon-svg", "0 0 24 24", 2, [
      { tag: "rect", attrs: { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" } },
      { tag: "path", attrs: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" } }
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

    // Import / export backup row
    const exportBtn = el("button", {
      className: "ryp-panel-tool",
      id: "ryp-export-btn",
      title: "Export saved playlists to a file",
    });
    exportBtn.appendChild(ICONS.download());
    exportBtn.appendChild(document.createTextNode(" Export"));

    const importBtn = el("button", {
      className: "ryp-panel-tool",
      id: "ryp-import-btn",
      title: "Import saved playlists from a file",
    });
    importBtn.appendChild(ICONS.upload());
    importBtn.appendChild(document.createTextNode(" Import"));

    const importInput = el("input", {
      type: "file",
      id: "ryp-import-input",
      accept: ".json,application/json",
    });
    importInput.style.display = "none";

    const toolsRow = el("div", { className: "ryp-panel-tools-row" }, [
      exportBtn, importBtn, importInput,
    ]);

    const saveSection = el("div", { className: "ryp-panel-save-section" }, [
      saveLabel, saveRow, clearWatchedBtn, toolsRow,
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
      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
      showToast("✓ " + dict.saveConfirm);
    });

    panel.querySelector("#ryp-clear-watched").addEventListener("click", async () => {
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      await Playback.clearWatched(listId);
      await window.RYP.Sidebar.applyWatchedBadges();
      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
      showToast(dict.clearWatchedConfirm);
    });

    const Backup = window.RYP.Backup;
    const importInput = panel.querySelector("#ryp-import-input");

    panel.querySelector("#ryp-export-btn").addEventListener("click", async () => {
      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
      const playlists = (await State.get(State.keys.savedPlaylists)) || [];
      if (playlists.length === 0) {
        showToast(dict.exportEmpty);
        return;
      }
      Backup.triggerDownload(playlists);
    });

    panel.querySelector("#ryp-import-btn").addEventListener("click", () => {
      importInput.click();
    });

    importInput.addEventListener("change", async () => {
      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
      const file = importInput.files && importInput.files[0];
      importInput.value = ""; // allow re-selecting the same file
      if (!file) return;
      try {
        const incoming = Backup.parseImport(await file.text());
        const existing = (await State.get(State.keys.savedPlaylists)) || [];
        const { merged, added, skipped } = Backup.mergeSnapshots(existing, incoming);
        await State.set(State.keys.savedPlaylists, merged);
        await renderList();
        showToast(
          dict.importDone
            .replace("{added}", String(added))
            .replace("{skipped}", String(skipped))
        );
      } catch (err) {
        console.warn("Import failed:", err);
        showToast(dict.importInvalid);
      }
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
        textContent: `${pl.order.length} ${dict.videosWord} · ${date}`,
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

      const duplicateBtn = el("button", {
        className: "ryp-action-duplicate",
        title: dict.duplicate,
      });
      duplicateBtn.setAttribute("aria-label", `${dict.duplicate} ${pl.name}`);
      duplicateBtn.appendChild(ICONS.copy());
      duplicateBtn.dataset.id = pl.id;

      const deleteBtn = el("button", {
        className: "ryp-action-delete",
        title: dict.delete,
      });
      deleteBtn.setAttribute("aria-label", `${dict.delete} ${pl.name}`);
      deleteBtn.appendChild(ICONS.trash());
      deleteBtn.dataset.id = pl.id;

      const actionsCol = el("div", { className: "ryp-saved-actions" }, [playBtn, duplicateBtn, deleteBtn]);
      const card = el("div", { className: "ryp-saved-card" }, [infoCol, actionsCol]);

      playBtn.addEventListener("click", async () => {
        if (!pl || pl.order.length === 0) return;
        const firstIndex = pl.order[0];
        const firstVideo = pl.videos.find((v) => v.index === firstIndex);
        if (!firstVideo) return;
        // Restore the snapshot's order as the active custom order so playback
        // follows the saved sequence, not whatever mode was last active.
        await Playback.applyCustomOrder(pl.sourceListId, pl.order);
        const url = `https://www.youtube.com/watch?v=${firstVideo.videoId}&list=${pl.sourceListId}&index=${firstIndex}`;
        window.open(url, "_self");
      });

      duplicateBtn.addEventListener("click", async () => {
        const saved = (await State.get(State.keys.savedPlaylists)) || [];
        const pos = saved.findIndex((p) => p.id === pl.id);
        if (pos === -1) return;
        const src = saved[pos];
        const copy = {
          ...src,
          id: window.RYP.Backup.freshId(),
          name: `${src.name} ${dict.copySuffix}`.slice(0, 80),
          order: [...src.order],
          videos: src.videos.map((v) => ({ ...v })),
          savedAt: new Date().toISOString(),
        };
        saved.splice(pos + 1, 0, copy);
        await State.set(State.keys.savedPlaylists, saved);
        await renderList();
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
    toast.dir = activeLang === "ar" ? "rtl" : "ltr";
    toast.textContent = message; // textContent — safe
    document.body.appendChild(toast);
    // Force reflow so the entrance animation triggers.
    void toast.offsetWidth;
    toast.classList.add("ryp-toast-show");
    setTimeout(() => toast.remove(), 3200);
  }

  // ── Resume toast ──────────────────────────────────────────────────────────

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  /** Action toast offering to jump back to the last recorded position. */
  function showResumeToast(prog, listId) {
    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const existing = document.getElementById("ryp-resume-toast");
    if (existing) existing.remove();

    const toast = el("div", { id: "ryp-resume-toast", role: "status" });
    toast.dir = activeLang === "ar" ? "rtl" : "ltr";

    const text = el("span", { className: "ryp-resume-text" });
    text.textContent = dict.resumeMessage
      .replace("{title}", prog.title || "…")
      .replace("{time}", formatTime(prog.t || 0));

    const resumeBtn = el("button", {
      className: "ryp-resume-btn",
      textContent: dict.resume,
    });
    const closeBtn = el("button", {
      className: "ryp-resume-close",
      "aria-label": "Dismiss",
      textContent: "✕",
    });

    const hide = () => {
      toast.classList.remove("ryp-toast-show");
      setTimeout(() => toast.remove(), 300);
    };
    const autoHide = setTimeout(hide, 12000);

    resumeBtn.addEventListener("click", () => {
      clearTimeout(autoHide);
      const t = Math.max(0, Math.floor(prog.t || 0));
      const idxParam = Number.isFinite(prog.index) && prog.index
        ? `&index=${prog.index}`
        : "";
      window.open(
        `https://www.youtube.com/watch?v=${prog.videoId}&list=${listId}${idxParam}&t=${t}s`,
        "_self"
      );
    });
    closeBtn.addEventListener("click", () => {
      clearTimeout(autoHide);
      hide();
    });

    toast.append(text, resumeBtn, closeBtn);
    document.body.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add("ryp-toast-show");
  }

  // ── Custom Modal ──────────────────────────────────────────────────────────

  function showSaveModal({ title, placeholder, defaultValue, confirmLabel, onConfirm }) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    // The modal lives in YouTube's LTR document, so direction must be set
    // explicitly for the title, input, and placeholder to mirror.
    overlay.dir = activeLang === "ar" ? "rtl" : "ltr";
    const titleEl = el("h3", { className: "ryp-modal-title", textContent: title });

    const input = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: placeholder || "",
      maxlength: "80"
    });
    input.value = defaultValue || "";

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
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
    showResumeToast,
    saveCurrentOrder,
    renderList,
    showSaveModal,
  };
})();
