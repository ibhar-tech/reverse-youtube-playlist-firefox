/*
 * YouTube Playlist Tools — channel.js
 *
 * "Play a channel from its oldest video": pure helpers, no UI. The bar on
 * channel pages lives in toolbar.js; this file decides *which* playlist it
 * opens and whether the channel id on the page can be trusted.
 *
 * Every channel has an uploads playlist whose id is the channel id with "UC"
 * swapped for a prefix: UU (all uploads), UULF (videos only — no Shorts, no
 * live streams), UUSH (Shorts), UULV (past live streams). All are newest
 * first, so "oldest first" is the uploads playlist played in reverse, through
 * the overview page's existing Play Reverse flow.
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  // Channel ids are "UC" + 22 base64url characters.
  const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  const CHANNEL_ID_IN_TEXT_RE = /\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/;

  // Channel tabs the bar is shown on. Not /playlists, /community, /search:
  // there the uploads are not what the user is looking at.
  const CHANNEL_PATH_RE =
    /^\/(@[^/]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[^/]+|user\/[^/]+)(?:\/(?:featured|videos|streams|shorts))?\/?$/;

  // The marker travels in the URL *hash*: YouTube keeps the fragment of a
  // /playlist URL but drops query params it does not know (see
  // Playlist.rypParams for the same reason on watch pages).
  const PLAY_MARKER = "ryp_play";
  const MODES = ["oldest", "newest"];

  // sessionStorage, not storage.local: the pending play must survive exactly
  // one reload of this tab and never leak into another tab.
  const PENDING_KEY = "ryp_channel_pending";
  const PENDING_TTL_MS = 30000;

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  function pathOf(url) {
    if (!url) return "";
    try {
      return new URL(url, "https://www.youtube.com").pathname;
    } catch {
      return "";
    }
  }

  function isChannelPath(pathname) {
    return CHANNEL_PATH_RE.test(pathname || "");
  }

  /**
   * "/@Veritasium/videos" → "/@veritasium". Two URLs with the same root are
   * the same channel. Handles are case-insensitive and may be percent-encoded
   * (non-Latin handles), so both forms compare equal.
   */
  function channelRoot(pathname) {
    const m = (pathname || "").match(CHANNEL_PATH_RE);
    if (!m) return null;
    const root = safeDecode(m[1]);
    // Channel ids are case-sensitive; handles and legacy names are not.
    return root.startsWith("channel/") ? `/${root}` : `/${root.toLowerCase()}`;
  }

  function isValidChannelId(id) {
    return typeof id === "string" && CHANNEL_ID_RE.test(id);
  }

  function idFromPath(pathname) {
    const m = (pathname || "").match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
    return m ? m[1] : null;
  }

  /**
   * Channel id from the server-rendered microformat of the document:
   * <meta itemprop="identifier">, then the /channel/UC… canonical or og:url.
   * Only valid for the channel the document was *loaded* for — YouTube does
   * not update these on SPA navigation (checked on live YouTube: after
   * @GoogleDevelopers → @veritasium they still name Google for Developers).
   */
  function readDocumentChannelId(doc = document) {
    const ident = doc.querySelector?.('meta[itemprop="identifier"]')?.getAttribute("content");
    if (isValidChannelId(ident)) return ident;
    const urls = [
      ...Array.from(doc.querySelectorAll?.('link[rel="canonical"]') || []).map((l) => l.getAttribute("href")),
      doc.querySelector?.('meta[property="og:url"]')?.getAttribute("content"),
    ];
    for (const url of urls) {
      const m = (url || "").match(CHANNEL_ID_IN_TEXT_RE);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * URL this document was loaded from — not where the SPA has moved since.
   * The navigation timing entry never changes after load; the handheld
   * alternate link is the server's own record of the requested path.
   */
  function documentUrl(doc = document, perf = typeof performance !== "undefined" ? performance : null) {
    try {
      const nav = perf?.getEntriesByType?.("navigation")?.[0];
      if (nav?.name) return nav.name;
    } catch (_) {}
    return doc.querySelector?.('link[rel="alternate"][media="handheld"]')?.getAttribute("href") || "";
  }

  /**
   * Channel id for the page at `pathname`:
   *   { id, fresh: true }        — trustworthy, use it
   *   { id: null, fresh: false } — the page was reached by SPA navigation, so
   *                                the document's id may be another channel's;
   *                                reloading this URL yields the right one
   *   null                       — not a channel page, or the document was
   *                                loaded for this channel and carries no id
   *                                (hide the button rather than guess)
   */
  function resolveChannelId({ pathname = location.pathname, doc = document, perf } = {}) {
    if (!isChannelPath(pathname)) return null;
    const fromPath = idFromPath(pathname);
    if (fromPath) return { id: fromPath, fresh: true };

    const loadedRoot = channelRoot(pathOf(documentUrl(doc, perf)));
    if (loadedRoot && loadedRoot === channelRoot(pathname)) {
      const docId = readDocumentChannelId(doc);
      // Loaded for this very channel and still no id: YouTube stopped
      // serving it, so a reload would not help either.
      return docId ? { id: docId, fresh: true } : null;
    }
    // Reached by SPA navigation (from the home page, a video, another
    // channel, or the same channel under another URL form such as /c/name):
    // whatever id the document holds may name a different channel, and
    // guessing wrong would play a stranger's uploads.
    return { id: null, fresh: false };
  }

  /** "UC…" → "UULF…" (videos only) or "UU…" (every upload). */
  function uploadsPlaylistId(channelId, kind = "videos") {
    if (!isValidChannelId(channelId)) return null;
    const prefix = kind === "all" ? "UU" : "UULF";
    return prefix + channelId.slice(2);
  }

  /**
   * Some channels have no long-form videos (only Shorts or streams), and
   * their UULF playlist does not exist. Fall back to all uploads.
   */
  function fallbackListId(listId) {
    return /^UULF[A-Za-z0-9_-]{22}$/.test(listId || "") ? "UU" + listId.slice(4) : null;
  }

  function playlistUrl(listId, mode) {
    if (!listId || !MODES.includes(mode)) return null;
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}#${PLAY_MARKER}=${mode}`;
  }

  function readPlayMarker(hash = location.hash) {
    const mode = new URLSearchParams((hash || "").replace(/^#/, "")).get(PLAY_MARKER);
    return MODES.includes(mode) ? mode : null;
  }

  /** The hash with our marker removed (other fragment params kept). */
  function stripPlayMarker(hash = location.hash) {
    const params = new URLSearchParams((hash || "").replace(/^#/, ""));
    params.delete(PLAY_MARKER);
    const rest = params.toString();
    return rest ? `#${rest}` : "";
  }

  function savePending(storage, mode, root, now = Date.now()) {
    try {
      storage.setItem(PENDING_KEY, JSON.stringify({ mode, root, at: now }));
      return true;
    } catch {
      return false;
    }
  }

  /** Read and clear the pending play; only honoured for the same channel, soon after. */
  function takePending(storage, root, now = Date.now()) {
    let raw = null;
    try {
      raw = storage.getItem(PENDING_KEY);
      if (raw !== null) storage.removeItem(PENDING_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!MODES.includes(p?.mode) || p.root !== root) return null;
      if (!(now - p.at >= 0 && now - p.at < PENDING_TTL_MS)) return null;
      return p.mode;
    } catch {
      return null;
    }
  }

  window.RYP.Channel = {
    PLAY_MARKER,
    PENDING_KEY,
    isChannelPath,
    channelRoot,
    isValidChannelId,
    idFromPath,
    readDocumentChannelId,
    documentUrl,
    resolveChannelId,
    uploadsPlaylistId,
    fallbackListId,
    playlistUrl,
    readPlayMarker,
    stripPlayMarker,
    savePending,
    takePending,
  };
})();
