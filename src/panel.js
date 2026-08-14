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
 *  - "Add Video to Playlist" universal modal from anywhere on YouTube
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
      resume: "Resume",
      resumeMessage: "Continue where you left off — {title} · {time}",
      cancel: "Cancel",
      close: "Close",
      videosWord: "videos",
      endOfOrder: "End of the playlist order.",
      searchSnapshots: "Search names or tags...",
      tagsPlaceholder: "Tags (comma separated)",
      noMatchingSnapshots: "No matching snapshots found.",
      confirm: "Confirm",
      deleteConfirm: "Delete this playlist snapshot?",
      saveOptionsTitle: "Save Options",
      saveOptionsPrompt: "Existing snapshots found for this playlist. Would you like to update one or save as a new snapshot?",
      saveAsNew: "Save as New",
      updateExisting: "Update",
      updateConfirm: "Snapshot updated!",
      addToPlaylistTitle: "Add to Local Playlist",
      localPlaylists: "Your local playlists",
      noLocalPlaylists: "No local playlists yet — create one above.",
      addToPlaylistPrompt: "Choose a playlist to add this video to, or create a new one:",
      createAndAdd: "Create & Add",
      createNewPlaylist: "New playlist name...",
      addBtn: "Add",
      addedToPlaylist: "✓ Added video to \"{playlist}\"",
      videoAlreadyInPlaylist: "Video is already in \"{playlist}\"",
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
      resume: "Reprendre",
      resumeMessage: "Reprendre où vous étiez — {title} · {time}",
      cancel: "Annuler",
      close: "Fermer",
      videosWord: "vidéos",
      endOfOrder: "Fin de l'ordre de lecture.",
      searchSnapshots: "Rechercher par nom ou tag...",
      tagsPlaceholder: "Tags (séparés par des virgules)",
      noMatchingSnapshots: "Aucun instantané ne correspond.",
      confirm: "Confirmer",
      deleteConfirm: "Supprimer cet instantané ?",
      saveOptionsTitle: "Options d'enregistrement",
      saveOptionsPrompt: "Des instantanés existent déjà pour cette playlist. Voulez-vous en mettre un à jour ou enregistrer un nouvel instantané ?",
      saveAsNew: "Enregistrer comme nouveau",
      updateExisting: "Mettre à jour",
      updateConfirm: "Instantané mis à jour !",
      addToPlaylistTitle: "Ajouter à une playlist locale",
      localPlaylists: "Vos playlists locales",
      noLocalPlaylists: "Aucune playlist locale — créez-en une ci-dessus.",
      addToPlaylistPrompt: "Choisissez une playlist ou créez-en une nouvelle :",
      createAndAdd: "Créer et ajouter",
      createNewPlaylist: "Nom de la nouvelle playlist...",
      addBtn: "Ajouter",
      addedToPlaylist: "✓ Vidéo ajoutée à \"{playlist}\"",
      videoAlreadyInPlaylist: "La vidéo est déjà dans \"{playlist}\"",
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
      resume: "متابعة",
      resumeMessage: "المتابعة من حيث توقفت — {title} · {time}",
      cancel: "إلغاء",
      close: "إغلاق",
      videosWord: "فيديو",
      endOfOrder: "نهاية ترتيب قائمة التشغيل.",
      searchSnapshots: "البحث بالاسم أو الوسم...",
      tagsPlaceholder: "وسوم (مفصولة بفواصل)",
      noMatchingSnapshots: "لم يتم العثور على لقطات مطابقة.",
      confirm: "تأكيد",
      deleteConfirm: "حذف هذه اللقطة؟",
      saveOptionsTitle: "خيارات الحفظ",
      saveOptionsPrompt: "تم العثور على لقطات محفوظة لهذه القائمة. هل تريد تحديث إحداها أم حفظها كلقطة جديدة؟",
      saveAsNew: "حفظ كلقطة جديدة",
      updateExisting: "تحديث",
      updateConfirm: "تم تحديث اللقطة بنجاح!",
      addToPlaylistTitle: "إضافة إلى قائمة تشغيل محلية",
      localPlaylists: "قوائم التشغيل المحلية",
      noLocalPlaylists: "لا توجد قوائم محلية — أنشئ واحدة بالأعلى.",
      addToPlaylistPrompt: "اختر قائمة لإضافة هذا الفيديو إليها أو أنشئ قائمة جديدة:",
      createAndAdd: "إنشاء وإضافة",
      createNewPlaylist: "اسم القائمة الجديدة...",
      addBtn: "إضافة",
      addedToPlaylist: "✓ تمت إضافة الفيديو إلى \"{playlist}\"",
      videoAlreadyInPlaylist: "الفيديو موجود بالفعل في \"{playlist}\"",
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

    const searchInput = panel.querySelector("#ryp-search-input");
    if (searchInput) searchInput.placeholder = dict.searchSnapshots;

    const tagsInput = panel.querySelector("#ryp-save-tags");
    if (tagsInput) tagsInput.placeholder = dict.tagsPlaceholder;
    
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
    const tagsInput = el("input", {
      type: "text",
      id: "ryp-save-tags",
      className: "ryp-save-input ryp-tags-input",
      placeholder: "Tags (comma separated)",
      maxlength: "200",
    });
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
      saveLabel, saveRow, tagsInput, clearWatchedBtn, toolsRow,
    ]);

    // List
    const sectionTitle = el("div", { className: "ryp-panel-section-title", textContent: "Saved Snapshots" });
    const listContainer = el("div", { className: "ryp-panel-list", id: "ryp-panel-list" });

    // Search
    const searchInput = el("input", {
      type: "text",
      id: "ryp-search-input",
      className: "ryp-search-input",
      placeholder: "Search snapshots...",
    });

    // Panel root
    const panel = el("div", {
      id: PANEL_ID,
      role: "dialog",
      "aria-label": "Saved Playlists",
    }, [header, saveSection, sectionTitle, searchInput, listContainer]);

    document.body.appendChild(panel);
    bindPanelEvents(panel);

    // Load and apply settings
    api.storage.local.get("ryp_settings").then((res) => {
      const settings = res.ryp_settings || {};
      applyPanelSettings(settings);
    });
  }

  function bindPanelEvents(panel) {
    panel.querySelector("#ryp-search-input").addEventListener("input", () => {
      renderList();
    });

    const closeBtn = panel.querySelector("#ryp-panel-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel(false);
      });
    }

    panel.querySelector("#ryp-save-confirm").addEventListener("click", async (event) => {
      const saveButton = event.currentTarget;
      if (saveButton.disabled) return;
      const input = document.getElementById("ryp-save-name");
      const tagsInput = document.getElementById("ryp-save-tags");
      const name = input.value.trim();
      if (!name) {
        input.classList.add("ryp-input-error");
        input.focus();
        setTimeout(() => input.classList.remove("ryp-input-error"), 1200);
        return;
      }

      saveButton.disabled = true;
      try {
        const listId = Playlist.getPlaylistId();
        const saved = (await State.get(State.keys.savedPlaylists)) || [];
        const existing = saved.filter((p) => p.sourceListId === listId);
        const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

        if (existing.length > 0) {
          showSaveOptionsModal({
            existingSnapshots: existing,
            newName: name,
            tags: tagsInput.value,
            expectedListId: listId,
            onComplete: async (isUpdate) => {
              input.value = "";
              tagsInput.value = "";
              await renderList();
              showToast("✓ " + (isUpdate ? dict.updateConfirm : dict.saveConfirm));
            },
          });
        } else {
          await saveCurrentOrder(name, null, tagsInput.value, listId);
          input.value = "";
          tagsInput.value = "";
          await renderList();
          showToast("✓ " + dict.saveConfirm);
        }
      } catch (err) {
        showToast(err.message || "Could not save the snapshot");
      } finally {
        saveButton.disabled = false;
      }
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
      const file = importInput.files && importInput.files[0];
      importInput.value = "";
      if (!file) return;
      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
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

    // Close when clicking outside the panel or pressing Escape.
    document.addEventListener("click", (e) => {
      if (
        panelVisible &&
        !panel.contains(e.target) &&
        e.target.id !== "ryp-btn-playlists" &&
        !e.target.closest("#ryp-btn-playlists")
      ) {
        togglePanel(false);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelVisible) {
        togglePanel(false);
      }
    });
  }

  // ── Save logic ────────────────────────────────────────────────────────────

  async function saveCurrentOrder(name, updateSnapshotId = null, tags = [], expectedListId = null) {
    const listId = Playlist.getPlaylistId();
    if (!listId) throw new Error("Not on a playlist page");
    if (expectedListId && listId !== expectedListId) {
      throw new Error("The active playlist changed before the snapshot was saved");
    }
    // Works on both the watch sidebar and the /playlist overview table.
    const items = Playlist.getAllCurrentItems();
    if (items.length === 0) throw new Error("No playlist videos are loaded");

    // The overview page has no active playback mode — its order is as listed.
    const { reverseOn, customOrder } = Playlist.isPlaylistWatchPage()
      ? Playback.getState()
      : { reverseOn: false, customOrder: null };
    const originalOrder = items.map((it) => it.index);
    const order =
      customOrder && customOrder.length > 0
        ? [...customOrder]
        : reverseOn
          ? originalOrder.reverse()
          : originalOrder;
    const normalizedTags = window.RYP.Backup.normalizeTags(tags);
    const videos = items.map((it) => ({
      index: it.index,
      videoId: it.videoId,
      title: it.title,
      thumbnail: it.thumbnail,
      durationStr: it.durationStr || "",
    }));

    let saved = (await State.get(State.keys.savedPlaylists)) || [];

    if (updateSnapshotId) {
      const snapshotExists = saved.some(
        (p) => p.id === updateSnapshotId && p.sourceListId === listId
      );
      if (!snapshotExists) {
        throw new Error("The selected snapshot no longer belongs to this playlist");
      }
      saved = saved.map((p) => {
        if (p.id === updateSnapshotId && p.sourceListId === listId) {
          return {
            ...p,
            tags: normalizedTags.length > 0 ? normalizedTags : (p.tags || []),
            order,
            videos,
            savedAt: new Date().toISOString(),
          };
        }
        return p;
      });
    } else {
      const entry = {
        id: crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        tags: normalizedTags,
        sourceListId: listId,
        order,
        videos,
        savedAt: new Date().toISOString(),
      };
      saved.unshift(entry);
    }
    await State.set(State.keys.savedPlaylists, saved);
  }

  // ── Universal Add Video to Playlist Modal ─────────────────────────────────

  /**
   * A local playlist holds arbitrary videos and plays through our own sidebar
   * panel (`ryp_list`). Anything carrying a real playlist id is a *view* over
   * YouTube's own list and plays through `list=` — it cannot hold videos that
   * YouTube's playlist does not have. "custom" is the pre-3.3.0 spelling of "".
   */
  function isLocalPlaylist(snapshot) {
    const source = snapshot?.sourceListId;
    return !source || source === "custom" || source.startsWith("virtual:");
  }

  async function showAddToPlaylistModal(videoData) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    overlay.dir = activeLang === "ar" ? "rtl" : "ltr";

    const titleEl = el("h3", { className: "ryp-modal-title", textContent: dict.addToPlaylistTitle });
    const promptEl = el("p", { className: "ryp-modal-text", textContent: dict.addToPlaylistPrompt });
    promptEl.style.margin = "8px 0 14px 0";
    promptEl.style.fontSize = "13px";
    promptEl.style.color = "var(--ryp-sub)";

    // Video preview header
    const preview = el("div", { className: "ryp-add-preview" });
    preview.style.display = "flex";
    preview.style.alignItems = "center";
    preview.style.gap = "10px";
    preview.style.padding = "10px";
    preview.style.background = "var(--ryp-card-bg)";
    preview.style.borderRadius = "8px";
    preview.style.marginBottom = "14px";

    if (videoData.thumbnail) {
      const thumb = el("img", { src: videoData.thumbnail, className: "ryp-preview-thumb" });
      thumb.style.width = "48px";
      thumb.style.height = "36px";
      thumb.style.objectFit = "cover";
      thumb.style.borderRadius = "4px";
      preview.appendChild(thumb);
    }
    const previewTitle = el("div", { className: "ryp-preview-title", textContent: videoData.title || "Current Video" });
    previewTitle.style.fontWeight = "600";
    previewTitle.style.fontSize = "12px";
    previewTitle.style.overflow = "hidden";
    previewTitle.style.textOverflow = "ellipsis";
    previewTitle.style.whiteSpace = "nowrap";
    preview.appendChild(previewTitle);

    // Create New Playlist Form
    const createRow = el("div", { className: "ryp-save-row" });
    createRow.style.marginBottom = "14px";

    const newNameInput = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: dict.createNewPlaylist,
      maxlength: "80",
    });
    newNameInput.style.flex = "1";

    const createBtn = el("button", {
      className: "ryp-modal-btn ryp-modal-btn-confirm",
      textContent: dict.createAndAdd,
    });
    createRow.append(newNameInput, createBtn);

    // Existing Playlists List
    const playlistsList = el("div", { className: "ryp-add-playlists-list" });
    playlistsList.style.display = "flex";
    playlistsList.style.flexDirection = "column";
    playlistsList.style.gap = "6px";
    playlistsList.style.maxHeight = "200px";
    playlistsList.style.overflowY = "auto";
    playlistsList.style.marginBottom = "14px";

    // Only local playlists can hold arbitrary videos. A snapshot with a
    // sourceListId is a view over a real YouTube playlist — adding a foreign
    // video to it would count but could never play. See isLocalPlaylist().
    const saved = ((await State.get(State.keys.savedPlaylists)) || []).filter(isLocalPlaylist);

    const close = () => {
      window.removeEventListener("keydown", escListener);
      overlay.classList.add("ryp-modal-closing");
      setTimeout(() => overlay.remove(), 220);
    };

    const addVideoToSnapshot = async (snapshot) => {
      // Re-read: the modal may have been open while the popup or another tab
      // edited storage. `saved` is only good enough to render the list.
      const current = (await State.get(State.keys.savedPlaylists)) || [];
      const target = current.find((pl) => pl.id === snapshot.id);
      if (!target) {
        showToast(dict.noSnapshots);
        close();
        return;
      }

      const alreadyIn = (target.videos || []).some((v) => v.videoId === videoData.videoId);
      if (alreadyIn) {
        showToast(dict.videoAlreadyInPlaylist.replace("{playlist}", target.name));
        close();
        return;
      }

      const indices = (target.videos || [])
        .map((v) => Number(v.index))
        .filter((n) => Number.isFinite(n));
      const nextIndex = (indices.length ? Math.max(...indices) : 0) + 1;
      const newVideoEntry = {
        index: nextIndex,
        videoId: videoData.videoId,
        title: videoData.title || "",
        thumbnail: videoData.thumbnail || "",
        durationStr: videoData.durationStr || "",
      };

      const updatedSnapshots = current.map((pl) => {
        if (pl.id === target.id) {
          const videos = [...(pl.videos || []), newVideoEntry];
          const order = [...(pl.order || []), nextIndex];
          return { ...pl, videos, order, savedAt: new Date().toISOString() };
        }
        return pl;
      });

      await State.set(State.keys.savedPlaylists, updatedSnapshots);
      showToast(dict.addedToPlaylist.replace("{playlist}", target.name));
      if (panelVisible) renderList();
      close();
    };

    const listHeading = el("div", { className: "ryp-modal-subhead", textContent: dict.localPlaylists });

    if (saved.length === 0) {
      const emptyNote = el("p", { className: "ryp-modal-text", textContent: dict.noLocalPlaylists });
      emptyNote.style.fontStyle = "italic";
      emptyNote.style.fontSize = "12px";
      playlistsList.appendChild(emptyNote);
    } else {
      saved.forEach((pl) => {
        const itemRow = el("div", { className: "ryp-playlist-select-item" });
        itemRow.style.display = "flex";
        itemRow.style.alignItems = "center";
        itemRow.style.justifyContent = "space-between";
        itemRow.style.padding = "8px 12px";
        itemRow.style.background = "var(--ryp-card-bg)";
        itemRow.style.borderRadius = "6px";
        itemRow.style.border = "1px solid var(--ryp-border)";

        const nameSpan = el("span", { textContent: `${pl.name} (${pl.videos?.length || 0} ${dict.videosWord})` });
        nameSpan.style.fontSize = "12.5px";
        nameSpan.style.fontWeight = "500";

        const addBtn = el("button", {
          className: "ryp-btn ryp-btn-add",
          textContent: `+ ${dict.addBtn}`,
        });
        addBtn.style.padding = "4px 10px";
        addBtn.style.fontSize = "11px";

        addBtn.addEventListener("click", () => addVideoToSnapshot(pl));

        itemRow.append(nameSpan, addBtn);
        playlistsList.appendChild(itemRow);
      });
    }

    createBtn.addEventListener("click", async () => {
      const name = newNameInput.value.trim();
      if (!name) {
        newNameInput.classList.add("ryp-input-error");
        newNameInput.focus();
        setTimeout(() => newNameInput.classList.remove("ryp-input-error"), 1200);
        return;
      }

      createBtn.disabled = true;
      try {
        const newSnapshot = {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name,
          tags: [],
          // Always local, even when created from inside a YouTube playlist —
          // stamping the current playlist id would make the new list a view
          // that can never receive another video.
          sourceListId: "",
          order: [1],
          videos: [{
            index: 1,
            videoId: videoData.videoId,
            title: videoData.title || "",
            thumbnail: videoData.thumbnail || "",
            durationStr: videoData.durationStr || "",
          }],
          savedAt: new Date().toISOString(),
        };
        const currentSaved = (await State.get(State.keys.savedPlaylists)) || [];
        currentSaved.unshift(newSnapshot);
        await State.set(State.keys.savedPlaylists, currentSaved);
        showToast(dict.addedToPlaylist.replace("{playlist}", name));
        if (panelVisible) renderList();
        close();
      } catch (err) {
        showToast(err.message || "Failed to create playlist");
        createBtn.disabled = false;
      }
    });

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
    cancelBtn.style.width = "100%";
    cancelBtn.style.justifyContent = "center";
    cancelBtn.addEventListener("click", close);

    const modal = el("div", { className: "ryp-modal-content" }, [
      titleEl,
      promptEl,
      preview,
      createRow,
      listHeading,
      playlistsList,
      cancelBtn
    ]);
    modal.style.maxWidth = "360px";

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const escListener = (e) => {
      if (e.key === "Escape") close();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    window.addEventListener("keydown", escListener);
  }

  function showSaveOptionsModal({ existingSnapshots, newName, tags, expectedListId, onComplete }) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    overlay.dir = activeLang === "ar" ? "rtl" : "ltr";

    const titleEl = el("h3", { className: "ryp-modal-title", textContent: dict.saveOptionsTitle });
    const textEl = el("p", {
      className: "ryp-modal-text",
      textContent: dict.saveOptionsPrompt
    });
    textEl.style.margin = "12px 0 20px 0";
    textEl.style.fontSize = "14px";
    textEl.style.color = "var(--ryp-sub)";

    const buttonsList = el("div", { className: "ryp-modal-buttons-vertical" });
    buttonsList.style.display = "flex";
    buttonsList.style.flexDirection = "column";
    buttonsList.style.gap = "8px";
    buttonsList.style.width = "100%";

    const saveNewBtn = el("button", {
      className: "ryp-modal-btn ryp-modal-btn-confirm",
      textContent: `${dict.saveAsNew}: "${newName}"`
    });
    saveNewBtn.style.justifyContent = "center";
    buttonsList.appendChild(saveNewBtn);

    existingSnapshots.forEach((snap) => {
      const btn = el("button", {
        className: "ryp-modal-btn ryp-modal-btn-action",
        textContent: `${dict.updateExisting}: "${snap.name}"`
      });
      btn.style.justifyContent = "center";
      btn.style.background = "rgba(16, 185, 129, 0.08)";
      btn.style.borderColor = "var(--ryp-accent-success, #10b981)";
      btn.style.color = "var(--ryp-accent-success, #10b981)";

      btn.addEventListener("click", () => runSave(snap.id));
      buttonsList.appendChild(btn);
    });

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
    cancelBtn.style.justifyContent = "center";
    buttonsList.appendChild(cancelBtn);

    const modal = el("div", { className: "ryp-modal-content" }, [
      titleEl,
      textEl,
      buttonsList
    ]);
    modal.style.maxWidth = "400px";

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const escListener = (e) => {
      if (e.key === "Escape") close();
    };
    const close = () => {
      window.removeEventListener("keydown", escListener);
      overlay.classList.add("ryp-modal-closing");
      setTimeout(() => overlay.remove(), 220);
    };
    const runSave = async (snapshotId) => {
      for (const button of buttonsList.querySelectorAll("button")) button.disabled = true;
      try {
        await saveCurrentOrder(newName, snapshotId, tags, expectedListId);
        close();
        onComplete(snapshotId !== null);
      } catch (err) {
        showToast(err.message || "Could not save the snapshot");
        for (const button of buttonsList.querySelectorAll("button")) button.disabled = false;
      }
    };

    saveNewBtn.addEventListener("click", () => runSave(null));

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    saveNewBtn.focus();
    window.addEventListener("keydown", escListener);
  }

  // ── List rendering ────────────────────────────────────────────────────────

  async function renderList() {
    const listEl = document.getElementById("ryp-panel-list");
    if (!listEl) return;

    const playlists = (await State.get(State.keys.savedPlaylists)) || [];

    const searchInput = document.getElementById("ryp-search-input");
    if (searchInput) {
      searchInput.style.display = playlists.length > 0 ? "block" : "none";
    }

    const searchQuery = searchInput?.value?.trim()?.toLowerCase() || "";
    const filteredPlaylists = searchQuery
      ? playlists.filter((pl) => {
          const name = typeof pl.name === "string" ? pl.name : "";
          const tags = Array.isArray(pl.tags) ? pl.tags : [];
          return name.toLowerCase().includes(searchQuery) ||
            tags.some((tag) => String(tag).toLowerCase().includes(searchQuery));
        })
      : playlists;

    listEl.replaceChildren();

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

    if (filteredPlaylists.length === 0) {
      const emptyIcon = el("div", { className: "ryp-empty-icon" });
      emptyIcon.appendChild(ICONS.folder());
      const emptyText = el("p", { textContent: dict.noMatchingSnapshots });
      listEl.appendChild(el("div", { className: "ryp-empty-state" }, [emptyIcon, emptyText]));
      return;
    }

    for (const pl of filteredPlaylists) {
      const date = new Date(pl.savedAt).toLocaleDateString(activeLang, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const nameEl = el("div", { className: "ryp-saved-name" });
      nameEl.textContent = pl.name;
      nameEl.title = pl.name;
      const metaEl = el("div", {
        className: "ryp-saved-meta",
        textContent: `${pl.videos?.length ?? pl.order.length} ${dict.videosWord} · ${date}`,
      });
      const tagsEl = el("div", { className: "ryp-snapshot-tags" });
      for (const tag of Array.isArray(pl.tags) ? pl.tags : []) {
        tagsEl.appendChild(el("span", { className: "ryp-tag", textContent: `#${tag}` }));
      }
      const infoCol = el("div", { className: "ryp-saved-info" }, [nameEl, metaEl, tagsEl]);

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

      playBtn.addEventListener("click", async () => {
        if (!pl || !pl.videos || pl.videos.length === 0) return;
        const firstIndex = (pl.order && pl.order.length > 0) ? pl.order[0] : pl.videos[0].index;
        const firstVideo = pl.videos.find((v) => v.index === firstIndex) || pl.videos[0];
        if (!firstVideo) return;
        
        // A snapshot of a real YouTube playlist plays in that playlist with a
        // custom order. Only snapshots with no real source (built via "Add to
        // List") play as a virtual playlist off our own sidebar.
        const isNative = pl.sourceListId && pl.sourceListId !== "custom" && !pl.sourceListId.startsWith("virtual:");
        const suffix = isNative
          ? `&list=${pl.sourceListId}&index=${firstIndex}`
          : Playlist.rypHash(pl.id, firstIndex);

        if (isNative) {
          await Playback.applyCustomOrder(pl.sourceListId, pl.order);
        }
        const url = `https://www.youtube.com/watch?v=${firstVideo.videoId}${suffix}`;
        window.open(url, "_self");
      });

      deleteBtn.addEventListener("click", () => {
        showConfirmModal("deleteConfirm", async () => {
          let saved = (await State.get(State.keys.savedPlaylists)) || [];
          saved = saved.filter((p) => p.id !== pl.id);
          await State.set(State.keys.savedPlaylists, saved);
          await renderList();
        });
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
    if (panelVisible) {
      const searchInput = document.getElementById("ryp-search-input");
      if (searchInput) searchInput.value = "";
      renderList();
    }
    window.RYP.Toolbar?.syncButtonStates();
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
    toast.textContent = message;
    document.body.appendChild(toast);
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

  function showSaveModal({ title, placeholder, tagsPlaceholder, defaultValue, defaultTags, confirmLabel, onConfirm }) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    overlay.dir = activeLang === "ar" ? "rtl" : "ltr";
    const titleEl = el("h3", { className: "ryp-modal-title", textContent: title });

    const input = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: placeholder || "",
      maxlength: "80"
    });
    input.value = defaultValue || "";
    const tagsInput = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: tagsPlaceholder || dict.tagsPlaceholder,
      maxlength: "200"
    });
    tagsInput.value = Array.isArray(defaultTags) ? defaultTags.join(", ") : (defaultTags || "");

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
    const confirmBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-confirm", textContent: confirmLabel || "Confirm" });
    
    const buttonsRow = el("div", { className: "ryp-modal-buttons" }, [cancelBtn, confirmBtn]);
    const modal = el("div", { className: "ryp-modal-content" }, [
      titleEl,
      input,
      tagsInput,
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
      if (confirmBtn.disabled) return;
      const val = input.value.trim();
      if (!val) {
        input.classList.add("ryp-input-error");
        input.focus();
        setTimeout(() => input.classList.remove("ryp-input-error"), 1200);
        return;
      }
      confirmBtn.disabled = true;
      onConfirm(val, tagsInput.value);
      close();
    };

    confirmBtn.addEventListener("click", handleConfirm);
    const handleKeydown = (e) => {
      if (e.key === "Enter") handleConfirm();
      if (e.key === "Escape") close();
    };
    input.addEventListener("keydown", handleKeydown);
    tagsInput.addEventListener("keydown", handleKeydown);
  }

  function showConfirmModal(textKey, onConfirm) {
    const existing = document.getElementById("ryp-custom-modal");
    if (existing) existing.remove();

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const overlay = el("div", { id: "ryp-custom-modal", className: "ryp-modal-overlay" });
    overlay.dir = activeLang === "ar" ? "rtl" : "ltr";

    const titleEl = el("h3", { className: "ryp-modal-title", textContent: dict.confirm });
    const textEl = el("p", { className: "ryp-modal-text", textContent: dict[textKey] || textKey });
    textEl.style.margin = "12px 0 20px 0";
    textEl.style.fontSize = "14px";
    textEl.style.color = "var(--ryp-sub)";

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
    const confirmBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-confirm", textContent: dict.confirm });

    const buttonsRow = el("div", { className: "ryp-modal-buttons" }, [cancelBtn, confirmBtn]);
    const modal = el("div", { className: "ryp-modal-content" }, [
      titleEl,
      textEl,
      buttonsRow
    ]);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const escListener = (e) => {
      if (e.key === "Escape") close();
    };
    const close = () => {
      window.removeEventListener("keydown", escListener);
      overlay.classList.add("ryp-modal-closing");
      setTimeout(() => overlay.remove(), 220);
    };

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    confirmBtn.addEventListener("click", async () => {
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await onConfirm();
        close();
      } catch (err) {
        showToast(err.message || "The operation failed");
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    confirmBtn.focus();
    window.addEventListener("keydown", escListener);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Panel = {
    injectPanel,
    togglePanel,
    isPanelVisible: () => panelVisible,
    showToast,
    showResumeToast,
    t: (key) => (TRANSLATIONS[activeLang] || TRANSLATIONS.en)[key] || key,
    saveCurrentOrder,
    renderList,
    showSaveModal,
    showSaveOptionsModal,
    showAddToPlaylistModal,
    isLocalPlaylist,
  };
})();
