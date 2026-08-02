/*
 * YouTube Playlist Tools — sidebar.js
 *
 * Handles all visual-order concerns for the playlist sidebar:
 *   - Applying CSS column-reverse for reverse mode
 *   - Applying CSS `order` property for custom/shuffle order
 *   - Drag-and-drop reorder mode (makes sidebar items draggable)
 *
 * Drag-and-drop derives a new order from the currently visible sequence and
 * persists it through Playback.applyCustomOrder(). CSS ordering keeps the
 * result visible after YouTube re-renders the panel.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { Playlist, Playback } = window.RYP;

  const REVERSED_CLASS = "ryp-reversed";
  let reorderModeOn = false;
  let dragSrcElement = null;
  // True while order styles/classes are applied to the sidebar, so the
  // no-mode case can skip the per-item DOM walk (this runs on every
  // throttled mutation pass).
  let visualStateApplied = false;
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

  /**
   * Scroll the playlist sidebar so the currently-playing item is visible.
   * Needed whenever our CSS reordering is active: YouTube auto-scrolls by
   * DOM position, which no longer matches the visual position (e.g. with
   * column-reverse the scroller rests at the visual bottom).
   */
  function scrollToCurrentItem() {
    const container = Playlist.getItemsContainer();
    if (!container) return;
    const selected = container.querySelector(`${Playlist.SEL.item}[selected]`);
    if (!selected) return;

    // Find the scrollable ancestor that actually owns the panel scrollbar.
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
      // Relative adjustment works in both scroll coordinate systems
      // (column-reverse flips the scrollTop origin to the visual bottom).
      scroller.scrollTop += iRect.top - sRect.top - 8;
    } else {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  function makeItemsDraggable() {
    Playlist.readItems().forEach(({ element }) => {
      element.setAttribute("draggable", "true");
      element.classList.add("ryp-draggable");
      element.addEventListener("dragstart", onDragStart);
      element.addEventListener("dragover", onDragOver);
      element.addEventListener("drop", onDrop);
      element.addEventListener("dragend", onDragEnd);

      // Prepend a drag handle to allow dragging visually
      if (!element.querySelector(".ryp-drag-handle")) {
        const handle = document.createElement("div");
        handle.className = "ryp-drag-handle";
        handle.textContent = "⋮⋮";
        handle.title = "Drag to reorder";
        element.prepend(handle);
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
    });
  }

  function onDragStart(e) {
    dragSrcElement = this;
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox to initiate a drag.
    e.dataTransfer.setData("text/plain", "");
    this.classList.add("ryp-dragging");
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Highlight only the current target.
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
      // Entries are videoIds since v3; legacy entries may be indices.
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

    // Called by the MutationObserver after YouTube re-renders the panel,
    // so drag handles are re-attached to the new DOM elements.
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
