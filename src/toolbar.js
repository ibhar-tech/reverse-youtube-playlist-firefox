/*
 * YouTube Playlist Tools — toolbar.js
 *
 * Injects and manages the playlist toolbar on watch pages and overview pages:
 *   [Reverse] [Shuffle] [Sort ▾] [Reorder] [Reset] [Save] [My Lists]
 *   [⚡ Load All] [⏱️ Duration Pill]
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
  const OVERVIEW_TOOLBAR_ID = "ryp-overview-toolbar";
  const api = typeof browser !== "undefined" ? browser : chrome;

  let activeLang = "en";

  // ── Translations Dictionary ────────────────────────────────────────────────

  const TRANSLATIONS = {
    en: {
      reverse: "Reverse",
      reverseOn: "Reverse: ON",
      shuffle: "Shuffle",
      shuffleOn: "Shuffle: ON",
      sort: "Sort",
      sortTitle: "Smart sorting presets",
      sortTitleAZ: "Title: A → Z",
      sortTitleZA: "Title: Z → A",
      sortDurationShort: "Duration: Shortest first",
      sortDurationLong: "Duration: Longest first",
      sortChannelAZ: "Channel: A → Z",
      sortUnwatchedFirst: "Unwatched first",
      sortWatchedFirst: "Watched first",
      reorder: "Reorder",
      reorderOn: "Reorder: ON",
      save: "Save",
      myLists: "My Lists",
      reverseTitle: "Play playlist in reverse — last video first",
      reverseOnTitle: "Reverse is ON — playing last to first (click to turn off)",
      shuffleTitle: "Play playlist in a random order",
      shuffleOnTitle: "Shuffle is ON — random order (click to turn off)",
      reorderTitle: "Drag sidebar items or click ⤒/⤓ to set custom play order",
      reorderOnTitle: "Reorder ON — drag or click ⤒/⤓ (click to exit)",
      saveTitle: "Save the current playlist order as a local snapshot",
      myListsTitle: "Open saved playlist snapshots",
      myListsOnTitle: "Close saved snapshots panel",
      saveModalTitle: "Save Playlist Snapshot",
      saveModalPlaceholder: "e.g. My Custom Sort",
      tagsPlaceholder: "Tags (comma separated)",
      reset: "Reset",
      resetTitle: "Restore original playlist play order",
      reorderActive: "Custom Order",
      reorderActiveTitle: "Custom play order is active (click to modify)",
      loadAll: "Load All",
      loadingProgress: "Loading {count}/{total}...",
      loadAllTitle: "Load all playlist videos to enable complete sorting and reverse",
      durationTotal: "Total: {total}",
      durationRemaining: "{remaining} left",
      durationTooltipTitle: "Playlist Watch Time",
      durationWatched: "Watched: {watched}",
      speedsHeader: "Playback Speeds:",
      playReverse: "Play Reverse",
      playShuffle: "Play Shuffle",
      saveOverviewSnapshot: "Save Snapshot",
    },
    fr: {
      reverse: "Inverser",
      reverseOn: "Inverse : ON",
      shuffle: "Mélanger",
      shuffleOn: "Mélange : ON",
      sort: "Trier",
      sortTitle: "Options de tri intelligent",
      sortTitleAZ: "Titre : A → Z",
      sortTitleZA: "Titre : Z → A",
      sortDurationShort: "Durée : Plus courtes d'abord",
      sortDurationLong: "Durée : Plus longues d'abord",
      sortChannelAZ: "Chaîne : A → Z",
      sortUnwatchedFirst: "Non vues en premier",
      sortWatchedFirst: "Vues en premier",
      reorder: "Réorganiser",
      reorderOn: "Réorgan. : ON",
      save: "Enregistrer",
      myLists: "Mes Listes",
      reverseTitle: "Lire la playlist à l'envers — dernière vidéo en premier",
      reverseOnTitle: "Inverse est ACTIF — lecture de fin à début (cliquez pour désactiver)",
      shuffleTitle: "Lire la playlist dans un ordre aléatoire",
      shuffleOnTitle: "Mélange est ACTIF — ordre aléatoire (cliquez pour désactiver)",
      reorderTitle: "Faites glisser les éléments ou cliquez sur ⤒/⤓",
      reorderOnTitle: "Réorganisation ACTIVE (cliquez pour quitter)",
      saveTitle: "Enregistrer l'ordre actuel comme instantané local",
      myListsTitle: "Ouvrir les instantanés de playlist sauvegardés",
      myListsOnTitle: "Fermer le panneau des instantanés",
      saveModalTitle: "Enregistrer un instantané",
      saveModalPlaceholder: "ex: Cours inversé",
      tagsPlaceholder: "Tags (séparés par des virgules)",
      reset: "Réinitialiser",
      resetTitle: "Restaurer l'ordre de lecture original",
      reorderActive: "Ordre Perso",
      reorderActiveTitle: "L'ordre personnalisé est actif (cliquez pour modifier)",
      loadAll: "Tout charger",
      loadingProgress: "Chargement {count}/{total}...",
      loadAllTitle: "Charger toutes les vidéos pour un tri complet",
      durationTotal: "Total : {total}",
      durationRemaining: "{remaining} restants",
      durationTooltipTitle: "Temps de lecture de la playlist",
      durationWatched: "Vues : {watched}",
      speedsHeader: "Vitesses de lecture :",
      playReverse: "Lire à l'envers",
      playShuffle: "Lire en aléatoire",
      saveOverviewSnapshot: "Enregistrer",
    },
    ar: {
      reverse: "عكس",
      reverseOn: "عكس: مفعل",
      shuffle: "خلط عشوائي",
      shuffleOn: "خلط: مفعل",
      sort: "ترتيب",
      sortTitle: "خيارات الترتيب الذكي",
      sortTitleAZ: "العنوان: أ ← ي",
      sortTitleZA: "العنوان: ي ← أ",
      sortDurationShort: "المدة: الأقصر أولاً",
      sortDurationLong: "المدة: الأطول أولاً",
      sortChannelAZ: "القناة: أ ← ي",
      sortUnwatchedFirst: "غير المشاهدة أولاً",
      sortWatchedFirst: "المشاهدة أولاً",
      reorder: "ترتيب يدوي",
      reorderOn: "ترتيب: مفعل",
      save: "حفظ",
      myLists: "قوائمي",
      reverseTitle: "تشغيل قائمة التشغيل بالعكس — الفيديو الأخير أولاً",
      reverseOnTitle: "العكس مفعل — التشغيل من الآخر للأول (انقر للإلغاء)",
      shuffleTitle: "تشغيل قائمة التشغيل بترتيب عشوائي",
      shuffleOnTitle: "الخلط العشوائي مفعل — ترتيب عشوائي (انقر للإلغاء)",
      reorderTitle: "اسحب عناصر الشريط الجانبي أو انقر ⤒/⤓ للترتيب",
      reorderOnTitle: "الترتيب اليدوي مفعل (انقر للخروج)",
      saveTitle: "حفظ الترتيب الحالي كلقطة محلية",
      myListsTitle: "فتح لقطات قوائم التشغيل المحفوظة",
      myListsOnTitle: "إغلاق لوحة القوائم المحفوظة",
      saveModalTitle: "حفظ لقطة قائمة التشغيل",
      saveModalPlaceholder: "مثال: ترتيب عكسي",
      tagsPlaceholder: "وسوم (مفصولة بفواصل)",
      reset: "إعادة تعيين",
      resetTitle: "استعادة ترتيب التشغيل الأصلي لقائمة التشغيل",
      reorderActive: "ترتيب مخصص",
      reorderActiveTitle: "ترتيب التشغيل المخصص مفعل (انقر للتعديل)",
      loadAll: "تحميل الكل",
      loadingProgress: "جاري التحميل {count}/{total}...",
      loadAllTitle: "تحميل كافة مقاطع الفيديو لترتيب وعكس كامل",
      durationTotal: "الإجمالي: {total}",
      durationRemaining: "متبقي {remaining}",
      durationTooltipTitle: "مدة مشاهدة قائمة التشغيل",
      durationWatched: "تمت مشاهدته: {watched}",
      speedsHeader: "سرعات التشغيل:",
      playReverse: "تشغيل بالعكس",
      playShuffle: "تشغيل عشوائي",
      saveOverviewSnapshot: "حفظ كلقطة",
    }
  };

  function applyToolbarSettings(settings) {
    activeLang = settings?.lang || "en";
    syncButtonStates();
    updateDurationStats();
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
    sort: () => svg("0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "7 4 7 20" } },
      { tag: "polyline", attrs: { points: "3 8 7 4 11 8" } },
      { tag: "polyline", attrs: { points: "17 20 17 4" } },
      { tag: "polyline", attrs: { points: "13 16 17 20 21 16" } }
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
    ]),
    clock: () => svg("0 0 24 24", 2, [
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
      { tag: "polyline", attrs: { points: "12 6 12 12 16 14" } }
    ]),
    lightning: () => svg("0 0 24 24", 2, [
      { tag: "polygon", attrs: { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" } }
    ]),
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

  // ── Sort Dropdown Menu ────────────────────────────────────────────────────

  function createSortDropdown(dict) {
    const wrapper = document.createElement("div");
    wrapper.className = "ryp-dropdown-wrapper";

    const sortBtn = makeButton("ryp-btn-sort", "sort", dict.sort, dict.sortTitle);
    const chevron = document.createElement("span");
    chevron.className = "ryp-chevron";
    chevron.textContent = " ▾";
    sortBtn.appendChild(chevron);

    const menu = document.createElement("div");
    menu.id = "ryp-sort-menu";
    menu.className = "ryp-dropdown-menu";
    menu.setAttribute("role", "menu");

    const options = [
      { key: "az", label: dict.sortTitleAZ, action: () => Playback.sortByTitle(Playlist.getPlaylistId(), true) },
      { key: "za", label: dict.sortTitleZA, action: () => Playback.sortByTitle(Playlist.getPlaylistId(), false) },
      { key: "short", label: dict.sortDurationShort, action: () => Playback.sortByDuration(Playlist.getPlaylistId(), true) },
      { key: "long", label: dict.sortDurationLong, action: () => Playback.sortByDuration(Playlist.getPlaylistId(), false) },
      { key: "channel", label: dict.sortChannelAZ, action: () => Playback.sortByChannel(Playlist.getPlaylistId(), true) },
      { key: "unwatched", label: dict.sortUnwatchedFirst, action: () => Playback.sortByWatched(Playlist.getPlaylistId(), true) },
      { key: "watched", label: dict.sortWatchedFirst, action: () => Playback.sortByWatched(Playlist.getPlaylistId(), false) },
    ];

    for (const opt of options) {
      const item = document.createElement("button");
      item.className = "ryp-dropdown-item";
      item.type = "button";
      item.textContent = opt.label;
      item.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSortDropdown();
        await opt.action();
        Sidebar.applyVisualOrder();
        Sidebar.scrollToCurrentItem();
        syncButtonStates();
      });
      menu.appendChild(item);
    }

    sortBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSortDropdown();
    });

    wrapper.append(sortBtn, menu);
    return wrapper;
  }

  // State lives on the menu element, not in a variable: the toolbar is
  // re-injected on every SPA navigation, which would desync a module flag.
  function toggleSortDropdown(forceState) {
    const menu = document.getElementById("ryp-sort-menu");
    if (!menu) return;
    const open = forceState !== undefined ? forceState : !menu.classList.contains("ryp-menu-show");
    menu.classList.toggle("ryp-menu-show", open);
  }

  function closeSortDropdown() {
    toggleSortDropdown(false);
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".ryp-dropdown-wrapper")) closeSortDropdown();
  });

  // ── Duration Stats Pill ───────────────────────────────────────────────────

  // Rebuilding the pill on every settled mutation pass is both wasteful and
  // visible — it tears down the tooltip while the pointer is inside it. Skip
  // the rebuild whenever the numbers have not moved.
  let lastStatsKey = "";

  async function updateDurationStats() {
    const durationPill = document.getElementById("ryp-duration-pill");
    const overviewPill = document.getElementById("ryp-overview-duration-pill");
    if (!durationPill && !overviewPill) {
      lastStatsKey = "";
      return;
    }

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const listId = Playlist.getPlaylistId();
    const watched = listId ? await Playback.getWatched(listId) : [];
    const stats = Playlist.calculateDurationStats(null, watched);

    const statsKey = [
      activeLang, stats.itemCount, stats.totalSeconds, stats.watchedSeconds,
      durationPill?.childElementCount || 0, overviewPill?.childElementCount || 0,
    ].join("|");
    if (statsKey === lastStatsKey) return;
    lastStatsKey = statsKey;

    const formatPillHtml = (targetPill) => {
      if (!targetPill) return;
      targetPill.replaceChildren();

      const iconSpan = document.createElement("span");
      iconSpan.className = "ryp-icon";
      iconSpan.appendChild(ICONS.clock());

      const textSpan = document.createElement("span");
      textSpan.className = "ryp-duration-text";
      textSpan.textContent = `${stats.totalFormatted} (${stats.remainingFormatted})`;

      // Hover Tooltip Card
      const tooltip = document.createElement("div");
      tooltip.className = "ryp-duration-tooltip";

      const title = document.createElement("div");
      title.className = "ryp-tooltip-title";
      title.textContent = dict.durationTooltipTitle;

      const totalRow = document.createElement("div");
      totalRow.className = "ryp-tooltip-row";
      totalRow.textContent = dict.durationTotal.replace("{total}", stats.totalFormatted);

      const watchedRow = document.createElement("div");
      watchedRow.className = "ryp-tooltip-row";
      watchedRow.textContent = dict.durationWatched.replace("{watched}", stats.watchedFormatted);

      const remRow = document.createElement("div");
      remRow.className = "ryp-tooltip-row ryp-tooltip-highlight";
      remRow.textContent = dict.durationRemaining.replace("{remaining}", stats.remainingFormatted);

      const speedsDiv = document.createElement("div");
      speedsDiv.className = "ryp-tooltip-speeds";

      const speedsLabel = document.createElement("div");
      speedsLabel.className = "ryp-speeds-label";
      speedsLabel.textContent = dict.speedsHeader;

      const speedGrid = document.createElement("div");
      speedGrid.className = "ryp-speed-grid";

      for (const [spd, val] of Object.entries(stats.speeds)) {
        const item = document.createElement("span");
        item.textContent = `${spd}: ${val}`;
        speedGrid.appendChild(item);
      }

      speedsDiv.append(speedsLabel, speedGrid);
      tooltip.append(title, totalRow, watchedRow, remRow, speedsDiv);

      targetPill.append(iconSpan, textSpan, tooltip);
    };

    formatPillHtml(durationPill);
    formatPillHtml(overviewPill);
  }

  // ── Lazy Load Pill ────────────────────────────────────────────────────────

  /**
   * Resolve YouTube's lazy loading before any action that needs the whole
   * playlist (reverse / shuffle / save read only what is rendered).
   * Shows progress on the button that triggered it.
   */
  async function ensureAllItemsLoaded(btn) {
    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;
    const label = btn?.querySelector(".ryp-label");
    const original = label?.textContent;
    if (btn) btn.disabled = true;
    try {
      await Playlist.loadAllItems((cur, tot) => {
        if (label) {
          label.textContent = dict.loadingProgress
            .replace("{count}", String(cur))
            .replace("{total}", String(tot || cur));
        }
      });
    } finally {
      if (btn) btn.disabled = false;
      if (label && original !== undefined) label.textContent = original;
    }
  }

  /**
   * Name → (update existing | save new) → snapshot. Shared by the watch
   * toolbar and the overview toolbar; Panel.saveCurrentOrder reads whichever
   * item list the current page has.
   */
  function openSaveFlow() {
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
                if (Panel.isPanelVisible()) await Panel.renderList();
                Panel.showToast("✓ " + (isUpdate ? Panel.t("updateConfirm") : Panel.t("saveConfirm")));
              },
            });
          } else {
            await Panel.saveCurrentOrder(name, null, tags, listId);
            if (Panel.isPanelVisible()) await Panel.renderList();
            Panel.showToast("✓ " + Panel.t("saveConfirm"));
          }
        } catch (err) {
          Panel.showToast(err.message || "Could not save the snapshot");
        }
      },
    });
  }

  function checkLazyLoadState(toolbar) {
    const total = Playlist.getTotalItemCount();
    const loaded = Playlist.readItems().length || Playlist.readOverviewItems().length;
    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    let loadPill = toolbar.querySelector(".ryp-load-all-pill");

    // Nothing left to resolve — the pill has no job on a fully loaded playlist.
    if (total > 0 && loaded >= total) {
      if (loadPill && !loadPill.disabled) loadPill.remove();
      return;
    }

    if (!loadPill) {
      loadPill = document.createElement("button");
      loadPill.className = "ryp-btn ryp-load-all-pill";
      loadPill.type = "button";
      loadPill.title = dict.loadAllTitle;

      const iconSpan = document.createElement("span");
      iconSpan.className = "ryp-icon";
      iconSpan.appendChild(ICONS.lightning());

      const textSpan = document.createElement("span");
      textSpan.className = "ryp-label";

      loadPill.append(iconSpan, textSpan);
      toolbar.appendChild(loadPill);

      loadPill.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await ensureAllItemsLoaded(loadPill);
        const finalCount = Playlist.readItems().length || Playlist.readOverviewItems().length;
        loadPill.querySelector(".ryp-label").textContent = `${finalCount}/${finalCount} · ${dict.loadAll}`;
        updateDurationStats();
        Sidebar.applyWatchedBadges();
        Sidebar.applyVisualOrder();
        Panel.showToast("✓ " + (dict.loadAll + ": Complete"));
      });
    }

    if (!loadPill.disabled) {
      const label = loadPill.querySelector(".ryp-label");
      if (label) label.textContent = `${loaded}/${total || loaded} · ${dict.loadAll}`;
    }
  }

  // ── Toolbar injection on Watch Page ───────────────────────────────────────

  function injectToolbar() {
    const container = Playlist.findHeaderContainer();
    if (!container) return false;

    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) {
      if (existing.parentElement === container) {
        checkLazyLoadState(existing);
        updateDurationStats();
        return true;
      }
      existing.remove();
    }

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Playlist Tools");
    toolbar.dir = activeLang === "ar" ? "rtl" : "ltr";

    const reverseBtn = makeButton("ryp-btn-reverse", "reverse", dict.reverse, dict.reverseTitle);
    const shuffleBtn = makeButton("ryp-btn-shuffle", "shuffle", dict.shuffle, dict.shuffleTitle);
    const sortDropdown = createSortDropdown(dict);
    const reorderBtn = makeButton("ryp-btn-reorder", "reorder", dict.reorder, dict.reorderTitle);
    const resetBtn = makeButton("ryp-btn-reset", "reset", dict.reset, dict.resetTitle);
    const saveBtn = makeButton("ryp-btn-save", "save", dict.save, dict.saveTitle);
    const playlistsBtn = makeButton("ryp-btn-playlists", "playlists", dict.myLists, dict.myListsTitle);

    const durationPill = document.createElement("div");
    durationPill.id = "ryp-duration-pill";
    durationPill.className = "ryp-duration-pill";

    toolbar.append(reverseBtn, shuffleBtn, sortDropdown, reorderBtn, resetBtn, saveBtn, playlistsBtn, durationPill);
    container.appendChild(toolbar);

    checkLazyLoadState(toolbar);
    syncButtonStates();
    updateDurationStats();
    bindEvents(reverseBtn, shuffleBtn, reorderBtn, resetBtn, saveBtn, playlistsBtn);
    return true;
  }

  // ── Overview Page Toolbar Injection (/playlist?list=...) ─────────────────

  function injectOverviewToolbar() {
    if (!Playlist.isOverviewPlaylistPage()) return false;
    const container = Playlist.findOverviewHeaderContainer();
    if (!container) return false;

    const existing = document.getElementById(OVERVIEW_TOOLBAR_ID);
    if (existing) {
      if (existing.parentElement === container) {
        checkLazyLoadState(existing);
        updateDurationStats();
        return true;
      }
      existing.remove();
    }

    const dict = TRANSLATIONS[activeLang] || TRANSLATIONS.en;

    const toolbar = document.createElement("div");
    toolbar.id = OVERVIEW_TOOLBAR_ID;
    toolbar.className = "ryp-overview-bar";
    toolbar.dir = activeLang === "ar" ? "rtl" : "ltr";

    const playReverseBtn = makeButton("ryp-ov-reverse", "reverse", dict.playReverse, dict.reverseTitle);
    const playShuffleBtn = makeButton("ryp-ov-shuffle", "shuffle", dict.playShuffle, dict.shuffleTitle);
    const saveBtn = makeButton("ryp-ov-save", "save", dict.saveOverviewSnapshot, dict.saveTitle);

    const durationPill = document.createElement("div");
    durationPill.id = "ryp-overview-duration-pill";
    durationPill.className = "ryp-duration-pill";

    toolbar.append(playReverseBtn, playShuffleBtn, saveBtn, durationPill);
    container.prepend(toolbar);

    checkLazyLoadState(toolbar);
    updateDurationStats();

    playReverseBtn.addEventListener("click", async () => {
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      await ensureAllItemsLoaded(playReverseBtn);
      const items = Playlist.readOverviewItems();
      if (items.length === 0) return;
      const lastVideo = items[items.length - 1].videoId;
      await State.set(State.keys.reverse(listId), true);
      await State.set(State.keys.shuffle(listId), false);
      // No &index=: overview links carry no playlist position, so ours is
      // positional and one unrendered row would make it wrong — and YouTube
      // silently resets to position 1 when the index doesn't match. Given
      // v + list it resolves the correct position itself.
      location.href = `https://www.youtube.com/watch?v=${lastVideo}&list=${listId}`;
    });

    playShuffleBtn.addEventListener("click", async () => {
      const listId = Playlist.getPlaylistId();
      if (!listId) return;
      await ensureAllItemsLoaded(playShuffleBtn);
      const items = Playlist.readOverviewItems();
      if (items.length === 0) return;
      const indices = items.map((it) => it.index);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      await State.set(State.keys.reverse(listId), false);
      await State.set(State.keys.shuffle(listId), true);
      await State.set(State.keys.customOrder(listId), indices);
      const firstVideo = items.find((it) => it.index === indices[0]);
      location.href = `https://www.youtube.com/watch?v=${firstVideo?.videoId || ""}&list=${listId}`;
    });

    saveBtn.addEventListener("click", async () => {
      if (!Playlist.getPlaylistId()) return;
      await ensureAllItemsLoaded(saveBtn);
      openSaveFlow();
    });

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

    const resetBtn = document.getElementById("ryp-btn-reset");
    if (resetBtn) {
      const isModified = Playback.isActive();
      resetBtn.classList.toggle("ryp-visible", isModified);
      resetBtn.title = dict.resetTitle;
      const labelEl = resetBtn.querySelector(".ryp-label");
      if (labelEl) labelEl.textContent = dict.reset;
    }

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
      openSaveFlow();
    });

    playlistsBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      Panel.togglePanel();
      syncButtonStates();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Toolbar = {
    injectToolbar,
    injectOverviewToolbar,
    syncButtonStates,
    updateDurationStats,
  };
})();
