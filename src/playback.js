/*
 * YouTube Playlist Tools — playback.js
 *
 * The playback engine: manages reverse, shuffle, and custom-order modes.
 * It intercepts the video `ended` / `timeupdate` events and re-routes
 * navigation to the correct next item according to the active mode.
 *
 * Public API (window.RYP.Playback):
 *   loadState(listId)              — restore persisted mode for a playlist
 *   handleNavigation()             — call on every yt-navigate-finish
 *   enableReverse(listId)
 *   disableReverse(listId)
 *   enableShuffle(listId)
 *   disableShuffle(listId)
 *   applyCustomOrder(listId, order) — set an arbitrary play-order array
 *   disableAll(listId)
 *   getState()                     → { reverseOn, shuffleOn, customOrder }
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const { State, Playlist } = window.RYP;

  // How many seconds before the true end we pre-empt YouTube's autoplay.
  const END_LEAD = 0.35;

  let reverseOn = false;
  let shuffleOn = false;
  let customOrder = null; // number[] — play-order of playlist indices, or null
  let lastIndex = null;
  let navigating = false;
  let endHandled = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isActive() {
    return reverseOn || shuffleOn || customOrder !== null;
  }

  /** Returns the index to navigate to after currentIdx, or null to stop. */
  function nextIndexInMode(currentIdx) {
    if (customOrder && customOrder.length > 0) {
      const pos = customOrder.indexOf(currentIdx);
      if (pos === -1 || pos + 1 >= customOrder.length) return null;
      return customOrder[pos + 1];
    }
    if (reverseOn) {
      return currentIdx - 1 >= 1 ? currentIdx - 1 : null;
    }
    return null;
  }

  function stepTo(targetIndex) {
    if (navigating || targetIndex === null) return false;
    navigating = true;
    return Playlist.goToIndex(targetIndex);
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  // Primary: intercept a few milliseconds before the video ends so YouTube
  // never gets to fire its own autoplay-forward.
  function onTimeUpdate(e) {
    if (!isActive() || navigating || endHandled || !Playlist.isPlaylistWatchPage())
      return;
    const v = e.target;
    if (!v || !v.duration || !isFinite(v.duration) || v.duration < 1) return;
    if (v.duration - v.currentTime <= END_LEAD) {
      endHandled = true;
      const next = nextIndexInMode(Playlist.currentIndex());
      if (next !== null) stepTo(next);
    }
  }

  // Backup: fires if the near-end trigger above somehow missed.
  function onEnded() {
    if (!Playlist.isPlaylistWatchPage()) return;
    // Always mark as watched, regardless of mode.
    const listId = Playlist.getPlaylistId();
    const finishedIndex = Playlist.currentIndex();
    if (listId && finishedIndex !== null) markAsWatched(listId, finishedIndex);

    if (!isActive() || navigating || endHandled) return;
    endHandled = true;
    const next = nextIndexInMode(finishedIndex);
    if (next !== null) stepTo(next);
  }

  async function markAsWatched(listId, index) {
    const watched = (await State.get(State.keys.watched(listId))) || [];
    if (watched.includes(index)) return;
    watched.push(index);
    await State.set(State.keys.watched(listId), watched);
    // Refresh sidebar badges if Sidebar is already loaded.
    window.RYP.Sidebar?.applyWatchedBadges();
  }

  document.addEventListener("timeupdate", onTimeUpdate, true);
  document.addEventListener("ended", onEnded, true);

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Playback = {
    async loadState(listId) {
      reverseOn = !!(await State.get(State.keys.reverse(listId)));
      const savedShuffle = !!(await State.get(State.keys.shuffle(listId)));
      const savedOrder = (await State.get(State.keys.customOrder(listId))) || null;

      // Shuffle requires a custom order to have been stored; if it's gone, reset.
      shuffleOn = savedShuffle && savedOrder !== null;
      customOrder = savedOrder;
    },

    handleNavigation() {
      if (!Playlist.isPlaylistWatchPage()) {
        lastIndex = null;
        navigating = false;
        return;
      }
      const idx = Playlist.currentIndex();
      endHandled = false; // new video settled — re-arm the near-end trigger

      // Fallback: catch a forward advance that the near-end trigger missed.
      if (
        isActive() &&
        !navigating &&
        lastIndex !== null &&
        idx === lastIndex + 1
      ) {
        const next = nextIndexInMode(lastIndex);
        if (next !== null && stepTo(next)) return;
      }
      navigating = false;
      lastIndex = idx;
    },

    async enableReverse(listId) {
      reverseOn = true;
      shuffleOn = false;
      customOrder = null;
      await State.set(State.keys.reverse(listId), true);
      await State.set(State.keys.shuffle(listId), false);
      await State.remove(State.keys.customOrder(listId));

      // Jump straight to the last video so playback begins from the end.
      const items = Playlist.readItems();
      const last = items.length ? items[items.length - 1].index : null;
      const cur = Playlist.currentIndex();
      if (last !== null && cur !== null && cur < last) Playlist.goToIndex(last);
    },

    async disableReverse(listId) {
      reverseOn = false;
      await State.set(State.keys.reverse(listId), false);
    },

    async enableShuffle(listId) {
      const items = Playlist.readItems();
      if (items.length === 0) return;

      reverseOn = false;
      shuffleOn = true;

      // Fisher-Yates shuffle.
      const indices = items.map((it) => it.index);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      customOrder = indices;

      await State.set(State.keys.reverse(listId), false);
      await State.set(State.keys.shuffle(listId), true);
      await State.set(State.keys.customOrder(listId), customOrder);

      // Jump to first in the shuffled order.
      Playlist.goToIndex(customOrder[0]);
    },

    async disableShuffle(listId) {
      shuffleOn = false;
      customOrder = null;
      await State.set(State.keys.shuffle(listId), false);
      await State.remove(State.keys.customOrder(listId));
    },

    /** Set an arbitrary play order (e.g. from drag-and-drop). */
    async applyCustomOrder(listId, order) {
      reverseOn = false;
      shuffleOn = false;
      customOrder = order;
      await State.set(State.keys.reverse(listId), false);
      await State.set(State.keys.shuffle(listId), false);
      await State.set(State.keys.customOrder(listId), order);
    },

    async disableAll(listId) {
      reverseOn = false;
      shuffleOn = false;
      customOrder = null;
      await State.set(State.keys.reverse(listId), false);
      await State.set(State.keys.shuffle(listId), false);
      await State.remove(State.keys.customOrder(listId));
    },

    getState() {
      return { reverseOn, shuffleOn, customOrder };
    },

    async getWatched(listId) {
      return (await State.get(State.keys.watched(listId))) || [];
    },

    async clearWatched(listId) {
      await State.remove(State.keys.watched(listId));
    },
  };
})();
