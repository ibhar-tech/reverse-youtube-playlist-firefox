/*
 * YouTube Playlist Tools — export.js
 *
 * Turns a list of videos into a plain-text list or a CSV file, in whatever
 * order the caller hands over. The formatting is pure (no DOM, no storage)
 * so it can be unit-tested; only download() and copyText() touch the page.
 *
 * Callers own the order: the toolbar passes the rows the sidebar shows
 * (orderItems), the My Lists panel passes a snapshot's saved order
 * (snapshotItems).
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  const CSV_HEADER = ["position", "title", "channel", "duration", "url"];
  // Excel opens a BOM-less CSV as the machine's ANSI code page, which turns
  // every Arabic (or accented) title into mojibake. The BOM is what tells it
  // the file is UTF-8; other spreadsheet apps simply skip it.
  const BOM = "﻿";

  const watchUrl = (videoId) =>
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  /** First position of each order key — the same rule Sidebar uses. */
  function orderPositions(keys) {
    const byVideoId = new Map();
    const byIndex = new Map();
    keys.forEach((key, i) => {
      const map = typeof key === "string" ? byVideoId : byIndex;
      const k = typeof key === "string" ? key : Number(key);
      if (!map.has(k)) map.set(k, i);
    });
    return { byVideoId, byIndex };
  }

  /**
   * Sidebar rows in the order the sidebar shows them. `keys` is
   * Sidebar.visibleOrderKeys(): video ids, or legacy playlist positions from
   * pre-3.6 orders. This mirrors applyVisualOrder's CSS `order` — a row whose
   * key is missing from the order sinks to the end, in playlist order — so
   * the export never disagrees with what the user is looking at.
   */
  function orderItems(items, keys) {
    const list = Array.isArray(items) ? items : [];
    if (!Array.isArray(keys) || keys.length === 0) return list.slice();
    const pos = orderPositions(keys);
    return list
      .map((item, i) => ({
        item,
        i,
        p: pos.byVideoId.get(item.videoId) ?? pos.byIndex.get(Number(item.index)) ?? Infinity,
      }))
      .sort((a, b) => (a.p - b.p) || (a.i - b.i))
      .map((entry) => entry.item);
  }

  /**
   * A saved snapshot's videos in its saved order. Same walk as
   * Backup.orderVideoIds, but it keeps each video's own record (title,
   * channel, duration) instead of reducing it to an id.
   */
  function snapshotItems(snapshot) {
    const videos = Array.isArray(snapshot?.videos) ? snapshot.videos : [];
    const byIndex = new Map(videos.map((v) => [Number(v?.index), v]));
    const ordered = (Array.isArray(snapshot?.order) ? snapshot.order : [])
      .map((i) => byIndex.get(Number(i)))
      .filter((v) => v && v.videoId);
    return ordered.length > 0 ? ordered : videos.filter((v) => v && v.videoId);
  }

  /** Normalise items into numbered export rows. Rows without a video id are dropped. */
  function toRows(items) {
    const clean = (value) => (typeof value === "string" ? value.trim() : "");
    return (Array.isArray(items) ? items : [])
      .filter((it) => it && typeof it.videoId === "string" && it.videoId)
      .map((it, i) => ({
        position: i + 1,
        title: clean(it.title),
        channel: clean(it.channel),
        duration: clean(it.durationStr),
        videoId: it.videoId,
        url: watchUrl(it.videoId),
      }));
  }

  // Titles occasionally carry line breaks or runs of spaces from YouTube's
  // markup. The text format promises one line per video, so fold them.
  const oneLine = (value) => String(value || "").replace(/\s+/g, " ").trim();

  /**
   * Plain text, ready to paste into a note or a chat:
   *
   *   1. Title — Channel (12:34)
   *      https://www.youtube.com/watch?v=ID
   */
  function formatText(rows, { title = "" } = {}) {
    const lines = [];
    const heading = oneLine(title);
    if (heading) lines.push(heading, "");
    for (const row of rows || []) {
      let line = `${row.position}. ${oneLine(row.title) || row.videoId}`;
      if (oneLine(row.channel)) line += ` — ${oneLine(row.channel)}`;
      if (oneLine(row.duration)) line += ` (${oneLine(row.duration)})`;
      lines.push(line, `   ${row.url}`);
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  }

  /**
   * One RFC 4180 field. Video titles are written by strangers, so a title
   * like `=HYPERLINK(...)` would run as a formula when the file is opened in
   * a spreadsheet (CSV injection). A leading apostrophe makes Excel, Sheets
   * and LibreOffice show it as text. Numbers we generate ourselves are safe.
   */
  function csvCell(value) {
    if (typeof value === "number") return String(value);
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  /** CSV with a header row, CRLF line ends (RFC 4180) and a UTF-8 BOM unless `bom: false`. */
  function formatCsv(rows, { bom = true } = {}) {
    const lines = [CSV_HEADER.join(",")];
    for (const row of rows || []) {
      lines.push(
        [row.position, row.title, row.channel, row.duration, row.url].map(csvCell).join(",")
      );
    }
    return `${bom ? BOM : ""}${lines.join("\r\n")}\r\n`;
  }

  /**
   * "<playlist name>-YYYY-MM-DD.<ext>", with characters Windows/macOS refuse
   * in file names removed. Non-Latin names (Arabic) are kept as they are.
   */
  function fileName(name, ext, now = new Date()) {
    const base = String(name || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 80)
      .trim();
    return `${base || "playlist"}-${now.toISOString().slice(0, 10)}.${ext}`;
  }

  /** Save `content` as a file from the page — the same route as Backup.triggerDownload. */
  function download(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    // The synthetic click bubbles like a real one: the My Lists panel took it
    // for a click outside and closed, and YouTube's own link handling sees
    // every <a> click. The download is the default action, which this keeps.
    a.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Resolves true when the text reached the clipboard. Both routes need a
   * recent user gesture; loading a long playlist first can outlast it, so
   * callers must have a fallback for false.
   */
  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // Fall through to the legacy route.
    }
    let area = null;
    try {
      area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      return document.execCommand("copy") === true;
    } catch (_) {
      return false;
    } finally {
      area?.remove();
    }
  }

  window.RYP.Export = {
    CSV_HEADER,
    BOM,
    orderItems,
    snapshotItems,
    toRows,
    formatText,
    csvCell,
    formatCsv,
    fileName,
    download,
    copyText,
  };
})();
