/*
 * YouTube Playlist Tools — sidebar.js
 *
 * Handles all visual-order concerns for the playlist sidebar:
 *   - Applying CSS column-reverse for reverse mode
 *   - Applying CSS `order` property for custom/shuffle order
 *   - Drag-and-drop reorder mode (makes sidebar items draggable)
 *   - Quick "Send to Top" / "Send to Bottom" reordering helpers
 *
 * Drag-and-drop derives a new order from the currently visible sequence and
 * persists it through Playback.applyCustomOrder(). CSS ordering keeps the
 * result visible after YouTube re-renders the panel.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { Playlist, Playback, State } = window.RYP;

  const REVERSED_CLASS = "ryp-reversed";
  let reorderModeOn = false;
  let dragSrcElement = null;
  let visualStateApplied = false;

  function createCustomPlaylistItem(video, listId) {
    const item = document.createElement("ytd-playlist-panel-video-renderer");
    item.className = "style-scope ytd-playlist-panel-renderer ryp-custom-playlist-item";
    item.dataset.index = String(video.index);
    item.dataset.videoId = video.videoId;

    const isCurrent = new URLSearchParams(location.search).get("v") === video.videoId;
    if (isCurrent) {
      item.setAttribute("selected", "");
      item.classList.add("selected");
    }

    const anchor = document.createElement("a");
    anchor.id = "wc-endpoint";
    anchor.className = "yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer";
    const isVirtual = listId && listId.startsWith("virtual:");
    const listParam = listId && !isVirtual && listId !== "custom" ? `&list=${listId}` : "";
    // Virtual position rides in the hash — YouTube strips unknown query params.
    const suffix = isVirtual
      ? Playlist.rypHash(listId.replace(/^virtual:/, ""), video.index)
      : `&index=${video.index}`;
    anchor.href = `/watch?v=${video.videoId}${listParam}${suffix}`;

    // Index / Play Icon
    const indexDiv = document.createElement("div");
    indexDiv.id = "index-container";
    indexDiv.className = "style-scope ytd-playlist-panel-video-renderer";
    indexDiv.style.minWidth = "24px";
    indexDiv.style.textAlign = "center";
    const indexSpan = document.createElement("span");
    indexSpan.id = "index";
    indexSpan.textContent = isCurrent ? "▶" : String(video.index);
    indexDiv.appendChild(indexSpan);

    // Thumbnail
    const thumbDiv = document.createElement("div");
    thumbDiv.id = "thumbnail-container";
    thumbDiv.className = "style-scope ytd-playlist-panel-video-renderer";
    thumbDiv.style.position = "relative";
    thumbDiv.style.flexShrink = "0";

    const img = document.createElement("img");
    img.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
    img.style.width = "90px";
    img.style.height = "50px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "6px";
    img.style.display = "block";

    const durationSpan = document.createElement("span");
    durationSpan.className = "badge-shape-wiz__text ytd-thumbnail-overlay-time-status-renderer";
    durationSpan.textContent = video.durationStr || "";
    durationSpan.style.position = "absolute";
    durationSpan.style.bottom = "2px";
    durationSpan.style.right = "2px";
    durationSpan.style.background = "rgba(0,0,0,0.8)";
    durationSpan.style.color = "#fff";
    durationSpan.style.fontSize = "10px";
    durationSpan.style.padding = "1px 4px";
    durationSpan.style.borderRadius = "3px";

    thumbDiv.append(img, durationSpan);

    // Info (Title, Channel, Badge)
    const metaDiv = document.createElement("div");
    metaDiv.id = "meta";
    metaDiv.className = "style-scope ytd-playlist-panel-video-renderer";
    metaDiv.style.flex = "1";
    metaDiv.style.overflow = "hidden";
    metaDiv.style.paddingLeft = "8px";

    const titleH4 = document.createElement("h4");
    titleH4.id = "video-title";
    titleH4.className = "style-scope ytd-playlist-panel-video-renderer";
    titleH4.textContent = video.title || `Video ${video.videoId}`;
    titleH4.title = video.title || "";
    titleH4.style.fontSize = "13px";
    titleH4.style.margin = "0 0 2px 0";
    titleH4.style.whiteSpace = "nowrap";
    titleH4.style.overflow = "hidden";
    titleH4.style.textOverflow = "ellipsis";

    const bylineSpan = document.createElement("span");
    bylineSpan.id = "byline";
    bylineSpan.className = "style-scope ytd-playlist-panel-video-renderer";
    bylineSpan.textContent = video.channel || "Added to Snapshot";
    bylineSpan.style.fontSize = "11px";
    bylineSpan.style.color = "var(--ryp-sub)";

    metaDiv.append(titleH4, bylineSpan);

    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = anchor.href;
    });

    anchor.append(indexDiv, thumbDiv, metaDiv);
    item.appendChild(anchor);

    return item;
  }

  async function injectVirtualPlaylistPanel() {
    if (!Playlist.isVirtualPlaylist()) return;
    if (document.getElementById("ryp-virtual-playlist-panel")) return;

    const snapshotId = Playlist.getVirtualSnapshotId();
    const savedPlaylists = (await State.get(State.keys.savedPlaylists)) || [];
    let snapshot = savedPlaylists.find((p) => p.id === snapshotId);
    if (!snapshot) {
      const listId = Playlist.getPlaylistId();
      snapshot = savedPlaylists.find((p) => p.sourceListId === listId || p.id === listId?.replace(/^virtual:/, ""));
    }
    if (!snapshot || !Array.isArray(snapshot.videos) || snapshot.videos.length === 0) return;

    const targets = [
      "#secondary #secondary-inner",
      "#secondary",
      "#columns #secondary",
      "ytd-watch-flexy #secondary",
    ];

    let host = null;
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) {
        host = el;
        break;
      }
    }
    if (!host) return;

    const panel = document.createElement("div");
    panel.id = "ryp-virtual-playlist-panel";
    panel.className = "ryp-virtual-panel style-scope ytd-watch-flexy";

    const header = document.createElement("div");
    header.id = "header";
    header.className = "ryp-virtual-header";

    const headerContents = document.createElement("div");
    headerContents.id = "header-contents";
    headerContents.className = "ryp-virtual-header-contents";

    const infoDiv = document.createElement("div");
    infoDiv.className = "ryp-virtual-info";

    const titleH3 = document.createElement("h3");
    titleH3.className = "ryp-virtual-title";
    titleH3.textContent = snapshot.name;
    titleH3.title = snapshot.name;

    const countSpan = document.createElement("span");
    countSpan.id = "ryp-virtual-count";
    countSpan.className = "ryp-virtual-count";
    countSpan.textContent = `${snapshot.videos.length} videos · Local Playlist`;

    infoDiv.append(titleH3, countSpan);
    headerContents.appendChild(infoDiv);
    header.appendChild(headerContents);

    const itemsContainer = document.createElement("div");
    itemsContainer.id = "items";
    itemsContainer.className = "ryp-virtual-items";

    panel.append(header, itemsContainer);
    host.prepend(panel);

    // Populate items
    for (const vid of snapshot.videos) {
      const itemEl = createCustomPlaylistItem(vid, `virtual:${snapshot.id}`);
      itemsContainer.appendChild(itemEl);
    }
  }

  // ── Visual order ──────────────────────────────────────────────────────────

  /** Reflect the current playback mode visually in the sidebar. */
  function applyVisualOrder() {
    const container = Playlist.getItemsContainer();
    if (!container) return;

    const { reverseOn, customOrder } = Playback.getState();

    if (!reverseOn && !(customOrder && customOrder.length > 0) && !visualStateApplied) {
      return;
    }

    if (customOrder && customOrder.length > 0) {
      // Custom/shuffle order: keep DOM untouched, use CSS `order` property.
      container.classList.remove(REVERSED_CLASS);
      container.style.display = "flex";
      container.style.flexDirection = "column";

      const items = Playlist.readItems();
      items.forEach((item) => {
        const orderPos = customOrder.indexOf(item.index);
        item.element.style.order = orderPos >= 0 ? orderPos : 9999;
      });
      visualStateApplied = true;
    } else {
      // Reset any CSS order overrides from a previous custom/shuffle mode.
      const panel = document.querySelector(Playlist.SEL.panel);
      if (panel) {
        panel.querySelectorAll(Playlist.SEL.item).forEach((el) => {
          el.style.order = "";
        });
      }
      container.style.display = "";
      container.style.flexDirection = "";

      // Cosmetic column-reverse for pure reverse mode.
      container.classList.toggle(REVERSED_CLASS, reverseOn);
      visualStateApplied = reverseOn;
    }
  }

  /** Scroll the playlist sidebar so the currently-playing item is visible. */
  function scrollToCurrentItem() {
    const container = Playlist.getItemsContainer();
    if (!container) return;
    const selected = container.querySelector(`${Playlist.SEL.item}[selected]`);
    if (!selected) return;

    let scroller = null;
    for (let node = selected.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          scroller = node;
          break;
        }
      }
      if (node === document.body) break;
    }

    if (scroller) {
      const sRect = scroller.getBoundingClientRect();
      const iRect = selected.getBoundingClientRect();
      scroller.scrollTop += iRect.top - sRect.top - 8;
    } else {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Drag and drop & Quick Move Helpers ─────────────────────────────────────

  function makeItemsDraggable() {
    Playlist.readItems().forEach(({ element }) => {
      element.setAttribute("draggable", "true");
      element.classList.add("ryp-draggable");
      element.addEventListener("dragstart", onDragStart);
      element.addEventListener("dragover", onDragOver);
      element.addEventListener("drop", onDrop);
      element.addEventListener("dragend", onDragEnd);

      // Prepend drag handle and quick action controls if missing
      if (!element.querySelector(".ryp-reorder-controls")) {
        const controls = document.createElement("div");
        controls.className = "ryp-reorder-controls";

        const handle = document.createElement("div");
        handle.className = "ryp-drag-handle";
        handle.textContent = "⋮⋮";
        handle.title = "Drag to reorder";

        const topBtn = document.createElement("button");
        topBtn.className = "ryp-quick-move-btn ryp-move-top";
        topBtn.type = "button";
        topBtn.title = "Move to Top";
        topBtn.textContent = "⤒";
        topBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          moveItemToPosition(element, "top");
        });

        const bottomBtn = document.createElement("button");
        bottomBtn.className = "ryp-quick-move-btn ryp-move-bottom";
        bottomBtn.type = "button";
        bottomBtn.title = "Move to Bottom";
        bottomBtn.textContent = "⤓";
        bottomBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          moveItemToPosition(element, "bottom");
        });

        controls.append(handle, topBtn, bottomBtn);
        element.prepend(controls);
      }
    });
  }

  function removeItemsDraggable() {
    const panel = document.querySelector(Playlist.SEL.panel);
    if (!panel) return;
    panel.querySelectorAll(Playlist.SEL.item).forEach((el) => {
      el.removeAttribute("draggable");
      el.classList.remove("ryp-draggable", "ryp-drag-over", "ryp-dragging");
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("dragend", onDragEnd);
      el.querySelector(".ryp-reorder-controls")?.remove();
    });
  }

  async function moveItemToPosition(element, position) {
    const targetIdx = indexFromElement(element);
    if (targetIdx === null) return;

    const { reverseOn, customOrder } = Playback.getState();
    const originalOrder = Playlist.readItems().map((item) => item.index);
    const visibleOrder = customOrder && customOrder.length > 0
      ? [...customOrder]
      : reverseOn ? originalOrder.reverse() : originalOrder;

    const filtered = visibleOrder.filter((idx) => idx !== targetIdx);
    if (position === "top") {
      filtered.unshift(targetIdx);
    } else {
      filtered.push(targetIdx);
    }

    const listId = Playlist.getPlaylistId();
    if (listId && filtered.length > 0) {
      await Playback.applyCustomOrder(listId, filtered);
      applyVisualOrder();
      window.RYP.Toolbar?.syncButtonStates();
      scrollToCurrentItem();
    }
  }

  function onDragStart(e) {
    dragSrcElement = this;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    this.classList.add("ryp-dragging");
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const panel = document.querySelector(Playlist.SEL.panel);
    if (panel) {
      panel
        .querySelectorAll(Playlist.SEL.item)
        .forEach((el) => el.classList.remove("ryp-drag-over"));
    }
    this.classList.add("ryp-drag-over");
    return false;
  }

  function indexFromElement(element) {
    const href = element.querySelector(Playlist.SEL.itemLink)?.getAttribute("href");
    const index = parseInt(new URL(href || "", location.origin).searchParams.get("index") || "", 10);
    return Number.isFinite(index) ? index : null;
  }

  async function onDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    if (!dragSrcElement || dragSrcElement === this) return;

    const container = Playlist.getItemsContainer();
    if (!container) return;

    const { reverseOn, customOrder } = Playback.getState();
    const originalOrder = Playlist.readItems().map((item) => item.index);
    const visibleOrder = customOrder && customOrder.length > 0
      ? [...customOrder]
      : reverseOn ? originalOrder.reverse() : originalOrder;
    const sourceIndex = indexFromElement(dragSrcElement);
    const targetIndex = indexFromElement(this);
    const srcPos = visibleOrder.indexOf(sourceIndex);
    const dstPos = visibleOrder.indexOf(targetIndex);
    if (srcPos === -1 || dstPos === -1) return;

    const newOrder = visibleOrder.filter((index) => index !== sourceIndex);
    const targetPosition = newOrder.indexOf(targetIndex);
    newOrder.splice(srcPos < dstPos ? targetPosition + 1 : targetPosition, 0, sourceIndex);

    const listId = Playlist.getPlaylistId();
    if (listId && newOrder.length > 0) {
      await Playback.applyCustomOrder(listId, newOrder);
      applyVisualOrder();
      window.RYP.Toolbar?.syncButtonStates();
    }
  }

  function onDragEnd() {
    const panel = document.querySelector(Playlist.SEL.panel);
    if (panel) {
      panel
        .querySelectorAll(Playlist.SEL.item)
        .forEach((el) =>
          el.classList.remove("ryp-dragging", "ryp-drag-over")
        );
    }
    dragSrcElement = null;
  }

  // ── Watch-progress badges ─────────────────────────────────────────────────

  /** Stamps or removes .ryp-watched on each sidebar item based on storage. */
  async function applyWatchedBadges() {
    const listId = Playlist.getPlaylistId();
    if (!listId) return;
    const container = Playlist.getItemsContainer();
    const watched = await Playback.getWatched(listId);
    if (Playlist.getPlaylistId() !== listId || Playlist.getItemsContainer() !== container) return;
    Playlist.readItems().forEach((item) => {
      item.element.classList.toggle(
        "ryp-watched",
        watched.includes(item.videoId) || watched.includes(item.index)
      );
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Sidebar = {
    applyVisualOrder,
    applyWatchedBadges,
    scrollToCurrentItem,
    injectVirtualPlaylistPanel,

    disableReorderMode() {
      if (!reorderModeOn) return;
      reorderModeOn = false;
      removeItemsDraggable();
      Playlist.getItemsContainer()?.classList.remove("ryp-reorder-mode");
    },

    toggleReorderMode() {
      reorderModeOn = !reorderModeOn;
      if (reorderModeOn) {
        makeItemsDraggable();
      } else {
        removeItemsDraggable();
      }
      const container = Playlist.getItemsContainer();
      if (container)
        container.classList.toggle("ryp-reorder-mode", reorderModeOn);
    },

    isReorderModeOn: () => reorderModeOn,

    refreshDraggable() {
      if (!reorderModeOn) return;
      removeItemsDraggable();
      makeItemsDraggable();
      Playlist.getItemsContainer()?.classList.add("ryp-reorder-mode");
    },
  };

  // Listen for watched changes from popup or other tabs
  const api = typeof browser !== "undefined" ? browser : chrome;
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      const hasWatchedChange = Object.keys(changes).some((k) => k.startsWith("watched:"));
      if (hasWatchedChange) {
        applyWatchedBadges();
      }
    }
  });
})();
