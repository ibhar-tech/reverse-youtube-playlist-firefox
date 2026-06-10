/*
 * YouTube Playlist Tools — sidebar.js
 *
 * Handles all visual-order concerns for the playlist sidebar:
 *   - Applying CSS column-reverse for reverse mode
 *   - Applying CSS `order` property for custom/shuffle order
 *   - Drag-and-drop reorder mode (makes sidebar items draggable)
 *
 * Drag-and-drop works by:
 *   1. Adding `draggable="true"` + drag event listeners to each sidebar item.
 *   2. On drop: directly moving the dropped element in the DOM and computing
 *      the new index order from DOM position.
 *   3. Persisting the new order via Playback.applyCustomOrder().
 *   4. The MutationObserver in content.js re-applies visual order after
 *      YouTube re-renders the panel, so state survives SPA navigations.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { Playlist, Playback, State } = window.RYP;

  const REVERSED_CLASS = "ryp-reversed";
  let reorderModeOn = false;
  let dragSrcElement = null;

  // ── Visual order ──────────────────────────────────────────────────────────

  /** Reflect the current playback mode visually in the sidebar. */
  function applyVisualOrder() {
    const container = Playlist.getItemsContainer();
    if (!container) return;

    const { reverseOn, customOrder } = Playback.getState();

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

  function onDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    if (!dragSrcElement || dragSrcElement === this) return;

    const container = Playlist.getItemsContainer();
    if (!container) return;

    const allEls = Array.from(
      container.querySelectorAll(Playlist.SEL.item)
    );
    const srcPos = allEls.indexOf(dragSrcElement);
    const dstPos = allEls.indexOf(this);
    if (srcPos === -1 || dstPos === -1) return;

    // Reorder in DOM.
    if (srcPos < dstPos) {
      container.insertBefore(dragSrcElement, this.nextSibling);
    } else {
      container.insertBefore(dragSrcElement, this);
    }

    // Derive the new play order from DOM position after the move.
    const newOrder = Array.from(
      container.querySelectorAll(Playlist.SEL.item)
    )
      .map((el) => {
        const anchor = el.querySelector(Playlist.SEL.itemLink);
        const href = anchor && anchor.getAttribute("href");
        if (!href) return null;
        const idx = parseInt(
          new URL(href, location.origin).searchParams.get("index") || "",
          10
        );
        return Number.isFinite(idx) ? idx : null;
      })
      .filter((idx) => idx !== null);

    const listId = Playlist.getPlaylistId();
    if (listId && newOrder.length > 0) {
      // Fire-and-forget — visual change is already applied, storage follows.
      Playback.applyCustomOrder(listId, newOrder);
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
    const watched = await Playback.getWatched(listId);
    Playlist.readItems().forEach((item) => {
      item.element.classList.toggle(
        "ryp-watched",
        watched.includes(item.index)
      );
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Sidebar = {
    applyVisualOrder,
    applyWatchedBadges,

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
    },
  };
})();
