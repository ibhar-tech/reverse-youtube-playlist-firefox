/*
 * YouTube Playlist Tools — backup.js
 *
 * Shared helpers for exporting/importing saved playlist snapshots as JSON
 * backup files. Loaded both as a content script (in-page panel) and by the
 * browser-action popup, so it has no dependency on other RYP modules or
 * extension APIs — callers own all storage reads/writes.
 *
 * Backup file schema:
 *   { schema: "ryp-saved-playlists", schemaVersion: 1, exportedAt, playlists }
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  const SCHEMA = "ryp-saved-playlists";
  const ID_RE = /^[A-Za-z0-9_-]{5,64}$/; // YouTube video/playlist id charset

  function freshId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isValidSnapshot(p) {
    return (
      p && typeof p === "object" &&
      typeof p.name === "string" && p.name.trim() &&
      typeof p.sourceListId === "string" && ID_RE.test(p.sourceListId) &&
      Array.isArray(p.order) && p.order.length > 0 &&
      p.order.every((n) => Number.isFinite(Number(n))) &&
      Array.isArray(p.videos)
    );
  }

  /** Rebuild a snapshot from untrusted input, keeping only known fields. */
  function normalizeSnapshot(p) {
    return {
      id: typeof p.id === "string" && p.id ? p.id.slice(0, 64) : freshId(),
      name: p.name.trim().slice(0, 80),
      sourceListId: p.sourceListId,
      order: p.order.map(Number),
      videos: p.videos
        .filter((v) => v && typeof v === "object" && ID_RE.test(v.videoId || ""))
        .map((v) => ({
          index: Number(v.index),
          videoId: v.videoId,
          title: typeof v.title === "string" ? v.title.slice(0, 300) : "",
          thumbnail: typeof v.thumbnail === "string" ? v.thumbnail.slice(0, 500) : "",
        })),
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    };
  }

  /**
   * Parse backup file text into normalized snapshots.
   * Accepts the backup envelope or a raw snapshot array.
   * Throws on anything that yields no valid snapshots.
   */
  function parseImport(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data && data.playlists;
    if (!Array.isArray(incoming)) throw new Error("not a backup file");
    const valid = incoming.filter(isValidSnapshot).map(normalizeSnapshot);
    if (valid.length === 0) throw new Error("no valid playlists");
    return valid;
  }

  /**
   * Merge imported snapshots into the existing list.
   * Exact duplicates (same id + savedAt + name) are skipped; id collisions
   * with different content get a fresh id so both copies survive.
   * Returns { merged, added, skipped }; `existing` is not mutated.
   */
  function mergeSnapshots(existing, incoming) {
    const merged = existing.slice();
    const byId = new Map(merged.map((p) => [p.id, p]));
    let added = 0;
    let skipped = 0;

    for (const pl of incoming) {
      const dup = byId.get(pl.id);
      if (dup && dup.savedAt === pl.savedAt && dup.name === pl.name) {
        skipped++;
        continue;
      }
      if (dup) pl.id = freshId();
      byId.set(pl.id, pl);
      merged.push(pl);
      added++;
    }
    return { merged, added, skipped };
  }

  /** Trigger a download of the backup file in the caller's document. */
  function triggerDownload(playlists) {
    const payload = {
      schema: SCHEMA,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      playlists,
    };
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
    freshId,
    isValidSnapshot,
    normalizeSnapshot,
    parseImport,
    mergeSnapshots,
    triggerDownload,
  };
})();
