/*
 * YouTube Playlist Tools — playlist.js
 *
 * All DOM interaction with the YouTube playlist panel lives here:
 * reading items, finding the current index, navigating to a target,
 * parsing duration/channel data, calculating playlist stats,
 * and lazy-loading all playlist items.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  // CSS selectors for YouTube's playlist elements.
  const SEL = {
    // Watch page playlist panel
    panel: "ytd-playlist-panel-renderer",
    // Our virtual-playlist rows are plain divs (see createCustomPlaylistItem).
    item: "ytd-playlist-panel-video-renderer, .ryp-custom-playlist-item",
    itemLink: "a#wc-endpoint, a.ytd-playlist-panel-video-renderer, a",
    itemsContainer: "ytd-playlist-panel-renderer #items",
    videoTitle: "#video-title",
    thumbnail: "img",
    timeStatus: "badge-shape .badge-shape-wiz__text, .badge-shape-wiz__text, ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer span, .ytd-thumbnail-overlay-time-status-renderer, span.ytd-thumbnail-overlay-time-status-renderer, #time-status, span#time-status",
    byline: "#byline, #channel-name, .ytd-channel-name, ytd-channel-name a",
    headerCandidates: [
      "ytd-playlist-panel-renderer #header-contents",
      "ytd-playlist-panel-renderer #header",
      "ytd-playlist-panel-renderer #playlist-actions",
    ],
    indexMessage: "ytd-playlist-panel-renderer #publisher-container, ytd-playlist-panel-renderer #index-message, ytd-playlist-panel-renderer .index-message-wrapper, ytd-playlist-panel-renderer #header-description",

    // Playlist overview page (/playlist?list=...)
    overviewList: "ytd-playlist-video-list-renderer, ytd-browse[page-subtype='playlist']",
    overviewItemsContainer: "ytd-playlist-video-list-renderer #contents, #contents.ytd-playlist-video-list-renderer",
    // YouTube migrated the overview list to yt-lockup-view-model; the older
    // ytd-playlist-video-renderer is kept for pages that still serve it.
    overviewItem: "ytd-playlist-video-renderer, ytd-browse[page-subtype='playlist'] yt-lockup-view-model",
    overviewHeaderCandidates: [
      "ytd-playlist-header-renderer #action-buttons",
      "ytd-playlist-header-renderer #top-level-buttons-computed",
      "ytd-playlist-header-renderer .immersive-header-content",
      "ytd-playlist-header-renderer #buttons",
      "ytd-playlist-header-renderer",
      "ytd-browse[page-subtype='playlist'] #header",
    ],
    overviewStats: "ytd-playlist-header-renderer .metadata-stats, ytd-playlist-header-renderer #stats",

    // Standalone watch page video actions
    watchActionsMenu: "#actions #menu ytd-menu-renderer, #actions-inner #menu ytd-menu-renderer, #actions #top-level-buttons-computed, #top-level-buttons-computed",
  };

  function extractDurationText(item) {
    if (!item) return "";
    const selectors = [
      ".ytBadgeShapeText",
      "badge-shape .badge-shape-wiz__text",
      ".badge-shape-wiz__text",
      "ytd-thumbnail-overlay-time-status-renderer #text",
      "ytd-thumbnail-overlay-time-status-renderer span",
      ".ytd-thumbnail-overlay-time-status-renderer",
      "span#time-status",
      "#time-status",
    ];
    for (const sel of selectors) {
      const el = item.querySelector(sel);
      const text = el?.textContent?.trim() || "";
      if (text && (text.includes(":") || /^\d+$/.test(text))) return text;
    }
    const aria = item.querySelector("a#thumbnail, a#wc-endpoint, a")?.getAttribute("aria-label") || "";
    if (aria) {
      const hMatch = aria.match(/(\d+)\s*(?:hours?|heures?|ساعات?|ساعة)/i);
      const mMatch = aria.match(/(\d+)\s*(?:minutes?|دقيقة|دقائق)/i);
      const sMatch = aria.match(/(\d+)\s*(?:seconds?|ثانية|ثواني)/i);
      if (hMatch || mMatch || sMatch) {
        const h = hMatch ? parseInt(hMatch[1], 10) : 0;
        const m = mMatch ? parseInt(mMatch[1], 10) : 0;
        const s = sMatch ? parseInt(sMatch[1], 10) : 0;
        if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        return `${m}:${String(s).padStart(2, "0")}`;
      }
    }
    return "";
  }

  /**
   * Our own playlist params live in the URL *hash*, not the query string:
   * YouTube rewrites watch URLs and drops any query param it does not
   * recognise, so `?ryp_list=…` never survives a navigation. The fragment is
   * left untouched. Accepts a URL string, or reads the current location.
   */
  function rypParams(url) {
    let hash;
    if (url === undefined) {
      hash = location.hash || "";
    } else {
      try {
        hash = new URL(url, location.origin).hash;
      } catch {
        hash = "";
      }
    }
    return new URLSearchParams(hash.replace(/^#/, ""));
  }

  /** Build the `#ryp_list=…&ryp_index=…` fragment for a virtual playlist. */
  function rypHash(snapshotId, index) {
    return `#ryp_list=${encodeURIComponent(snapshotId)}&ryp_index=${index}`;
  }

  /** Parse time strings ("03:45", "1:15:30", "45") to total seconds. */
  function parseTimeToSeconds(str) {
    if (!str || typeof str !== "string") return 0;
    const clean = str.trim().replace(/[^\d:]/g, "");
    if (!clean) return 0;
    const parts = clean.split(":").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return 0;
  }

  /** Format seconds to human-readable string ("4h 12m", "35m 10s"). */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    if (m > 0) {
      return `${m}m ${sec > 0 ? sec + "s" : ""}`.trim();
    }
    return `${sec}s`;
  }

  window.RYP.Playlist = {
    SEL,
    parseTimeToSeconds,
    formatDuration,
    rypHash,

    getPlaylistId() {
      const sp = new URLSearchParams(location.search);
      const list = sp.get("list");
      if (list) return list;
      const rypList = rypParams().get("ryp_list");
      return rypList ? `virtual:${rypList}` : null;
    },

    rypParams,

    getVirtualSnapshotId() {
      return rypParams().get("ryp_list") || null;
    },

    isVirtualPlaylist() {
      const sp = new URLSearchParams(location.search);
      return (
        !!rypParams().get("ryp_list") ||
        sp.get("list") === "custom" ||
        (sp.get("list") || "").startsWith("virtual:")
      );
    },

    isWatchPage() {
      return location.pathname === "/watch";
    },

    isPlaylistWatchPage() {
      const sp = new URLSearchParams(location.search);
      return this.isWatchPage() && (!!sp.get("list") || !!rypParams().get("ryp_list"));
    },

    isOverviewPlaylistPage() {
      return location.pathname === "/playlist" && !!this.getPlaylistId();
    },

    /** Extract total video count from YouTube header if available. */
    getTotalItemCount() {
      const listId = this.getPlaylistId();
      if (!listId) return 0;

      // Check on watch page
      if (this.isPlaylistWatchPage()) {
        const candidates = [
          "ytd-playlist-panel-renderer #publisher-container span:first-child",
          "ytd-playlist-panel-renderer .index-message-wrapper",
          "ytd-playlist-panel-renderer #index-message",
          "ytd-playlist-panel-renderer #publisher-container",
          "ytd-playlist-panel-renderer #header-description",
          "#ryp-virtual-playlist-panel #ryp-virtual-count",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          const text = el?.textContent?.trim() || "";
          if (!text) continue;

          // Match patterns like "1 / 57" or "1 of 57" or "1 sur 57" or "1 من 57"
          const fractionMatch = text.match(/(?:^|\s)(\d[\d,]*)\s*(?:\/|\bof\b|\bsur\b|\bde\b|من)\s*(\d[\d,]*)(?:\s|[•·\-\/,\.]|$)/i);
          if (fractionMatch) {
            const num = parseInt(fractionMatch[2].replace(/,/g, ""), 10);
            if (Number.isFinite(num) && num > 0) return num;
          }
          const singleMatch = text.match(/(\d[\d,]*)\s*(?:videos|vidéos|فيديو)/i);
          if (singleMatch) {
            const num = parseInt(singleMatch[1].replace(/,/g, ""), 10);
            if (Number.isFinite(num) && num > 0) return num;
          }
        }
      }

      // Check on overview page
      if (this.isOverviewPlaylistPage()) {
        const statsEl = document.querySelector(SEL.overviewStats);
        const text = statsEl?.textContent?.trim() || "";
        const match = text.match(/(\d[\d,]*)\s*(?:videos|vidéos|فيديو)/i) || text.match(/(\d[\d,]*)/);
        if (match) {
          const num = parseInt(match[1].replace(/,/g, ""), 10);
          if (Number.isFinite(num) && num > 0) return num;
        }
      }

      const loaded = this.readItems().length || this.readOverviewItems().length;
      return loaded;
    },

    /** Returns all loaded watch-sidebar items sorted by index (ascending). */
    readItems() {
      // YouTube's SPA can leave a stale real panel in the DOM, so on a virtual
      // playlist our own panel wins.
      const real = document.querySelector(SEL.panel);
      const virtual = document.getElementById("ryp-virtual-playlist-panel");
      const panel = this.isVirtualPlaylist() ? (virtual || real) : (real || virtual);
      if (!panel) return [];
      const out = [];
      for (const item of panel.querySelectorAll(SEL.item)) {
        const anchor = item.querySelector(SEL.itemLink);
        const href = anchor && anchor.getAttribute("href");
        if (!href) continue;
        const params = new URL(href, location.origin).searchParams;
        // Virtual items carry their position in the href's hash (see rypParams).
        const index = parseInt(
          rypParams(href).get("ryp_index") || params.get("index") || item.dataset.index || "",
          10
        );
        if (!Number.isFinite(index)) continue;

        const durationText = extractDurationText(item);
        const channelText = item.querySelector(SEL.byline)?.textContent?.trim() || "";
        const titleText = item.querySelector(SEL.videoTitle)?.textContent?.trim() || "";

        out.push({
          index,
          videoId: params.get("v") || item.dataset.videoId || "",
          title: titleText,
          channel: channelText,
          durationStr: durationText,
          durationSeconds: parseTimeToSeconds(durationText),
          thumbnail: item.querySelector(SEL.thumbnail)?.src || "",
          anchor,
          element: item,
        });
      }
      out.sort((a, b) => a.index - b.index);
      return out;
    },

    /** Returns all loaded items from the /playlist?list=... overview page. */
    readOverviewItems() {
      const out = [];
      const items = document.querySelectorAll(SEL.overviewItem);
      const listId = new URLSearchParams(location.search).get("list");
      let idx = 1;
      for (const item of items) {
        const anchor = item.querySelector(
          "a#video-title, a#thumbnail, a[class*='ytLockupMetadataViewModelTitle'], a[href*='/watch?v='], a"
        );
        const href = anchor && anchor.getAttribute("href");
        if (!href) continue;
        const params = new URL(href, location.origin).searchParams;
        const videoId = params.get("v") || "";
        if (!videoId) continue;

        // Scrolling to the bottom of a playlist page loads recommendation
        // shelves built from the same element type. Every genuine item of this
        // playlist links back to it, so the list param is the reliable filter —
        // counting the recommendations inflates the item count and sends
        // "Play Reverse" to an index YouTube rejects.
        if (listId && params.get("list") !== listId) continue;

        const indexParam = parseInt(params.get("index") || "", 10);
        const index = Number.isFinite(indexParam) && indexParam > 0 ? indexParam : idx;
        idx++;

        const durationText = extractDurationText(item);
        const channelText =
          item.querySelector(SEL.byline)?.textContent?.trim() ||
          item.querySelector("[class*='ytContentMetadataViewModelMetadataRow'] span")?.textContent?.trim() ||
          "";
        const titleText =
          item.querySelector("#video-title")?.textContent?.trim() ||
          item.querySelector("a[class*='ytLockupMetadataViewModelTitle'], h3")?.textContent?.trim() ||
          "";

        out.push({
          index,
          videoId,
          title: titleText,
          channel: channelText,
          durationStr: durationText,
          durationSeconds: parseTimeToSeconds(durationText),
          thumbnail: item.querySelector("img")?.src || "",
          anchor,
          element: item,
        });
      }
      return out;
    },

    /** Get active items depending on watch page or overview page. */
    getAllCurrentItems() {
      if (this.isPlaylistWatchPage()) return this.readItems();
      if (this.isOverviewPlaylistPage()) return this.readOverviewItems();
      return [];
    },

    /** Calculate duration statistics with speed multipliers. */
    calculateDurationStats(items = null, watchedList = []) {
      const videoItems = items || this.getAllCurrentItems();
      let totalSeconds = 0;
      let watchedSeconds = 0;

      const watchedSet = new Set(watchedList);

      for (const it of videoItems) {
        const sec = it.durationSeconds || 0;
        totalSeconds += sec;
        if (watchedSet.has(it.videoId) || watchedSet.has(it.index)) {
          watchedSeconds += sec;
        }
      }

      const remainingSeconds = Math.max(0, totalSeconds - watchedSeconds);

      return {
        itemCount: videoItems.length,
        totalSeconds,
        watchedSeconds,
        remainingSeconds,
        totalFormatted: formatDuration(totalSeconds),
        watchedFormatted: formatDuration(watchedSeconds),
        remainingFormatted: formatDuration(remainingSeconds),
        speeds: {
          "1.0x": formatDuration(remainingSeconds),
          "1.25x": formatDuration(remainingSeconds / 1.25),
          "1.5x": formatDuration(remainingSeconds / 1.5),
          "1.75x": formatDuration(remainingSeconds / 1.75),
          "2.0x": formatDuration(remainingSeconds / 2.0),
        },
      };
    },

    /** Current 1-based playlist index from URL param, or from the selected item. */
    currentIndex() {
      const sp = new URLSearchParams(location.search);
      const fromUrl = parseInt(
        rypParams().get("ryp_index") || sp.get("index") || "",
        10
      );
      if (Number.isFinite(fromUrl)) return fromUrl;
      const real = document.querySelector(SEL.panel);
      const virtual = document.getElementById("ryp-virtual-playlist-panel");
      const panel = this.isVirtualPlaylist() ? (virtual || real) : (real || virtual);
      if (panel) {
        const items = Array.from(panel.querySelectorAll(SEL.item));
        const selectedPos = items.findIndex((it) =>
          it.hasAttribute("selected") || it.classList.contains("selected")
        );
        if (selectedPos >= 0) return selectedPos + 1;
      }
      return null;
    },

    /** In-app navigate to the playlist item with the given index. */
    goToIndex(targetIndex) {
      const hit = this.readItems().find((it) => it.index === targetIndex);
      if (!hit || !hit.anchor) return false;
      if (typeof hit.anchor.click === "function") {
        hit.anchor.click();
        return true;
      }
      if (hit.anchor.href) {
        window.location.href = hit.anchor.href;
        return true;
      }
      return false;
    },

    getItemsContainer() {
      const real = document.querySelector(SEL.itemsContainer);
      const virtual = document.querySelector("#ryp-virtual-playlist-panel #items");
      return this.isVirtualPlaylist() ? (virtual || real) : (real || virtual);
    },

    findHeaderContainer() {
      const virtualHeader = document.querySelector("#ryp-virtual-playlist-panel #header-contents");
      if (virtualHeader) return virtualHeader;
      for (const sel of SEL.headerCandidates) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return document.querySelector(SEL.panel);
    },

    findOverviewHeaderContainer() {
      for (const sel of SEL.overviewHeaderCandidates) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    },

    /**
     * Programmatically auto-scrolls the playlist items container until all items
     * are loaded or until no new items appear.
     * Calls onProgress(loadedCount, totalCount) as items are loaded.
     */
    async loadAllItems(onProgress) {
      const isOverview = this.isOverviewPlaylistPage();
      const scroller = isOverview
        ? document.documentElement || document.body
        : (() => {
            const container = this.getItemsContainer();
            if (!container) return null;
            for (let node = container; node; node = node.parentElement) {
              if (node.scrollHeight > node.clientHeight + 1) {
                const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(node) : null;
                const ov = style?.overflowY;
                if (ov === "auto" || ov === "scroll") return node;
              }
              if (node === document.body) break;
            }
            return container;
          })();

      if (!scroller) return { loaded: 0, completed: false };

      const totalExpected = this.getTotalItemCount();
      let prevCount = isOverview ? this.readOverviewItems().length : this.readItems().length;
      let stagnantPasses = 0;

      onProgress?.(prevCount, totalExpected);

      // Stop only after several quiet passes: YouTube can stall for a beat on
      // the last batch, and giving up early leaves the caller with a partial
      // list it cannot distinguish from a complete one.
      while (stagnantPasses < 8) {
        // Scroll to the bottom
        if (isOverview) {
          window.scrollTo(0, document.documentElement.scrollHeight);
        } else {
          scroller.scrollTop = scroller.scrollHeight;
        }

        // Wait for YouTube lazy render
        await new Promise((r) => setTimeout(r, 380));

        const currentCount = isOverview ? this.readOverviewItems().length : this.readItems().length;
        onProgress?.(currentCount, totalExpected);

        if (totalExpected > 0 && currentCount >= totalExpected) {
          return { loaded: currentCount, completed: true };
        }

        if (currentCount === prevCount) {
          stagnantPasses++;
        } else {
          stagnantPasses = 0;
          prevCount = currentCount;
        }
      }

      const finalCount = isOverview ? this.readOverviewItems().length : this.readItems().length;
      return { loaded: finalCount, completed: true };
    },
  };
})();
