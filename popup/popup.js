(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  
  // DOM Elements
  const listContainer = document.getElementById("playlist-list");
  const deleteAllBtn = document.getElementById("delete-all-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const saveSection = document.getElementById("save-current-section");
  const saveInput = document.getElementById("save-input-popup");
  const saveConfirmBtn = document.getElementById("save-confirm-popup");
  const logoContainer = document.getElementById("popup-title-icon");
  const importBtn = document.getElementById("import-btn");
  const exportBtn = document.getElementById("export-btn");
  const listCountEl = document.getElementById("list-count");

  // Settings controls
  const langSelect = document.getElementById("lang-select");
  const skipToggle = document.getElementById("skip-watched-toggle");
  const badgesToggle = document.getElementById("show-badges-toggle");
  const compactToggle = document.getElementById("compact-toggle");
  const loopToggle = document.getElementById("loop-toggle");
  const resumeToggle = document.getElementById("resume-toggle");

  let activeTabId = null;
  let currentSettings = { lang: "en", autoSkip: false, showBadges: true, compact: false, loop: false, resumePrompt: true };

  // ── Translations Dictionary ────────────────────────────────────────────────

  const TRANSLATIONS = {
    en: {
      extensionName: "Playlist Tools",
      reverse: "Reverse",
      reverseOn: "Reverse: ON",
      shuffle: "Shuffle",
      shuffleOn: "Shuffle: ON",
      reorder: "Reorder",
      reorderOn: "Reorder: ON",
      save: "Save",
      myLists: "My Lists",
      saveLabel: "Save current play order as a snapshot:",
      saveInputPlaceholder: "e.g. My Custom Sort",
      clearWatched: "Clear watched badges",
      savedSnapshots: "Saved Snapshots",
      noSnapshots: "No snapshots saved yet.",
      emptyHint: "Open a YouTube playlist and use the Save button or panel to add one.",
      play: "Play",
      delete: "Delete",
      rename: "Rename",
      cancel: "Cancel",
      confirm: "Confirm",
      deleteAll: "Delete All",
      settings: "Settings",
      autoSkip: "Auto-skip watched",
      showBadges: "Show watched badges",
      compact: "Compact layout",
      language: "Language",
      renamePrompt: "Rename this snapshot to:",
      nameEmpty: "Playlist name cannot be empty.",
      deleteConfirm: "Delete this playlist snapshot?",
      deleteAllConfirm: "Are you sure you want to delete all saved playlist snapshots? This cannot be undone.",
      saveConfirm: "✓ Playlist snapshot saved!",
      clearWatchedConfirm: "Watched badges cleared.",
      saveCurrentSectionLabel: "Save current playlist state:",
      loop: "Loop playlist order",
      resumePrompt: "Offer to resume playlists",
      duplicate: "Duplicate",
      copySuffix: "(copy)",
      videosWord: "videos",
      rateUs: "Enjoying it? Leave a review ★",
      export: "Export",
      import: "Import",
      exportTitle: "Export saved playlists to a file",
      importTitle: "Import saved playlists from a file",
      exportEmpty: "Nothing to export yet.",
      importDone: "✓ Imported {added} playlist(s), skipped {skipped} duplicate(s).",
      importInvalid: "Invalid backup file — nothing imported."
    },
    fr: {
      extensionName: "Outils Playlist",
      reverse: "Inverser",
      reverseOn: "Inverse : ON",
      shuffle: "Mélanger",
      shuffleOn: "Mélange : ON",
      reorder: "Réorganiser",
      reorderOn: "Réorgan. : ON",
      save: "Enregistrer",
      myLists: "Mes Listes",
      saveLabel: "Enregistrer l'ordre de lecture actuel :",
      saveInputPlaceholder: "ex: Cours inversé",
      clearWatched: "Effacer vidéos vues",
      savedSnapshots: "Instantannés",
      noSnapshots: "Aucun instantané enregistré.",
      emptyHint: "Ouvrez une playlist YouTube et utilisez le bouton d'enregistrement.",
      play: "Lire",
      delete: "Supprimer",
      rename: "Renommer",
      cancel: "Annuler",
      confirm: "Confirmer",
      deleteAll: "Tout suppr.",
      settings: "Paramètres",
      autoSkip: "Passer vidéos vues",
      showBadges: "Afficher badges vus",
      compact: "Mode compact",
      language: "Langue",
      renamePrompt: "Renommer l'instantané sous :",
      nameEmpty: "Le nom ne peut pas être vide.",
      deleteConfirm: "Supprimer cet instantané ?",
      deleteAllConfirm: "Voulez-vous supprimer tous les instantanés ? Cette action est irréversible.",
      saveConfirm: "✓ Instantané enregistré !",
      clearWatchedConfirm: "Badges de vidéos vues effacés.",
      saveCurrentSectionLabel: "Enregistrer l'état actuel :",
      loop: "Lecture en boucle",
      resumePrompt: "Proposer la reprise de lecture",
      duplicate: "Dupliquer",
      copySuffix: "(copie)",
      videosWord: "vidéos",
      rateUs: "Vous aimez ? Laissez un avis ★",
      export: "Exporter",
      import: "Importer",
      exportTitle: "Exporter les playlists sauvegardées",
      importTitle: "Importer des playlists depuis un fichier",
      exportEmpty: "Rien à exporter pour l'instant.",
      importDone: "✓ {added} playlist(s) importée(s), {skipped} doublon(s) ignoré(s).",
      importInvalid: "Fichier de sauvegarde invalide — rien n'a été importé."
    },
    ar: {
      extensionName: "أدوات قائمة التشغيل",
      reverse: "عكس",
      reverseOn: "عكس: مفعل",
      shuffle: "خلط عشوائي",
      shuffleOn: "خلط: مفعل",
      reorder: "ترتيب يدوي",
      reorderOn: "ترتيب: مفعل",
      save: "حفظ",
      myLists: "قوائمي",
      saveLabel: "حفظ الترتيب الحالي كلقطة:",
      saveInputPlaceholder: "مثال: ترتيب عكسي",
      clearWatched: "مسح شارات المشاهدة",
      savedSnapshots: "اللقطات المحفوظة",
      noSnapshots: "لا توجد لقطات بعد.",
      emptyHint: "افتح قائمة تشغيل يوتيوب واستخدم زر الحفظ للإضافة.",
      play: "تشغيل",
      delete: "حذف",
      rename: "تسمية",
      cancel: "إلغاء",
      confirm: "تأكيد",
      deleteAll: "حذف الكل",
      settings: "الإعدادات",
      autoSkip: "تخطي الفيديوهات المشاهدة",
      showBadges: "إظهار شارات المشاهدة",
      compact: "مظهر مدمج",
      language: "اللغة",
      renamePrompt: "إعادة تسمية لقطة قائمة التشغيل إلى:",
      nameEmpty: "لا يمكن أن يكون الاسم فارغًا.",
      deleteConfirm: "حذف هذه اللقطة؟",
      deleteAllConfirm: "هل أنت متأكد من حذف جميع لقطات قوائم التشغيل؟ لا يمكن التراجع عن هذا.",
      saveConfirm: "✓ تم حفظ لقطة قائمة التشغيل!",
      clearWatchedConfirm: "تمت إزالة شارات المشاهدة.",
      saveCurrentSectionLabel: "حفظ حالة قائمة التشغيل الحالية:",
      loop: "تكرار قائمة التشغيل",
      resumePrompt: "اقتراح استئناف المشاهدة",
      duplicate: "تكرار اللقطة",
      copySuffix: "(نسخة)",
      videosWord: "فيديو",
      rateUs: "أعجبك الامتداد؟ اترك تقييمًا ★",
      export: "تصدير",
      import: "استيراد",
      exportTitle: "تصدير قوائم التشغيل المحفوظة إلى ملف",
      importTitle: "استيراد قوائم تشغيل من ملف",
      exportEmpty: "لا يوجد شيء للتصدير بعد.",
      importDone: "✓ تم استيراد {added} قائمة، وتخطي {skipped} مكررة.",
      importInvalid: "ملف نسخ احتياطي غير صالح — لم يتم استيراد أي شيء."
    }
  };

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
    logo: () => svg("popup-icon-svg", "0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "17 1 21 5 17 9" } },
      { tag: "path", attrs: { d: "M3 11V9a4 4 0 0 1 4-4h14" } },
      { tag: "polyline", attrs: { points: "7 23 3 19 7 15" } },
      { tag: "path", attrs: { d: "M21 13v2a4 4 0 0 1-4 4H3" } }
    ]),
    save: () => svg("save-icon-svg", "0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" } },
      { tag: "polyline", attrs: { points: "17 21 17 13 7 13 7 21" } },
      { tag: "polyline", attrs: { points: "7 3 7 8 15 8" } }
    ]),
    folder: () => svg("folder-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" } }
    ]),
    play: () => svg("play-icon-svg", "0 0 24 24", 2, [
      { tag: "polygon", attrs: { points: "5 3 19 12 5 21 5 3" } }
    ]),
    copy: () => svg("copy-icon-svg", "0 0 24 24", 2, [
      { tag: "rect", attrs: { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" } },
      { tag: "path", attrs: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" } }
    ]),
    edit: () => svg("edit-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M12 20h9" } },
      { tag: "path", attrs: { d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" } }
    ]),
    trash: () => svg("trash-icon-svg", "0 0 24 24", 2, [
      { tag: "polyline", attrs: { points: "3 6 5 6 21 6" } },
      { tag: "path", attrs: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } },
      { tag: "line", attrs: { x1: "10", y1: "11", x2: "10", y2: "17" } },
      { tag: "line", attrs: { x1: "14", y1: "11", x2: "14", y2: "17" } }
    ]),
    download: () => svg("download-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" } },
      { tag: "polyline", attrs: { points: "7 10 12 15 17 10" } },
      { tag: "line", attrs: { x1: "12", y1: "15", x2: "12", y2: "3" } }
    ]),
    upload: () => svg("upload-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" } },
      { tag: "polyline", attrs: { points: "17 8 12 3 7 8" } },
      { tag: "line", attrs: { x1: "12", y1: "3", x2: "12", y2: "15" } }
    ]),
    settings: () => svg("settings-icon-svg", "0 0 24 24", 2, [
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "3" } },
      { tag: "path", attrs: { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" } }
    ])
  };

  // Initialize static layout elements
  if (logoContainer) logoContainer.appendChild(ICONS.logo());
  if (settingsBtn) settingsBtn.appendChild(ICONS.settings());

  // DOM creation helper (safe from XSS)
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

  // ── Localization System ───────────────────────────────────────────────────

  function getDict() {
    return TRANSLATIONS[currentSettings.lang] || TRANSLATIONS.en;
  }

  function translateUI() {
    const dict = getDict();
    document.body.dir = currentSettings.lang === "ar" ? "rtl" : "ltr";
    
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (dict[key]) {
        if (element.tagName === "INPUT" && element.type === "text") {
          element.placeholder = dict[key];
        } else {
          element.textContent = dict[key];
        }
      }
    });

    // Rebuild save confirm button to ensure translation + icon are matched
    if (saveConfirmBtn) {
      saveConfirmBtn.replaceChildren();
      saveConfirmBtn.appendChild(ICONS.save());
      saveConfirmBtn.appendChild(document.createTextNode(" " + dict.save));
    }

    // Footer action buttons: icon + visible label
    if (exportBtn) {
      exportBtn.replaceChildren();
      exportBtn.appendChild(ICONS.download());
      exportBtn.appendChild(document.createTextNode(" " + dict.export));
      exportBtn.title = dict.exportTitle;
    }
    if (importBtn) {
      importBtn.replaceChildren();
      importBtn.appendChild(ICONS.upload());
      importBtn.appendChild(document.createTextNode(" " + dict.import));
      importBtn.title = dict.importTitle;
    }
    if (settingsBtn) settingsBtn.title = dict.settings;
  }

  // ── Status toast ──────────────────────────────────────────────────────────

  function showPopupToast(message, isError = false) {
    const existing = document.getElementById("popup-toast");
    if (existing) existing.remove();
    const toast = el("div", { id: "popup-toast", className: "popup-toast", role: "status" });
    toast.classList.toggle("popup-toast-error", isError);
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  // ── Custom Popup Modals ───────────────────────────────────────────────────

  function showPopupModal({ titleKey, placeholderKey, defaultValue, confirmLabelKey, onConfirm }) {
    const existing = document.getElementById("ryp-popup-modal");
    if (existing) existing.remove();

    const dict = getDict();
    const overlay = el("div", { id: "ryp-popup-modal", className: "ryp-modal-overlay" });
    const titleEl = el("h3", { className: "ryp-modal-title", textContent: dict[titleKey] || titleKey });
    
    const input = el("input", {
      type: "text",
      className: "ryp-modal-input",
      placeholder: dict[placeholderKey] || placeholderKey || "",
      maxlength: "80"
    });
    input.value = defaultValue || "";

    const cancelBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-cancel", textContent: dict.cancel });
    const confirmBtn = el("button", { className: "ryp-modal-btn ryp-modal-btn-confirm", textContent: dict[confirmLabelKey] || confirmLabelKey });
    
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
        input.classList.add("input-error");
        input.focus();
        setTimeout(() => input.classList.remove("input-error"), 1200);
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

  function showConfirmModal(textKey, onConfirm) {
    const existing = document.getElementById("ryp-popup-modal");
    if (existing) existing.remove();

    const dict = getDict();
    const overlay = el("div", { id: "ryp-popup-modal", className: "ryp-modal-overlay" });
    const titleEl = el("h3", { className: "ryp-modal-title", textContent: dict.confirm });
    const textEl = el("p", { className: "ryp-modal-text", textContent: dict[textKey] || textKey });
    
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

    const close = () => {
      overlay.classList.add("ryp-modal-closing");
      setTimeout(() => overlay.remove(), 220);
    };

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    confirmBtn.addEventListener("click", () => {
      onConfirm();
      close();
    });
  }

  // ── Settings Handler ──────────────────────────────────────────────────────

  async function loadSettings() {
    return new Promise((resolve) => {
      api.storage.local.get("ryp_settings", (res) => {
        const defaultLang = api.i18n.getUILanguage().startsWith("ar") ? "ar" : (api.i18n.getUILanguage().startsWith("fr") ? "fr" : "en");
        const loaded = res.ryp_settings || {};
        currentSettings = {
          lang: loaded.lang || defaultLang,
          autoSkip: loaded.autoSkip ?? false,
          showBadges: loaded.showBadges ?? true,
          compact: loaded.compact ?? false,
          loop: loaded.loop ?? false,
          resumePrompt: loaded.resumePrompt ?? true,
        };
        resolve(currentSettings);
      });
    });
  }

  async function saveSettings() {
    await new Promise((resolve) => {
      api.storage.local.set({ ryp_settings: currentSettings }, resolve);
    });
    applySettingsUI();
  }

  function applySettingsUI() {
    // Sync settings controls
    langSelect.value = currentSettings.lang;
    skipToggle.checked = currentSettings.autoSkip;
    badgesToggle.checked = currentSettings.showBadges;
    compactToggle.checked = currentSettings.compact;
    loopToggle.checked = currentSettings.loop;
    resumeToggle.checked = currentSettings.resumePrompt;

    // Apply translation & direction
    translateUI();

    // Toggle compact class
    document.body.classList.toggle("ryp-compact", currentSettings.compact);
  }

  // Bind settings panel toggle
  settingsBtn.addEventListener("click", () => {
    const isVisible = settingsPanel.style.display === "flex" || settingsPanel.style.display === "block";
    settingsPanel.style.display = isVisible ? "none" : "flex";
  });

  // Bind settings changes
  langSelect.addEventListener("change", (e) => {
    currentSettings.lang = e.target.value;
    saveSettings().then(() => renderPlaylists());
  });

  skipToggle.addEventListener("change", (e) => {
    currentSettings.autoSkip = e.target.checked;
    saveSettings();
  });

  badgesToggle.addEventListener("change", (e) => {
    currentSettings.showBadges = e.target.checked;
    saveSettings();
  });

  compactToggle.addEventListener("change", (e) => {
    currentSettings.compact = e.target.checked;
    saveSettings();
  });

  loopToggle.addEventListener("change", (e) => {
    currentSettings.loop = e.target.checked;
    saveSettings();
  });

  resumeToggle.addEventListener("change", (e) => {
    currentSettings.resumePrompt = e.target.checked;
    saveSettings();
  });

  // ── Import / Export ───────────────────────────────────────────────────────
  // Validation/merge/download logic is shared with the in-page panel via
  // window.RYP.Backup (src/backup.js, loaded by popup.html).

  const Backup = window.RYP.Backup;

  async function exportPlaylists() {
    const dict = getDict();
    const res = await api.storage.local.get("savedPlaylists");
    const playlists = res.savedPlaylists || [];
    if (playlists.length === 0) {
      showPopupToast(dict.exportEmpty, true);
      return;
    }
    Backup.triggerDownload(playlists);
  }

  exportBtn.addEventListener("click", exportPlaylists);

  // Importing needs a file picker, but Firefox closes the browser-action
  // popup as soon as the picker takes focus — the chosen file would never
  // reach us. Run the import from a dedicated extension tab instead.
  importBtn.addEventListener("click", () => {
    api.tabs.create({ url: api.runtime.getURL("popup/import.html") });
    window.close();
  });

  // ── Tab Management & URL Queries ──────────────────────────────────────────

  // Check if active tab is a YouTube playlist *watch* page and show the save
  // section. /playlist browse pages are excluded — the content script can
  // only read the sidebar on watch pages, so saving there would fail.
  api.tabs.query({ active: true, currentWindow: true })
    .then((tabs) => {
      const activeTab = tabs && tabs[0];
      if (activeTab && activeTab.url) {
        const url = activeTab.url;
        if (url.includes("youtube.com/") && url.includes("/watch") && url.includes("list=")) {
          activeTabId = activeTab.id;
          saveSection.style.display = "block";
        }
      }
    })
    .catch((err) => {
      console.warn("Could not query active tab on startup:", err);
    });

  // Save current playlist state via message to content script (Create)
  saveConfirmBtn.addEventListener("click", () => {
    if (!activeTabId) return;
    const name = saveInput.value.trim();
    if (!name) {
      saveInput.classList.add("input-error");
      saveInput.focus();
      setTimeout(() => saveInput.classList.remove("input-error"), 1200);
      return;
    }

    api.tabs.sendMessage(activeTabId, { action: "SAVE_PLAYLIST", name: name })
      .then((response) => {
        if (response && response.success) {
          saveInput.value = "";
          renderPlaylists();
          showPopupToast(getDict().saveConfirm);
        } else {
          showPopupToast(response?.error || "Failed to save playlist state.", true);
        }
      })
      .catch((err) => {
        console.error("Error sending message to content script:", err);
        showPopupToast("Cannot communicate with the YouTube tab. Please refresh the page and try again.", true);
      });
  });

  // Render playlists list (Read)
  async function renderPlaylists() {
    listContainer.replaceChildren();

    const dict = getDict();
    const data = await new Promise((resolve) => {
      api.storage.local.get("savedPlaylists", (res) => {
        resolve(res.savedPlaylists || []);
      });
    });

    if (listCountEl) {
      listCountEl.textContent = String(data.length);
      listCountEl.style.display = data.length > 0 ? "inline-flex" : "none";
    }

    if (data.length === 0) {
      deleteAllBtn.style.display = "none";
      const emptyIcon = el("div", { className: "empty-icon" });
      emptyIcon.appendChild(ICONS.folder());
      const emptyText = el("p", { className: "empty-text", textContent: dict.noSnapshots });
      const emptyHint = el("p", { className: "empty-hint", textContent: dict.emptyHint });
      listContainer.appendChild(el("div", { className: "empty-state" }, [emptyIcon, emptyText, emptyHint]));
      return;
    }

    deleteAllBtn.style.display = "block";

    for (const pl of data) {
      const date = new Date(pl.savedAt).toLocaleDateString(currentSettings.lang, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const nameEl = el("div", { className: "playlist-name", textContent: pl.name });
      nameEl.title = pl.name;
      const metaEl = el("div", {
        className: "playlist-meta",
        textContent: `${pl.order.length} ${dict.videosWord} · ${date}`,
      });
      const infoCol = el("div", { className: "playlist-info" }, [nameEl, metaEl]);

      const playBtn = el("button", {
        className: "action-play",
        title: dict.play,
      });
      playBtn.appendChild(ICONS.play());
      playBtn.appendChild(document.createTextNode(" " + dict.play));

      const duplicateBtn = el("button", {
        className: "action-duplicate",
        title: dict.duplicate,
      });
      duplicateBtn.appendChild(ICONS.copy());

      const renameBtn = el("button", {
        className: "action-rename",
        title: dict.rename,
      });
      renameBtn.appendChild(ICONS.edit());

      const deleteBtn = el("button", {
        className: "action-delete",
        title: dict.delete,
      });
      deleteBtn.appendChild(ICONS.trash());

      const actionsCol = el("div", { className: "playlist-actions" }, [playBtn, duplicateBtn, renameBtn, deleteBtn]);
      const card = el("div", { className: "playlist-card" }, [infoCol, actionsCol]);

      // Play action
      playBtn.addEventListener("click", async () => {
        if (!pl.order || pl.order.length === 0) return;
        const firstIndex = pl.order[0];
        const firstVideo = pl.videos.find((v) => v.index === firstIndex);
        if (!firstVideo) return;

        // Restore the snapshot's order as the active custom order so the
        // content script plays the saved sequence (keys match src/state.js).
        await api.storage.local.set({
          [`customOrder:${pl.sourceListId}`]: pl.order,
          [`reverse:${pl.sourceListId}`]: false,
          [`shuffle:${pl.sourceListId}`]: false,
        });

        const url = `https://www.youtube.com/watch?v=${firstVideo.videoId}&list=${pl.sourceListId}&index=${firstIndex}`;

        api.tabs.query({ active: true, currentWindow: true })
          .then((tabs) => {
            const activeTab = tabs && tabs[0];
            if (activeTab && activeTab.id) {
              api.tabs.update(activeTab.id, { url: url })
                .catch((err) => {
                  console.warn("Failed to update active tab, creating new instead:", err);
                  api.tabs.create({ url: url });
                });
            } else {
              api.tabs.create({ url: url });
            }
            window.close();
          })
          .catch((err) => {
            console.error("Error querying active tab for playback:", err);
            api.tabs.create({ url: url });
            window.close();
          });
      });

      // Duplicate action — inserts the copy right after the original
      duplicateBtn.addEventListener("click", () => {
        api.storage.local.get("savedPlaylists", (res) => {
          const saved = res.savedPlaylists || [];
          const pos = saved.findIndex((p) => p.id === pl.id);
          if (pos === -1) return;
          const src = saved[pos];
          const copy = {
            ...src,
            id: Backup.freshId(),
            name: `${src.name} ${dict.copySuffix}`.slice(0, 80),
            order: [...src.order],
            videos: src.videos.map((v) => ({ ...v })),
            savedAt: new Date().toISOString(),
          };
          saved.splice(pos + 1, 0, copy);
          api.storage.local.set({ savedPlaylists: saved }, () => {
            renderPlaylists();
          });
        });
      });

      // Rename action (Update)
      renameBtn.addEventListener("click", () => {
        showPopupModal({
          titleKey: "renamePrompt",
          placeholderKey: "saveInputPlaceholder",
          defaultValue: pl.name,
          confirmLabelKey: "rename",
          onConfirm: (trimmed) => {
            api.storage.local.get("savedPlaylists", (res) => {
              const saved = res.savedPlaylists || [];
              const index = saved.findIndex((p) => p.id === pl.id);
              if (index !== -1) {
                saved[index].name = trimmed;
                api.storage.local.set({ savedPlaylists: saved }, () => {
                  renderPlaylists();
                });
              }
            });
          }
        });
      });

      // Delete action (Delete)
      deleteBtn.addEventListener("click", () => {
        showConfirmModal("deleteConfirm", () => {
          api.storage.local.get("savedPlaylists", (res) => {
            let saved = res.savedPlaylists || [];
            saved = saved.filter((p) => p.id !== pl.id);
            api.storage.local.set({ savedPlaylists: saved }, () => {
              renderPlaylists();
            });
          });
        });
      });

      listContainer.appendChild(card);
    }
  }

  // Delete all action (Delete All)
  deleteAllBtn.addEventListener("click", () => {
    showConfirmModal("deleteAllConfirm", () => {
      api.storage.local.set({ savedPlaylists: [] }, () => {
        renderPlaylists();
      });
    });
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  await loadSettings();
  applySettingsUI();
  await renderPlaylists();
})();
