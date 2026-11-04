/*
 * YouTube Playlist Tools — stats.js
 *
 * Local-only usage stats: what the extension did for you (playlists
 * reversed, videos finished, hours watched, time saved by playback speed).
 * Shown in the popup with a "share" button, and used to ask — once, ever —
 * for a store rating after a few real uses. Nothing leaves the browser.
 *
 * Storage:
 *   ryp_stats  { since, actions: {reverse, shuffle, …}, videosFinished,
 *                contentSeconds, realSeconds }
 *   ryp_rating { asked: true, askedAt }
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};
  const api = typeof browser !== "undefined" ? browser : chrome;

  const KEY = "ryp_stats";
  const RATING_KEY = "ryp_rating";
  const RATING_AFTER_ACTIONS = 5;
  const FLUSH_MS = 15000;
  // A jump larger than this between two timeupdates is a seek, not playback.
  const MAX_TICK_S = 2;

  const fresh = () => ({ actions: {}, videosFinished: 0, contentSeconds: 0, realSeconds: 0 });

  let pending = fresh();
  let chain = Promise.resolve();
  let lastFlush = Date.now();

  function hasPending() {
    return (
      Object.keys(pending.actions).length > 0 ||
      pending.videosFinished > 0 ||
      pending.contentSeconds > 0
    );
  }

  /** Fold a delta into a stored stats object (pure). */
  function merge(stored, delta) {
    const base = stored && typeof stored === "object" ? stored : {};
    const out = {
      since: typeof base.since === "string" ? base.since : new Date().toISOString(),
      actions: { ...(base.actions || {}) },
      videosFinished: Number(base.videosFinished) || 0,
      contentSeconds: Number(base.contentSeconds) || 0,
      realSeconds: Number(base.realSeconds) || 0,
    };
    for (const [k, n] of Object.entries(delta.actions || {})) {
      out.actions[k] = (Number(out.actions[k]) || 0) + n;
    }
    out.videosFinished += delta.videosFinished || 0;
    out.contentSeconds += delta.contentSeconds || 0;
    out.realSeconds += delta.realSeconds || 0;
    return out;
  }

  function totalActions(stats) {
    return Object.values(stats?.actions || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  }

  /** Write pending counts. Serialised so two flushes never interleave. */
  function flush() {
    if (!hasPending()) return chain;
    const delta = pending;
    pending = fresh();
    lastFlush = Date.now();
    chain = chain
      .then(async () => {
        const res = await api.storage.local.get(KEY);
        await api.storage.local.set({ [KEY]: merge(res[KEY], delta) });
      })
      .catch(() => {});
    return chain;
  }

  async function maybeAskForRating() {
    const res = await api.storage.local.get([KEY, RATING_KEY]);
    if (res[RATING_KEY]?.asked) return false;
    if (totalActions(res[KEY]) < RATING_AFTER_ACTIONS) return false;
    // Mark first: the prompt must never show twice, even if it fails to render.
    await api.storage.local.set({
      [RATING_KEY]: { asked: true, askedAt: new Date().toISOString() },
    });
    setTimeout(() => window.RYP.Panel?.showRatingToast?.(), 1500);
    return true;
  }

  /** Count one user action (reverse, shuffle, sort, reorder, save, addVideo, loadAll). */
  function bump(action) {
    pending.actions[action] = (pending.actions[action] || 0) + 1;
    return flush().then(maybeAskForRating).catch(() => false);
  }

  function recordFinished() {
    pending.videosFinished++;
    return flush();
  }

  // ── Watch time on playlist pages ──────────────────────────────────────────

  let lastTime = null;
  let lastVideoId = null;

  function adPlaying() {
    return !!document.querySelector?.(
      ".html5-video-player.ad-showing, .html5-video-player.ad-interrupting"
    );
  }

  function onTimeUpdate(e) {
    const v = e.target;
    if (!v || typeof v.currentTime !== "number") return;
    const Playlist = window.RYP.Playlist;
    const videoId = new URLSearchParams(location.search).get("v");
    if (!Playlist?.isPlaylistWatchPage() || v.paused || adPlaying() || !videoId) {
      lastTime = null;
      return;
    }
    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      lastTime = v.currentTime;
      return;
    }
    const delta = v.currentTime - (lastTime ?? v.currentTime);
    lastTime = v.currentTime;
    if (delta <= 0 || delta > MAX_TICK_S) return;
    pending.contentSeconds += delta;
    pending.realSeconds += delta / (v.playbackRate > 0 ? v.playbackRate : 1);
    if (Date.now() - lastFlush > FLUSH_MS) flush();
  }

  document.addEventListener("timeupdate", onTimeUpdate, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener?.("pagehide", () => flush());

  window.RYP.Stats = {
    KEY,
    RATING_KEY,
    RATING_AFTER_ACTIONS,
    bump,
    recordFinished,
    flush,
    merge,
    totalActions,
    maybeAskForRating,
    _onTimeUpdate: onTimeUpdate,
  };
})();
