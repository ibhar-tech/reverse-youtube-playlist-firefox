/*
 * YouTube Playlist Tools — backup.js
 *
 * Shared helpers for exporting/importing saved playlist snapshots as JSON
 * backup files. Loaded both as a content script (in-page panel) and by the
 * browser-action popup, so it has no dependency on other RYP modules or
 * extension APIs — callers own all storage reads/writes.
 *
 * Backup file schema:
 *   { schema: "ryp-saved-playlists", schemaVersion: 2, exportedAt, playlists }
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  const SCHEMA = "ryp-saved-playlists";
  // YouTube video/playlist id charset. Snapshots built from "Add to List" have
  // no source playlist — that is expressed as an empty sourceListId, not as a
  // short id, so the length floor stays put.
  const ID_RE = /^[A-Za-z0-9_-]{5,64}$/;

  const BUTTON_KEYS = [
    "reverse",
    "shuffle",
    "sort",
    "reorder",
    "reset",
    "save",
    "myLists",
    "duration",
    "loadAll",
    "addVideo",
  ];

  function freshId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeTags(tags) {
    const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
    const unique = [];
    for (const value of values) {
      const tag = String(value).trim().replace(/^#+/, "").slice(0, 24);
      if (tag && !unique.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        unique.push(tag);
      }
      if (unique.length === 8) break;
    }
    return unique;
  }

  // Must match the keys popup/popup.js writes to ryp_settings — a renamed
  // key here silently stops round-tripping.
  const BOOL_SETTING_KEYS = [
    "autoSkip",
    "showBadges",
    "compact",
    "loop",
    "resumePrompt",
    "disableAutoplay",
  ];

  /** Validate and sanitize settings payload for export/import. */
  function normalizeSettings(s) {
    if (!s || typeof s !== "object") return null;
    const norm = {};
    if (["en", "fr", "ar"].includes(s.lang)) norm.lang = s.lang;
    for (const key of BOOL_SETTING_KEYS) {
      if (typeof s[key] === "boolean") norm[key] = s[key];
    }
    if (s.buttonVisibility && typeof s.buttonVisibility === "object") {
      const vis = {};
      for (const key of BUTTON_KEYS) {
        if (typeof s.buttonVisibility[key] === "boolean") {
          vis[key] = s.buttonVisibility[key];
        }
      }
      if (Object.keys(vis).length > 0) norm.buttonVisibility = vis;
    }
    return Object.keys(norm).length > 0 ? norm : null;
  }

  /** Merge incoming settings into existing: unknown keys dropped, unspecified keys preserved. */
  function mergeSettings(existing, incoming) {
    const base = existing && typeof existing === "object" ? { ...existing } : {};
    const inc = normalizeSettings(incoming);
    if (!inc) return base;
    const { buttonVisibility, ...flat } = inc;
    Object.assign(base, flat);
    if (buttonVisibility) {
      base.buttonVisibility = { ...(base.buttonVisibility || {}), ...buttonVisibility };
    }
    return base;
  }

  function isValidSnapshot(p) {
    const order = Array.isArray(p?.order) ? p.order.map(Number) : [];
    return Boolean(
      p && typeof p === "object" &&
      typeof p.name === "string" && p.name.trim() &&
      typeof p.sourceListId === "string" && (p.sourceListId === "" || ID_RE.test(p.sourceListId)) &&
      order.length > 0 &&
      order.every((index) => Number.isInteger(index) && index > 0) &&
      new Set(order).size === order.length &&
      Array.isArray(p.videos) && p.videos.some((video) => (
        video && typeof video === "object" &&
        Number.isInteger(Number(video.index)) && Number(video.index) > 0 &&
        ID_RE.test(video.videoId || "")
      ))
    );
  }

  /** Rebuild a snapshot from untrusted input, keeping only known fields. */
  function normalizeSnapshot(p) {
    return {
      id: typeof p.id === "string" && p.id ? p.id.slice(0, 64) : freshId(),
      name: p.name.trim().slice(0, 80),
      tags: normalizeTags(p.tags),
      sourceListId: p.sourceListId || "",
      order: p.order.map(Number),
      videos: p.videos
        .filter((v) => v && typeof v === "object" && ID_RE.test(v.videoId || ""))
        .map((v) => ({
          index: Number(v.index),
          videoId: v.videoId,
          title: typeof v.title === "string" ? v.title.slice(0, 300) : "",
          thumbnail: typeof v.thumbnail === "string" ? v.thumbnail.slice(0, 500) : "",
          durationStr: typeof v.durationStr === "string" ? v.durationStr.slice(0, 20) : "",
        })),
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    };
  }

  /**
   * Parse backup file text into normalized snapshots and optional settings.
   * Accepts the backup envelope or a raw snapshot array.
   * Throws on anything that yields neither valid snapshots nor valid settings.
   */
  function parseBackup(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : (data && data.playlists);
    const settings = normalizeSettings(data && data.settings);

    if (!Array.isArray(incoming) && !settings) {
      throw new Error("not a backup file");
    }

    const playlists = Array.isArray(incoming)
      ? incoming
          .filter(isValidSnapshot)
          .map(normalizeSnapshot)
          .filter((snapshot) => {
            const videoIndices = new Set(snapshot.videos.map((video) => video.index));
            return snapshot.order.every((index) => videoIndices.has(index));
          })
      : [];

    if (playlists.length === 0 && !settings) {
      throw new Error("no valid playlists or settings");
    }

    return {
      schema: data?.schema || SCHEMA,
      schemaVersion: data?.schemaVersion || (Array.isArray(data) ? 1 : 2),
      exportedAt: data?.exportedAt || null,
      playlists,
      settings,
    };
  }

  /**
   * Parse backup file text into normalized snapshots.
   * Attaches .settings to the returned array when settings are present.
   */
  function parseImport(text) {
    const parsed = parseBackup(text);
    const result = parsed.playlists;
    result.settings = parsed.settings;
    return result;
  }

  /**
   * Merge imported snapshots into the existing list.
   * Content-identical snapshots are skipped; id collisions with different
   * content get a fresh id so both snapshots survive.
   * Returns { merged, added, skipped }; `existing` is not mutated.
   */
  function mergeSnapshots(existing, incoming) {
    const merged = existing.slice();
    const byId = new Map(merged.map((p) => [p.id, p]));
    const fingerprint = (p) => JSON.stringify({
      name: p.name,
      tags: normalizeTags(p.tags),
      sourceListId: p.sourceListId,
      order: p.order,
      videos: p.videos,
      savedAt: p.savedAt,
    });
    const fingerprints = new Set(merged.map(fingerprint));
    let added = 0;
    let skipped = 0;

    for (const pl of incoming) {
      const contentKey = fingerprint(pl);
      if (fingerprints.has(contentKey)) {
        skipped++;
        continue;
      }
      const dup = byId.get(pl.id);
      const candidate = dup ? { ...pl, id: freshId() } : pl;
      byId.set(candidate.id, candidate);
      fingerprints.add(contentKey);
      merged.push(candidate);
      added++;
    }
    return { merged, added, skipped };
  }

  /** Trigger a download of the backup file in the caller's document. */
  function triggerDownload(playlists, settings = null) {
    const payload = {
      schema: SCHEMA,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      playlists: (playlists || []).map((playlist) => ({
        ...playlist,
        tags: normalizeTags(playlist.tags),
      })),
    };
    const normSettings = normalizeSettings(settings);
    if (normSettings) {
      payload.settings = normSettings;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playlist-tools-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  window.RYP.Backup = {
    BUTTON_KEYS,
    normalizeTags,
    normalizeSettings,
    mergeSettings,
    isValidSnapshot,
    normalizeSnapshot,
    parseBackup,
    parseImport,
    mergeSnapshots,
    triggerDownload,
  };
})();
