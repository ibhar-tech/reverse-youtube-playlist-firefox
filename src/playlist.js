/*
 * YouTube Playlist Tools — playlist.js
 *
 * All DOM interaction with the YouTube playlist panel lives here:
 * reading items, finding the current index, and navigating to a target.
 * Other modules never touch the DOM directly for these concerns.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  // CSS selectors for YouTube's playlist panel elements.
  // When YouTube changes their DOM, this is the only file to update.
  const SEL = {
    panel: "ytd-playlist-panel-renderer",
    item: "ytd-playlist-panel-video-renderer",
    itemLink: "a#wc-endpoint, a",
    itemsContainer: "ytd-playlist-panel-renderer #items",
    videoTitle: "#video-title",
    thumbnail: "img",
    headerCandidates: [
      "ytd-playlist-panel-renderer #header-contents",
      "ytd-playlist-panel-renderer #header",
      "ytd-playlist-panel-renderer #playlist-actions",
    ],
  };

  window.RYP.Playlist = {
    SEL,

    getPlaylistId() {
      return new URLSearchParams(location.search).get("list");
    },

    isPlaylistWatchPage() {
      return location.pathname === "/watch" && !!this.getPlaylistId();
    },

    /** Returns all loaded sidebar items sorted by index (ascending). */
    readItems() {
      const panel = document.querySelector(SEL.panel);
      if (!panel) return [];
      const out = [];
      for (const item of panel.querySelectorAll(SEL.item)) {
        const anchor = item.querySelector(SEL.itemLink);
        const href = anchor && anchor.getAttribute("href");
        if (!href) continue;
        const params = new URL(href, location.origin).searchParams;
        const index = parseInt(params.get("index") || "", 10);
        if (!Number.isFinite(index)) continue;
        out.push({
          index,
          videoId: params.get("v") || "",
          title: item.querySelector(SEL.videoTitle)?.textContent?.trim() || "",
          thumbnail: item.querySelector(SEL.thumbnail)?.src || "",
          anchor,
          element: item,
        });
      }
      out.sort((a, b) => a.index - b.index);
      return out;
    },

    /** Current 1-based playlist index from URL param, or from the selected item. */
    currentIndex() {
      const fromUrl = parseInt(
        new URLSearchParams(location.search).get("index") || "",
        10
      );
      if (Number.isFinite(fromUrl)) return fromUrl;
      const panel = document.querySelector(SEL.panel);
      if (panel) {
        const items = Array.from(panel.querySelectorAll(SEL.item));
        const selectedPos = items.findIndex((it) =>
          it.hasAttribute("selected")
        );
        if (selectedPos >= 0) return selectedPos + 1;
      }
      return null;
    },

    /** In-app navigate to the playlist item with the given index. */
    goToIndex(targetIndex) {
      const hit = this.readItems().find((it) => it.index === targetIndex);
      if (!hit) return false;
      hit.anchor.click();
      return true;
    },

    findHeaderContainer() {
      for (const sel of SEL.headerCandidates) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return document.querySelector(SEL.panel);
    },

    getItemsContainer() {
      return document.querySelector(SEL.itemsContainer);
    },
  };
})();
