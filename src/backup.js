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
   * Parse backup file text into normalized snapshots.
   * Accepts the backup envelope or a raw snapshot array.
   * Throws on anything that yields no valid snapshots.
   */
  function parseImport(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data && data.playlists;
    if (!Array.isArray(incoming)) throw new Error("not a backup file");
    const valid = incoming
      .filter(isValidSnapshot)
      .map(normalizeSnapshot)
      .filter((snapshot) => {
        const videoIndices = new Set(snapshot.videos.map((video) => video.index));
        return snapshot.order.every((index) => videoIndices.has(index));
      });
    if (valid.length === 0) throw new Error("no valid playlists");
    return valid;
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
  function triggerDownload(playlists) {
    const payload = {
      schema: SCHEMA,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      playlists: playlists.map((playlist) => ({
        ...playlist,
        tags: normalizeTags(playlist.tags),
      })),
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
    normalizeTags,
    isValidSnapshot,
    normalizeSnapshot,
    parseImport,
    mergeSnapshots,
    triggerDownload,
  };
})();
