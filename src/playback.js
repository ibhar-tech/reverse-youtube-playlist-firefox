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
 *   sortByTitle(listId, ascending)
 *   sortByDuration(listId, shortestFirst)
 *   sortByChannel(listId, ascending)
 *   sortByWatched(listId, unwatchedFirst)
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
  // Firefox fires `timeupdate` every ~280ms and YouTube declares the video
  // ended on its own once ~0.1s remain, then navigates ~20ms later. A 0.35s
  // lead missed: the last event landed at 0.37s, the next at 0.09s — too late
  // (measured 2026-09-06). One second guarantees an event inside the window.
  const END_LEAD = 1.0;
  // A *pause* needs more room: YouTube treats a pause with 0.72s left as the
  // video ending and advances anyway, while at 1.48s it stays an ordinary
  // pause (measured 2026-09-06). Two seconds keeps clear of that line.
  const STOP_LEAD = 2.0;

  let reverseOn = false;
  let shuffleOn = false;
  let customOrder = null; // (videoId | legacy index)[] — play order, or null
  let lastIndex = null;
  // Order entry and position of the previous video (custom orders only).
  let lastKey = null;
  let lastPos = null;
  let navigating = false;
  let endHandled = false;
  
  let autoSkipEnabled = false;
  let loopEnabled = false;
  let resumePromptEnabled = true;
  let disableAutoplay = false;
  // Watched entries are videoId strings since v3; legacy entries may still be
  // playlist indices (numbers) until migrated by loadState().
  let cachedWatched = [];

  // Load settings initially and on storage onChanged
  function updateSettings(settings) {
    autoSkipEnabled = !!settings?.autoSkip;
    loopEnabled = !!settings?.loop;
    resumePromptEnabled = settings?.resumePrompt ?? true;
    disableAutoplay = !!settings?.disableAutoplay;
  }

  api.storage.local.get("ryp_settings").then((res) => {
    updateSettings(res.ryp_settings);
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.ryp_settings) updateSettings(changes.ryp_settings.newValue);
    const listId = Playlist.getPlaylistId();
    const watchedChange = listId && changes[State.keys.watched(listId)];
    if (watchedChange) cachedWatched = watchedChange.newValue || [];
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function cancelYouTubeAutonav() {
    const cancelSelectors = [
      ".ytp-autonav-endscreen-upnext-cancel-button",
      ".ytp-autonav-cancel-button",
      "button.ytp-autonav-endscreen-button-cancel",
      ".ytp-autonav-endscreen-button-cancel",
      ".ytp-autonav-endscreen [aria-label*='Cancel']",
      ".ytp-autonav-endscreen [aria-label*='Annuler']",
      ".ytp-autonav-endscreen [aria-label*='إلغاء']",
    ];
    for (const sel of cancelSelectors) {
      const cancelBtn = document.querySelector(sel);
      if (cancelBtn && typeof cancelBtn.click === "function") {
        try {
          cancelBtn.click();
          break;
        } catch (_) {}
      }
    }
  }

  // YouTube plays ads in the same <video>. An ad reaching its end must not
  // count as the video ending — it would mark the video watched, arm
  // endHandled so the real ending is ignored, and in a mode skip the video.
  function adPlaying() {
    return !!document.querySelector(
      ".html5-video-player.ad-showing, .html5-video-player.ad-interrupting"
    );
  }

  // Stop here instead of letting the video end. If YouTube still starts a
  // navigation within half a second of the pause, that is its own
  // auto-advance (a human click takes longer) — e.g. a background tab whose
  // throttled `timeupdate` skipped the window — so the arriving video is
  // stopped as well.
  let stoppedAt = -Infinity; // never "just now" on a fresh page
  let stopArrival = false;
  function stopVideo(v) {
    stoppedAt = performance.now();
    if (v && typeof v.pause === "function") v.pause();
    cancelYouTubeAutonav();
  }
  // YouTube's playlist auto-advance only ever happens at the end of a video,
  // and never right after the user clicked a video. Without these two checks
  // handleNavigation() could not tell YouTube moving to index+1 from the user
  // clicking the row at index+1, and "corrected" the user's own choice.
  const AUTO_ADVANCE_WINDOW_S = 3;
  const USER_PICK_MS = 1500;
  let lastUserPick = -Infinity;
  let arrivedByAutoAdvance = false;

  function onUserPick(e) {
    if (!e.isTrusted) return; // our own anchor.click() is not the user
    const t = e.target;
    if (t && typeof t.closest === "function" && t.closest(`${Playlist.SEL.item}, a[href*="/watch"]`)) {
      lastUserPick = performance.now();
    }
  }

  function onNavigateStart() {
    const now = performance.now();
    stopArrival = now - stoppedAt < 500;
    const v = document.querySelector("#movie_player video, video");
    const atEnd = !!v && (
      v.ended === true ||
      (isFinite(v.duration) && v.duration > 0 && v.duration - v.currentTime < AUTO_ADVANCE_WINDOW_S)
    );
    arrivedByAutoAdvance = atEnd && now - lastUserPick > USER_PICK_MS;
  }
  function onPlaying(e) {
    if (!stopArrival) return;
    stopArrival = false;
    e.target.pause();
  }

  function isActive() {
    return reverseOn || shuffleOn || hasOrder() || Playlist.isVirtualPlaylist();
  }

  function hasOrder() {
    return customOrder !== null && customOrder.length > 0;
  }

  // ── Order keys ────────────────────────────────────────────────────────────
  //
  // A custom/shuffle/sort order is a list of *video ids*. Before 3.6 it held
  // playlist positions, which pointed at the wrong videos as soon as the
  // playlist owner added or removed one (Watch Later shifts on every add).
  // Legacy numeric entries still work — they match by position until
  // migrateLegacyOrder() can map them to ids.

  const keyOfItem = (it) => it.videoId || it.index;

  function currentVideoId() {
    return new URLSearchParams(location.search).get("v");
  }

  function keyMatches(key, videoId, index) {
    return typeof key === "string" ? key === videoId : key === index;
  }

  // Position of the playing video in customOrder. `orderPos` remembers where
  // we last stepped to, so a video listed twice resolves to the right copy.
  let orderPos = null;

  function currentOrderPos() {
    if (!hasOrder()) return -1;
    const vid = currentVideoId();
    const idx = Playlist.currentIndex();
    if (
      orderPos !== null &&
      orderPos < customOrder.length &&
      keyMatches(customOrder[orderPos], vid, idx)
    ) {
      return orderPos;
    }
    return customOrder.findIndex((k) => keyMatches(k, vid, idx));
  }

  /** The active mode's key for the playing video, or null if it has none. */
  function currentKey() {
    if (hasOrder()) {
      const pos = currentOrderPos();
      return pos >= 0 ? customOrder[pos] : null;
    }
    return Playlist.currentIndex();
  }

  /** Index-based next for reverse mode and plain local playlists. */
  function getRawNextIndex(idx) {
    if (reverseOn) {
      if (Playlist.isVirtualPlaylist()) {
        const items = Playlist.readItems();
        const pos = items.findIndex((it) => it.index === idx);
        return pos > 0 ? items[pos - 1].index : null;
      }
      return idx - 1 >= 1 ? idx - 1 : null;
    }
    if (Playlist.isVirtualPlaylist()) {
      const items = Playlist.readItems();
      const pos = items.findIndex((it) => it.index === idx);
      if (pos >= 0 && pos + 1 < items.length) {
        return items[pos + 1].index;
      }
      return null;
    }
    return null;
  }

  /** Inverse of getRawNextIndex — the item played before idx in the order. */
  function getRawPrevIndex(idx) {
    if (reverseOn) {
      const items = Playlist.readItems();
      if (Playlist.isVirtualPlaylist()) {
        const pos = items.findIndex((it) => it.index === idx);
        return (pos >= 0 && pos + 1 < items.length) ? items[pos + 1].index : null;
      }
      const max = items.length ? items[items.length - 1].index : null;
      return max !== null && idx + 1 <= max ? idx + 1 : null;
    }
    if (Playlist.isVirtualPlaylist()) {
      const items = Playlist.readItems();
      const pos = items.findIndex((it) => it.index === idx);
      return pos > 0 ? items[pos - 1].index : null;
    }
    return null;
  }

  /** First index of the active order — used when loop mode wraps around. */
  function firstIndexInMode() {
    const items = Playlist.readItems();
    if (reverseOn) {
      return items.length ? items[items.length - 1].index : null;
    }
    if (Playlist.isVirtualPlaylist()) {
      return items.length ? items[0].index : null;
    }
    return null;
  }

  function watchedTest() {
    const items = Playlist.readItems();
    const videoIdByIndex = new Map(items.map((it) => [it.index, it.videoId]));
    return (key) => {
      if (typeof key === "string") return cachedWatched.includes(key);
      const vid = videoIdByIndex.get(key);
      return cachedWatched.includes(key) || (!!vid && cachedWatched.includes(vid));
    };
  }

  /**
   * What plays after `fromKey` (at `fromPos` in a custom order), as
   * { key, pos } — or null at the end. `pos` is null outside custom orders.
   */
  function nextTarget(fromKey, fromPos = null) {
    const isWatched = watchedTest();

    if (hasOrder()) {
      const start = fromPos ?? customOrder.indexOf(fromKey);
      if (start < 0) return null;
      const step = (p) => {
        if (p + 1 < customOrder.length) return p + 1;
        return loopEnabled ? 0 : null;
      };
      let pos = step(start);
      // Bounded so loop mode can't spin forever when all are watched.
      let hops = 0;
      while (autoSkipEnabled && pos !== null && isWatched(customOrder[pos]) && hops < customOrder.length) {
        pos = step(pos);
        hops++;
      }
      if (pos === null || pos === start) return null;
      if (autoSkipEnabled && isWatched(customOrder[pos])) return null;
      return { key: customOrder[pos], pos };
    }

    const advance = (idx) => {
      let t = getRawNextIndex(idx);
      if (t === null && loopEnabled) t = firstIndexInMode();
      return t === idx ? null : t;
    };
    let target = advance(fromKey);
    if (autoSkipEnabled) {
      const maxHops = Playlist.readItems().length + 1;
      let hops = 0;
      while (target !== null && isWatched(target) && hops < maxHops) {
        target = advance(target);
        hops++;
      }
      if (target !== null && isWatched(target)) return null;
    }
    return target === null || target === fromKey ? null : { key: target, pos: null };
  }

  /** Key that plays after `fromKey` in the active mode, or null to stop. */
  function nextIndexInMode(fromKey) {
    if (fromKey === null || fromKey === undefined) return null;
    let fromPos = null;
    if (hasOrder()) {
      fromPos = fromKey === currentKey() ? currentOrderPos() : customOrder.indexOf(fromKey);
      if (fromPos < 0) return null;
    }
    return nextTarget(fromKey, fromPos)?.key ?? null;
  }

  function stepTo(target) {
    if (navigating || target === null || target === undefined) return false;
    const { key, pos } = typeof target === "object" ? target : { key: target, pos: null };
    navigating = true;
    const ok = typeof key === "string" ? Playlist.goToVideo(key) : Playlist.goToIndex(key);
    // If the target could not be reached the click never happened — release
    // the latch or every later navigation would be silently swallowed.
    if (!ok) navigating = false;
    else if (pos !== null) orderPos = pos;
    return ok;
  }

  /**
   * Start a freshly built order from its first entry. No `navigating` latch,
   * unlike stepTo(): if that entry is already playing, no navigation follows
   * to release it.
   */
  function jumpToStart(order) {
    if (!order.length) return;
    orderPos = 0;
    if (typeof order[0] === "string") {
      if (order[0] !== currentVideoId()) Playlist.goToVideo(order[0]);
    } else {
      Playlist.goToIndex(order[0]);
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  // Primary: intercept a few milliseconds before the video ends so YouTube
  // never gets to fire its own autoplay-forward.
  function onTimeUpdate(e) {
    if (navigating || endHandled || !Playlist.isPlaylistWatchPage() || adPlaying())
      return;
    const v = e.target;
    if (!v || !v.duration || !isFinite(v.duration) || v.duration < 1) return;
    const left = v.duration - v.currentTime;
    if (left > STOP_LEAD) return;
    if (!isActive() && !disableAutoplay) return;

    const next = disableAutoplay ? null : nextFromCurrent();
    // Navigating can wait for the last second; pausing cannot (see STOP_LEAD).
    if (next !== null && left > END_LEAD) return;

    endHandled = true;
    // We leave before `ended` can fire, so the video must be marked watched
    // here or modes would never record watch progress.
    const listId = Playlist.getPlaylistId();
    const finished = currentVideoId() || Playlist.currentIndex();
    if (listId && finished !== null) markAsWatched(listId, finished);

    if (next !== null) {
      stepTo(next);
    } else {
      // Autoplay disabled, or end of the active order: YouTube's own
      // autoplay-forward must never get to fire.
      stopVideo(v);
    }
  }

  // Backup: fires if the near-end trigger above somehow missed.
  function onEnded(e) {
    if (!Playlist.isPlaylistWatchPage() || adPlaying()) return;
    // Always mark as watched, regardless of mode.
    const listId = Playlist.getPlaylistId();
    const finished = currentVideoId() || Playlist.currentIndex();
    if (listId && finished !== null) markAsWatched(listId, finished);

    if ((!isActive() && !disableAutoplay) || navigating || endHandled) return;
    endHandled = true;
    const next = disableAutoplay ? null : nextFromCurrent();
    if (next !== null) {
      stepTo(next);
    } else {
      stopVideo(e?.target || document.querySelector("#movie_player video, video"));
    }
  }

  /** Next target from the playing video, or null at the end / off-order. */
  function nextFromCurrent() {
    const key = currentKey();
    if (key === null) return null;
    return nextTarget(key, hasOrder() ? currentOrderPos() : null);
  }

  async function markAsWatched(listId, indexOrVideoId) {
    // Prefer the stable videoId; fall back to the index if the sidebar item
    // for this index is not loaded (badges still work via the index check).
    const item = typeof indexOrVideoId === "number"
      ? Playlist.readItems().find((it) => it.index === indexOrVideoId)
      : null;
    const entry = typeof indexOrVideoId === "string" ? indexOrVideoId : (item?.videoId || indexOrVideoId);
    if (!cachedWatched.includes(entry)) cachedWatched = [...cachedWatched, entry];
    const watched = (await State.get(State.keys.watched(listId))) || [];
    if (!watched.includes(entry)) {
      watched.push(entry);
      await State.set(State.keys.watched(listId), watched);
      window.RYP.Stats?.recordFinished();
    }
    if (Playlist.getPlaylistId() === listId) {
      cachedWatched = watched;
      window.RYP.Sidebar?.applyWatchedBadges();
      window.RYP.Toolbar?.updateDurationStats();
    }
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

  // ── Player next/prev control interception ────────────────────────────────
  function handleManualStep(e, isNext) {
    const key = currentKey();
    if (key === null) return; // can't resolve position — let YouTube handle it
    e.preventDefault();
    e.stopPropagation();

    if (isNext) {
      const next = nextFromCurrent();
      if (next !== null) {
        stepTo(next);
      } else {
        const Panel = window.RYP.Panel;
        if (Panel) Panel.showToast(Panel.t("endOfOrder"));
      }
      return;
    }

    // Previous: mimic YouTube — restart the video when already a few
    // seconds in, otherwise go to the item played before this one.
    const v = document.querySelector("#movie_player video, video");
    if (v && v.currentTime > 3) {
      v.currentTime = 0;
      return;
    }
    let prev = null;
    if (hasOrder()) {
      const pos = currentOrderPos();
      if (pos > 0) prev = { key: customOrder[pos - 1], pos: pos - 1 };
    } else {
      const idx = getRawPrevIndex(key);
      if (idx !== null) prev = idx;
    }
    if (prev !== null) stepTo(prev);
    else if (v) v.currentTime = 0; // start of the order — just restart
  }

  function onControlClick(e) {
    if (!isActive() || !Playlist.isPlaylistWatchPage()) return;
    if (!e.target || typeof e.target.closest !== "function") return;
    const btn = e.target.closest(".ytp-next-button, .ytp-prev-button");
    if (!btn) return;
    handleManualStep(e, btn.classList.contains("ytp-next-button"));
  }

  function onControlKey(e) {
    if (!isActive() || !Playlist.isPlaylistWatchPage()) return;
    if (!e.shiftKey || (e.key !== "N" && e.key !== "P")) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName))) return;
    handleManualStep(e, e.key === "N");
  }

  // ── Watch-progress recording (resume where you left off) ────────────────

  const PROGRESS_SAVE_MS = 5000;
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
    if (adPlaying()) return;

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
    if (Playlist.getPlaylistId() !== listId) return;
    if (!prog || !prog.videoId) return;
    const currentVideoId = new URLSearchParams(location.search).get("v");
    if (prog.videoId === currentVideoId) return; // already on that video

    window.RYP.Panel?.showResumeToast(prog, listId);
  }

  // endHandled is otherwise cleared only by a navigation. After a stop (end
  // of the order, or autoplay disabled) a user who seeks back to rewatch
  // would find the near-end guard disarmed, and YouTube's autoplay-forward
  // would run at the next ending.
  function onSeeked(e) {
    const v = e.target;
    if (!endHandled || navigating || !v || !isFinite(v.duration)) return;
    if (v.duration - v.currentTime > STOP_LEAD) endHandled = false;
  }

  document.addEventListener("timeupdate", onTimeUpdate, true);
  document.addEventListener("seeked", onSeeked, true);
  document.addEventListener("timeupdate", onProgressTick, true);
  document.addEventListener("ended", onEnded, true);
  document.addEventListener("playing", onPlaying, true);
  document.addEventListener("yt-navigate-start", onNavigateStart, true);
  document.addEventListener("click", onControlClick, true);
  document.addEventListener("click", onUserPick, true);
  document.addEventListener("keydown", onControlKey, true);

  // ── Public API ────────────────────────────────────────────────────────────

  window.RYP.Playback = {
    async loadState(listId) {
      const [savedReverse, savedShuffle, savedOrder, watched] = await Promise.all([
        State.get(State.keys.reverse(listId)),
        State.get(State.keys.shuffle(listId)),
        State.get(State.keys.customOrder(listId)),
        State.get(State.keys.watched(listId)),
      ]);
      if (!Playlist.isPlaylistWatchPage() || Playlist.getPlaylistId() !== listId) {
        return false;
      }

      let loadedWatched = watched || [];
      const migrated = migrateWatched(loadedWatched);
      if (migrated) {
        loadedWatched = migrated;
        await State.set(State.keys.watched(listId), migrated);
      }
      if (!Playlist.isPlaylistWatchPage() || Playlist.getPlaylistId() !== listId) {
        return false;
      }

      reverseOn = !!savedReverse;
      shuffleOn = !!savedShuffle && savedOrder != null;
      customOrder = Array.isArray(savedOrder) && savedOrder.length ? savedOrder : null;
      orderPos = null;
      lastKey = null;
      lastPos = null;
      cachedWatched = loadedWatched;
      await this.migrateLegacyOrder(listId);
      return true;
    },

    /**
     * Turn legacy position entries of the stored order into video ids, for
     * whichever of them are rendered right now. Called on load and again on
     * DOM passes, as long playlists render more rows.
     */
    async migrateLegacyOrder(listId) {
      if (!hasOrder() || !customOrder.some((k) => typeof k === "number")) return false;
      if (Playlist.getPlaylistId() !== listId) return false;
      const byIndex = new Map(
        Playlist.readItems().filter((it) => it.videoId).map((it) => [it.index, it.videoId])
      );
      let changed = false;
      const next = customOrder.map((k) => {
        if (typeof k === "number" && byIndex.has(k)) {
          changed = true;
          return byIndex.get(k);
        }
        return k;
      });
      if (!changed) return false;
      customOrder = next;
      await State.set(State.keys.customOrder(listId), next);
      return true;
    },

    handleNavigation() {
      if (!Playlist.isPlaylistWatchPage()) {
        lastIndex = null;
        navigating = false;
        return;
      }
      const idx = Playlist.currentIndex();
      endHandled = false;
      const autoAdvanced = arrivedByAutoAdvance;
      arrivedByAutoAdvance = false;

      maybeOfferResume(Playlist.getPlaylistId());

      // YouTube's own forward-advance slipped past the near-end trigger:
      // redirect it to the mode's real next item. Only when the previous
      // video really ended (see onNavigateStart) — a row the user clicked
      // must play, even when it happens to be index+1. Never when autoplay
      // is disabled.
      if (
        isActive() &&
        !disableAutoplay &&
        !navigating &&
        autoAdvanced &&
        lastIndex !== null &&
        idx === lastIndex + 1
      ) {
        const next = hasOrder()
          ? (lastPos !== null ? nextTarget(lastKey, lastPos) : null)
          : nextTarget(lastIndex, null);
        if (next !== null && stepTo(next)) return;
      }
      navigating = false;
      lastIndex = idx;
      lastPos = hasOrder() ? currentOrderPos() : null;
      if (lastPos !== null && lastPos < 0) lastPos = null;
      lastKey = lastPos !== null ? customOrder[lastPos] : null;
      if (lastPos !== null) orderPos = lastPos;
    },

    async enableReverse(listId) {
      reverseOn = true;
      shuffleOn = false;
      customOrder = null;
      await State.set(State.keys.reverse(listId), true);
      await State.set(State.keys.shuffle(listId), false);
      await State.remove(State.keys.customOrder(listId));

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

      const keys = items.map(keyOfItem);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      customOrder = keys;
      orderPos = null;

      await State.set(State.keys.reverse(listId), false);
      await State.set(State.keys.shuffle(listId), true);
      await State.set(State.keys.customOrder(listId), customOrder);

      jumpToStart(customOrder);
    },

    async disableShuffle(listId) {
      shuffleOn = false;
      customOrder = null;
      await State.set(State.keys.shuffle(listId), false);
      await State.remove(State.keys.customOrder(listId));
    },

    /** Smart sorting by video title (A-Z or Z-A). */
    async sortByTitle(listId, ascending = true) {
      const items = Playlist.readItems();
      if (items.length === 0) return null;
      const sorted = [...items].sort((a, b) => {
        const diff = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
        return ascending ? diff : -diff;
      });
      const order = sorted.map(keyOfItem);
      await this.applyCustomOrder(listId, order);
      jumpToStart(order);
      return order;
    },

    /** Smart sorting by video duration (shortest first or longest first). */
    async sortByDuration(listId, shortestFirst = true) {
      const items = Playlist.readItems();
      if (items.length === 0) return null;
      const sorted = [...items].sort((a, b) => {
        const diff = (a.durationSeconds || 0) - (b.durationSeconds || 0);
        return shortestFirst ? diff : -diff;
      });
      const order = sorted.map(keyOfItem);
      await this.applyCustomOrder(listId, order);
      jumpToStart(order);
      return order;
    },

    /** Smart sorting by channel / creator name. */
    async sortByChannel(listId, ascending = true) {
      const items = Playlist.readItems();
      if (items.length === 0) return null;
      const sorted = [...items].sort((a, b) => {
        const diff = (a.channel || "").localeCompare(b.channel || "");
        return ascending ? diff : -diff;
      });
      const order = sorted.map(keyOfItem);
      await this.applyCustomOrder(listId, order);
      jumpToStart(order);
      return order;
    },

    /** Smart sorting by watched status (unwatched first or watched first). */
    async sortByWatched(listId, unwatchedFirst = true) {
      const items = Playlist.readItems();
      if (items.length === 0) return null;
      const isWatched = (it) => cachedWatched.includes(it.videoId) || cachedWatched.includes(it.index);
      const sorted = [...items].sort((a, b) => {
        const aW = isWatched(a) ? 1 : 0;
        const bW = isWatched(b) ? 1 : 0;
        return unwatchedFirst ? aW - bW : bW - aW;
      });
      const order = sorted.map(keyOfItem);
      await this.applyCustomOrder(listId, order);
      jumpToStart(order);
      return order;
    },

    /** Set an arbitrary play order (e.g. from drag-and-drop or sorting). */
    async applyCustomOrder(listId, order) {
      reverseOn = false;
      shuffleOn = false;
      customOrder = order;
      orderPos = null;
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

    isActive() {
      return isActive();
    },

    /** Index that plays after `idx` in the active mode, or null at the end. */
    nextIndexInMode,

    getState() {
      return { reverseOn, shuffleOn, customOrder };
    },

    /** Order key for a sidebar item: its video id (or index if it has none). */
    keyOfItem,

    /** Test hooks: what yt-navigate-start and a page click do. */
    _onNavigateStart: onNavigateStart,
    _onUserPick: onUserPick,
    _stepNext: () => stepTo(nextFromCurrent()),

    async getWatched(listId) {
      return (await State.get(State.keys.watched(listId))) || [];
    },

    async markAsWatched(listId, indexOrVideoId) {
      await markAsWatched(listId, indexOrVideoId);
    },

    async clearWatched(listId) {
      cachedWatched = [];
      await State.remove(State.keys.watched(listId));
    },

    cancelYouTubeAutonav,
    isAutoplayDisabled() {
      return disableAutoplay;
    },
    updateSettings,
  };
})();
