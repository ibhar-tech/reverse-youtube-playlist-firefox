/*
 * YouTube Playlist Tools — test_review_fixes.js
 * Regression tests for defects found in the 3.4.0 code review.
 */
import "./setup.js";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

function row({ href, index }) {
  const anchor = { getAttribute: (n) => (n === "href" ? href : null) };
  return {
    dataset: index === undefined ? {} : { index: String(index) },
    querySelector: (sel) => (sel.includes("wc-endpoint") ? anchor : null),
  };
}

const snapshot = (overrides = {}) => ({
  id: "snap-1",
  name: "My list",
  tags: [],
  sourceListId: "",
  order: [1],
  videos: [{ index: 1, videoId: "dQw4w9WgXcQ", title: "t", channel: "Rick Astley" }],
  savedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("Code review regressions", async () => {
  before(async () => {
    await import("../src/backup.js");
    await import("../src/state.js");
    await import("../src/playlist.js");
  });

  test("snapshots of Watch Later / Liked videos survive a backup round-trip", () => {
    const { Backup } = window.RYP;
    for (const list of ["WL", "LL", "LM"]) {
      const out = Backup.parseImport(JSON.stringify({ playlists: [snapshot({ sourceListId: list })] }));
      assert.equal(out.length, 1, `${list} snapshot was rejected`);
      assert.equal(out[0].sourceListId, list);
    }
    // A one-letter id is still not a playlist.
    assert.equal(Backup.isValidSnapshot(snapshot({ sourceListId: "W" })), false);
  });

  test("import keeps each video's channel", () => {
    const { Backup } = window.RYP;
    const [imported] = Backup.parseImport(JSON.stringify({ playlists: [snapshot()] }));
    assert.equal(imported.videos[0].channel, "Rick Astley");
  });

  test("re-importing your own backup adds nothing", () => {
    const { Backup } = window.RYP;
    const stored = [snapshot()];
    const incoming = Backup.parseImport(JSON.stringify({ playlists: stored }));
    const { added, skipped, merged } = Backup.mergeSnapshots(stored, incoming);
    assert.equal(added, 0);
    assert.equal(skipped, 1);
    assert.equal(merged.length, 1);
  });

  test("itemIndex reads local-playlist rows (index in the hash)", () => {
    const { Playlist } = window.RYP;
    assert.equal(Playlist.itemIndex(row({ href: "/watch?v=abcdefghijk#ryp_list=snap-1&ryp_index=7" })), 7);
    assert.equal(Playlist.itemIndex(row({ href: "/watch?v=abcdefghijk&list=PLx&index=3" })), 3);
    assert.equal(Playlist.itemIndex(row({ href: "/watch?v=abcdefghijk", index: 4 })), 4);
    assert.equal(Playlist.itemIndex(row({ href: "/watch?v=abcdefghijk" })), null);
  });
});
