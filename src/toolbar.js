/*
 * YouTube Playlist Tools — toolbar.js
 *
 * Injects and manages the playlist toolbar:
 *   [Reverse] [Shuffle] [Reorder] [Reset] [Save] [My Lists]
 *
 * Each button reflects live state (active / inactive) from Playback and
 * Sidebar. The toolbar is re-injected whenever YouTube removes it (SPA
 * navigation, panel re-render) via the MutationObserver in content.js.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { Playlist, Playback, Sidebar, Panel, State } = window.RYP;

  const TOOLBAR_ID = "ryp-toolbar";
  const api = typeof browser !== "undefined" ? browser : chrome;

  let activeLang = "en";

  // ── Translations Dictionary ────────────────────────────────────────────────

  const TRANSLATIONS = {
    en: {
      reverse: "Reverse",
      reverseOn: "Reverse: ON",
      shuffle: "Shuffle",
      shuffleOn: "Shuffle: ON",
      reorder: "Reorder",
      reorderOn: "Reorder: ON",
      save: "Save",
      myLists: "My Lists",
      reverseTitle: "Play playlist in reverse — last video first",
      reverseOnTitle: "Reverse is ON — playing last to first (click to turn off)",
      shuffleTitle: "Play playlist in a random order",
      shuffleOnTitle: "Shuffle is ON — random order (click to turn off)",
      reorderTitle: "Drag sidebar items to set a custom play order",
      reorderOnTitle: "Reorder ON — drag to rearrange (click to exit)",
      saveTitle: "Save the current playlist order as a local snapshot",
      myListsTitle: "Open saved playlist snapshots",
      myListsOnTitle: "Close saved snapshots panel",
      saveModalTitle: "Save Playlist Snapshot",
      saveModalPlaceholder: "e.g. My Custom Sort",
      tagsPlaceholder: "Tags (comma separated)",
      reset: "Reset",
      resetTitle: "Restore original playlist play order",
      reorderActive: "Custom Order",
      reorderActiveTitle: "Custom play order is active — drag-reordered (click to modify)"
    },
    fr: {
      reverse: "Inverser",
      reverseOn: "Inverse : ON",
      shuffle: "Mélanger",
      shuffleOn: "Mélange : ON",
      reorder: "Réorganiser",
      reorderOn: "Réorgan. : ON",
      save: "Enregistrer",
      myLists: "Mes Listes",
      reverseTitle: "Lire la playlist à l'envers — dernière vidéo en premier",
      reverseOnTitle: "Inverse est ACTIF — lecture de fin à début (cliquez pour désactiver)",
      shuffleTitle: "Lire la playlist dans un ordre aléatoire",
      shuffleOnTitle: "Mélange est ACTIF — ordre aléatoire (cliquez pour désactiver)",
      reorderTitle: "Faites glisser les éléments pour personnaliser l'ordre de lecture",
      reorderOnTitle: "Réorganisation ACTIVE — glissez pour réordonner (cliquez pour quitter)",
      saveTitle: "Enregistrer l'ordre actuel comme instantané local",
      myListsTitle: "Ouvrir les instantanés de playlist sauvegardés",
      myListsOnTitle: "Fermer le panneau des instantanés",
      saveModalTitle: "Enregistrer un instantané",
      saveModalPlaceholder: "ex: Cours inversé",
      tagsPlaceholder: "Tags (séparés par des virgules)",
      reset: "Réinitialiser",
      resetTitle: "Restaurer l'ordre de lecture original",
      reorderActive: "Ordre Perso",
      reorderActiveTitle: "L'ordre personnalisé est actif (cliquez pour modifier)"
    },
    ar: {
      reverse: "عكس",
      reverseOn: "عكس: مفعل",
      shuffle: "خلط عشوائي",
      shuffleOn: "خلط: مفعل",
      reorder: "ترتيب يدوي",
      reorderOn: "ترتيب: مفعل",
      save: "حفظ",
      myLists: "قوائمي",
      reverseTitle: "تشغيل قائمة التشغيل بالعكس — الفيديو الأخير أولاً",
      reverseOnTitle: "العكس مفعل — التشغيل من الآخر للأول (انقر للإلغاء)",
      shuffleTitle: "تشغيل قائمة التشغيل بترتيب عشوائي",
      shuffleOnTitle: "الخلط العشوائي مفعل — ترتيب عشوائي (انقر للإلغاء)",
      reorderTitle: "اسحب عناصر الشريط الجانبي لترتيب مخصص",
      reorderOnTitle: "الترتيب اليدوي مفعل — اسحب لإعادة الترتيب (انقر للخروج)",
      saveTitle: "حفظ الترتيب الحالي كلقطة محلية",
      myListsTitle: "فتح لقطات قوائم التشغيل المحفوظة",
      myListsOnTitle: "إغلاق لوحة القوائم المحفوظة",
      saveModalTitle: "حفظ لقطة قائمة التشغيل",
      saveModalPlaceholder: "مثال: ترتيب عكسي",
      tagsPlaceholder: "وسوم (مفصولة بفواصل)",
      reset: "إعادة تعيين",
      resetTitle: "استعادة ترتيب التشغيل الأصلي لقائمة التشغيل",
      reorderActive: "ترتيب مخصص",
      reorderActiveTitle: "ترتيب التشغيل المخصص مفعل (انقر للتعديل)"
    }
  };

  function applyToolbarSettings(settings) {
    activeLang = settings?.lang || "en";
    syncButtonStates();
  }

  // Listen for settings changes from the popup
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.ryp_settings) {
      applyToolbarSettings(changes.ryp_settings.newValue);
    }
  });

  // Load and apply settings on startup
  api.storage.local.get("ryp_settings").then((res) => {
    applyToolbarSettings(res.ryp_settings);
  });

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
    reset: () => svg("0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" } },
      { tag: "polyline", attrs: { points: "3 3 3 8 8 8" } }
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
    const container = Playlist.findHeaderContainer();
    if (!container) return false;

    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) {
      if (existing.parentElement === container) {
        return true;
      }
      existing.remove();
    }

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Playlist Tools");

    const reverseBtn = makeButton(
      "ryp-btn-reverse", "reverse", dict.reverse, dict.reverseTitle
    );
    const shuffleBtn = makeButton(
      "ryp-btn-shuffle", "shuffle", dict.shuffle, dict.shuffleTitle
    );
    const reorderBtn = makeButton(
      "ryp-btn-reorder", "reorder", dict.reorder, dict.reorderTitle
    );
    const resetBtn = makeButton(
      "ryp-btn-reset", "reset", dict.reset, dict.resetTitle
    );
    const saveBtn = makeButton(
      "ryp-btn-save", "save", dict.save, dict.saveTitle
    );
    const playlistsBtn = makeButton(
      "ryp-btn-playlists", "playlists", dict.myLists, dict.myListsTitle
    );

    toolbar.append(reverseBtn, shuffleBtn, reorderBtn, resetBtn, saveBtn, playlistsBtn);
    container.appendChild(toolbar);

    syncButtonStates();
    bindEvents(reverseBtn, shuffleBtn, reorderBtn, resetBtn, saveBtn, playlistsBtn);
    return true;
  }

  // ── State sync ────────────────────────────────────────────────────────────

  function syncButtonStates() {
    const { reverseOn, shuffleOn, customOrder } = Playback.getState();
    const reorderOn = Sidebar.isReorderModeOn();
    const panelOn = Panel.isPanelVisible();
    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    setActive(
      document.getElementById("ryp-btn-reverse"),
      reverseOn,
      dict.reverseOn, dict.reverse,
      dict.reverseOnTitle, dict.reverseTitle
    );
    setActive(
      document.getElementById("ryp-btn-shuffle"),
      shuffleOn,
      dict.shuffleOn, dict.shuffle,
      dict.shuffleOnTitle, dict.shuffleTitle
    );

    // Custom active state logic for Reorder button
    const reorderBtn = document.getElementById("ryp-btn-reorder");
    if (reorderBtn) {
      const isCustomActive = customOrder !== null && customOrder.length > 0 && !shuffleOn && !reverseOn;
      reorderBtn.classList.toggle("ryp-custom-active", isCustomActive);

      if (reorderOn) {
        setActive(reorderBtn, true, dict.reorderOn, dict.reorder, dict.reorderOnTitle, dict.reorderTitle);
      } else if (isCustomActive) {
        reorderBtn.classList.remove("ryp-active");
        reorderBtn.setAttribute("aria-pressed", "false");
        reorderBtn.title = dict.reorderActiveTitle;
        const labelEl = reorderBtn.querySelector(".ryp-label");
        if (labelEl) labelEl.textContent = dict.reorderActive;
      } else {
        setActive(reorderBtn, false, dict.reorderOn, dict.reorder, dict.reorderOnTitle, dict.reorderTitle);
      }
    }

    // Reset button visibility & title
    const resetBtn = document.getElementById("ryp-btn-reset");
    if (resetBtn) {
      const isModified = Playback.isActive();
      resetBtn.classList.toggle("ryp-visible", isModified);
      resetBtn.title = dict.resetTitle;
      const labelEl = resetBtn.querySelector(".ryp-label");
      if (labelEl) labelEl.textContent = dict.reset;
    }

    // Save button needs translated label & title updated
    const saveBtn = document.getElementById("ryp-btn-save");
    if (saveBtn) {
      saveBtn.title = dict.saveTitle;
      const labelEl = saveBtn.querySelector(".ryp-label");
      if (labelEl) labelEl.textContent = dict.save;
    }

    setActive(
      document.getElementById("ryp-btn-playlists"),
      panelOn,
      dict.myLists, dict.myLists,
      dict.myListsOnTitle, dict.myListsTitle
    );
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents(reverseBtn, shuffleBtn, reorderBtn, resetBtn, saveBtn, playlistsBtn) {
    reverseBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      const { reverseOn } = Playback.getState();
      if (reverseOn) {
        await Playback.disableReverse(listId);
      } else {
        await Playback.enableReverse(listId);
      }
      Sidebar.applyVisualOrder();
      Sidebar.scrollToCurrentItem();
      syncButtonStates();
    });

    shuffleBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      const { shuffleOn } = Playback.getState();
      if (shuffleOn) {
        await Playback.disableShuffle(listId);
      } else {
        await Playback.enableShuffle(listId);
      }
      Sidebar.applyVisualOrder();
      Sidebar.scrollToCurrentItem();
      syncButtonStates();
    });

    reorderBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      Sidebar.toggleReorderMode();
      syncButtonStates();
    });

    resetBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      await Playback.disableAll(listId);
      if (Sidebar.isReorderModeOn()) {
        Sidebar.toggleReorderMode();
      }
      Sidebar.applyVisualOrder();
      Sidebar.scrollToCurrentItem();
      syncButtonStates();
    });

    saveBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const listId = Playlist.getPlaylistId();
      if (!listId) return;

      const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

      Panel.showSaveModal({
        title: dict.saveModalTitle,
        placeholder: dict.saveModalPlaceholder,
        tagsPlaceholder: dict.tagsPlaceholder,
        defaultValue: "",
        confirmLabel: dict.save,
        onConfirm: async (name, tags) => {
          try {
            const saved = (await State.get(State.keys.savedPlaylists)) || [];
            const existing = saved.filter((p) => p.sourceListId === listId);

            if (existing.length > 0) {
              Panel.showSaveOptionsModal({
                existingSnapshots: existing,
                newName: name,
                tags,
                expectedListId: listId,
                onComplete: async (isUpdate) => {
                  if (Panel.isPanelVisible()) {
                    await Panel.renderList();
                  }
                  Panel.showToast("✓ " + (isUpdate ? Panel.t("updateConfirm") : Panel.t("saveConfirm")));
                },
              });
            } else {
              await Panel.saveCurrentOrder(name, null, tags, listId);
              if (Panel.isPanelVisible()) {
                await Panel.renderList();
              }
              Panel.showToast("✓ " + Panel.t("saveConfirm"));
            }
          } catch (err) {
            Panel.showToast(err.message || "Could not save the snapshot");
          }
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
