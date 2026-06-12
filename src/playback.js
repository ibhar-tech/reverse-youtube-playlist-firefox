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

  const api = (typeof browser !== "undefined" ? browser : chrome);

  // How many seconds before the true end we pre-empt YouTube's autoplay.
  const END_LEAD = 0.35;

  let reverseOn = false;
  let shuffleOn = false;
  let customOrder = null; // number[] — play-order of playlist indices, or null
  let lastIndex = null;
  let navigating = false;
  let endHandled = false;
  
  let autoSkipEnabled = false;
  let loopEnabled = false;
  let resumePromptEnabled = true;
  // Watched entries are videoId strings since v3; legacy entries may still be
  // playlist indices (numbers) until migrated by loadState().
  let cachedWatched = [];

  // Load settings initially and on storage onChanged
  function updateSettings(settings) {
    autoSkipEnabled = !!settings?.autoSkip;
    loopEnabled = !!settings?.loop;
    resumePromptEnabled = settings?.resumePrompt ?? true;
  }

  api.storage.local.get("ryp_settings").then((res) => {
    updateSettings(res.ryp_settings);
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.ryp_settings) {
      updateSettings(changes.ryp_settings.newValue);
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isActive() {
    return reverseOn || shuffleOn || customOrder !== null;
  }

  function getRawNextIndex(idx) {
    if (customOrder && customOrder.length > 0) {
      const pos = customOrder.indexOf(idx);
      if (pos === -1 || pos + 1 >= customOrder.length) return null;
      return customOrder[pos + 1];
    }
    if (reverseOn) {
      return idx - 1 >= 1 ? idx - 1 : null;
    }
    return null;
  }

  /** First index of the active order — used when loop mode wraps around. */
  function firstIndexInMode() {
    if (customOrder && customOrder.length > 0) return customOrder[0];
    if (reverseOn) {
      const items = Playlist.readItems();
      return items.length ? items[items.length - 1].index : null;
    }
    return null;
  }

  /** Returns the index to navigate to after currentIdx, or null to stop. */
  function nextIndexInMode(currentIdx) {
    const items = Playlist.readItems();
    const videoIdByIndex = new Map(items.map((it) => [it.index, it.videoId]));
    const isWatched = (idx) => {
      const vid = videoIdByIndex.get(idx);
      return (
        cachedWatched.includes(idx) || (!!vid && cachedWatched.includes(vid))
      );
    };
    const advance = (idx) => {
      let t = getRawNextIndex(idx);
      if (t === null && loopEnabled) t = firstIndexInMode();
      return t === idx ? null : t;
    };

    let target = advance(currentIdx);
    if (!autoSkipEnabled) return target;

    // Skip watched items; bounded so loop mode can't spin forever when
    // everything in the order has already been watched.
    const maxHops = (customOrder ? customOrder.length : items.length) + 1;
    let hops = 0;
    while (target !== null && isWatched(target) && hops < maxHops) {
      target = advance(target);
      hops++;
    }
    if (target !== null && isWatched(target)) return null;
    return target === currentIdx ? null : target;
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
      // We navigate away before `ended` can fire, so the video must be
      // marked watched here or modes would never record watch progress.
      const listId = Playlist.getPlaylistId();
      const finishedIndex = Playlist.currentIndex();
      if (listId && finishedIndex !== null) markAsWatched(listId, finishedIndex);

      const next = nextIndexInMode(finishedIndex);
      if (next !== null) {
        stepTo(next);
      } else {
        // End of the active order: pause so YouTube's own autoplay-forward
        // cannot hijack playback into the wrong next video.
        v.pause();
      }
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
    // Prefer the stable videoId; fall back to the index if the sidebar item
    // for this index is not loaded (badges still work via the index check).
    const item = Playlist.readItems().find((it) => it.index === index);
    const entry = item?.videoId || index;
    const watched = (await State.get(State.keys.watched(listId))) || [];
    if (!watched.includes(entry)) {
      watched.push(entry);
      await State.set(State.keys.watched(listId), watched);
    }
    cachedWatched = watched;
    // Refresh sidebar badges if Sidebar is already loaded.
    window.RYP.Sidebar?.applyWatchedBadges();
  }

  /**
   * v2 stored watched entries as playlist indices; v3 stores videoIds so
   * badges survive playlist edits. Maps any legacy numeric entries to
   * videoIds via the loaded sidebar items (unmappable ones are kept as-is
   * so they keep matching by index until their item loads).
   */
  function migrateWatched(watched) {
    if (!watched.some((w) => typeof w === "number")) return null;
    const byIndex = new Map(
      Playlist.readItems().map((it) => [it.index, it.videoId])
    );
    let changed = false;
    const out = [];
    for (const w of watched) {
      const mapped = typeof w === "number" && byIndex.get(w) ? byIndex.get(w) : w;
      if (mapped !== w) changed = true;
      if (!out.includes(mapped)) out.push(mapped);
    }
    return changed ? out : null;
  }

  // ── Watch-progress recording (resume where you left off) ────────────────

  const PROGRESS_SAVE_MS = 5000;
  // listIds whose stored progress has been read for a resume offer this
  // session. Recording is held off until then so a fresh save can't clobber
  // the resume point before it is offered.
  const resumeChecked = new Set();
  let lastProgressSave = 0;

  function onProgressTick(e) {
    const v = e.target;
    if (!v || !Playlist.isPlaylistWatchPage()) return;
    if (!v.duration || !isFinite(v.duration) || v.duration < 1) return;
    const now = Date.now();
    if (now - lastProgressSave < PROGRESS_SAVE_MS) return;

    const listId = Playlist.getPlaylistId();
    const videoId = new URLSearchParams(location.search).get("v");
    if (!listId || !videoId || !resumeChecked.has(listId)) return;
    // Don't let ad playback positions overwrite real progress.
    if (document.querySelector(".html5-video-player.ad-showing")) return;

    lastProgressSave = now;
    State.set(State.keys.progress(listId), {
      videoId,
      index: Playlist.currentIndex(),
      t: Math.floor(v.currentTime),
      title: (document.title || "").replace(/ - YouTube$/, "").slice(0, 200),
      updatedAt: Date.now(),
    });
  }

  /** Offer to jump back to the last recorded position, once per playlist. */
  async function maybeOfferResume(listId) {
    if (resumeChecked.has(listId)) return;
    resumeChecked.add(listId);
    if (!resumePromptEnabled) return;

    const prog = await State.get(State.keys.progress(listId));
    if (!prog || !prog.videoId) return;
    const currentVideoId = new URLSearchParams(location.search).get("v");
    if (prog.videoId === currentVideoId) return; // already on that video

    window.RYP.Panel?.showResumeToast(prog, listId);
  }

  document.addEventListener("timeupdate", onTimeUpdate, true);
  document.addEventListener("timeupdate", onProgressTick, true);
  document.addEventListener("ended", onEnded, true);

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Playback = {
    async loadState(listId) {
      reverseOn = !!(await State.get(State.keys.reverse(listId)));
      const savedShuffle = !!(await State.get(State.keys.shuffle(listId)));
      const savedOrder = (await State.get(State.keys.customOrder(listId))) || null;
      cachedWatched = (await State.get(State.keys.watched(listId))) || [];

      const migrated = migrateWatched(cachedWatched);
      if (migrated) {
        cachedWatched = migrated;
        await State.set(State.keys.watched(listId), migrated);
      }

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

      maybeOfferResume(Playlist.getPlaylistId());

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
      cachedWatched = [];
      await State.remove(State.keys.watched(listId));
    },
  };
})();
