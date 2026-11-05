/*
 * YouTube Playlist Tools — test_design_fixes.js
 * The three 3.6 design fixes: orders keyed by video id, long playlists,
 * and telling YouTube's auto-advance apart from the user's own click.
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

function item(index, videoId, clicks) {
  return {
    index,
    videoId,
    title: videoId,
    element: { id: `row-${videoId}-${index}` },
    anchor: { click: () => clicks.push(videoId) },
  };
}

describe("3.6 design fixes", async () => {
  let originals;
  let clicks;
  let rows;

  before(async () => {
    await import("../src/backup.js");
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    await import("../src/panel.js");
    const { Playlist } = window.RYP;
    originals = { readItems: Playlist.readItems, qs: document.querySelector };
  });

  beforeEach(async () => {
    globalThis.browser.storage.local.data = {};
    clicks = [];
    rows = [];
    location.pathname = "/watch";
    location.hash = "";
    location.href = undefined;
    window.RYP.Playlist.readItems = () => rows;
    document.querySelector = () => null;
    window.RYP.Playback.updateSettings({});
    await window.RYP.Playback.disableAll("PLx");
    window.RYP.Playback.handleNavigation(); // releases any navigating latch
  });

  after(() => {
    window.RYP.Playlist.readItems = originals.readItems;
    document.querySelector = originals.qs;
  });

  const at = (videoId, index) => {
    location.search = `?v=${videoId}&list=PLx&index=${index}`;
  };

  test("an order keyed by video id survives the playlist being edited", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    at("ccc", 3);
    await Playback.applyCustomOrder("PLx", ["ccc", "aaa", "bbb"]);

    // Owner adds a video at the top: every position shifts by one.
    rows = [item(1, "new", clicks), item(2, "aaa", clicks), item(3, "bbb", clicks), item(4, "ccc", clicks)];
    at("ccc", 4);
    assert.equal(Playback.nextIndexInMode("ccc"), "aaa");
    at("aaa", 2);
    assert.equal(Playback.nextIndexInMode("aaa"), "bbb");
    at("bbb", 3);
    assert.equal(Playback.nextIndexInMode("bbb"), null, "end of order");
  });

  test("legacy position orders are converted to video ids on load", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    at("aaa", 1);
    globalThis.browser.storage.local.data["customOrder:PLx"] = [3, 1, 7, 2];
    assert.equal(await Playback.loadState("PLx"), true);
    // 7 is not rendered yet: kept as a position until its row appears.
    assert.deepEqual(Playback.getState().customOrder, ["ccc", "aaa", 7, "bbb"]);
    assert.deepEqual(globalThis.browser.storage.local.data["customOrder:PLx"], ["ccc", "aaa", 7, "bbb"]);
    rows.push(item(7, "ggg", clicks));
    await Playback.migrateLegacyOrder("PLx");
    assert.deepEqual(Playback.getState().customOrder, ["ccc", "aaa", "ggg", "bbb"]);
  });

  test("a video listed twice continues from the right copy", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    await Playback.applyCustomOrder("PLx", ["aaa", "bbb", "aaa", "ccc"]);
    at("bbb", 2);
    Playback.handleNavigation();
    assert.equal(Playback._stepNext(), true);
    assert.deepEqual(clicks, ["aaa"]);
    // Arrive on aaa — YouTube's row for it is still index 1.
    at("aaa", 1);
    Playback.handleNavigation();
    assert.equal(Playback.nextIndexInMode("aaa"), "ccc", "second copy of aaa → ccc, not bbb again");
    assert.equal(Playback._stepNext(), true);
    assert.deepEqual(clicks, ["aaa", "ccc"]);
  });

  test("a video that is not rendered is reached through its URL", () => {
    const { Playlist } = window.RYP;
    rows = [item(1, "aaa", clicks)];
    at("aaa", 1);
    assert.equal(Playlist.goToVideo("aaa"), true);
    assert.deepEqual(clicks, ["aaa"], "rendered rows are clicked (in-app navigation)");
    assert.equal(Playlist.goToVideo("zzz"), true);
    assert.equal(location.href, "/watch?v=zzz&list=PLx");
  });

  test("a local playlist never falls back to a URL", () => {
    const { Playlist } = window.RYP;
    rows = [];
    location.search = "?v=aaa";
    location.hash = "#ryp_list=SNAP&ryp_index=1";
    assert.equal(Playlist.goToVideo("zzz"), false);
    assert.equal(location.href, undefined);
  });

  test("shuffle and sort store video ids", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    at("aaa", 1);
    await Playback.enableShuffle("PLx");
    const order = Playback.getState().customOrder;
    assert.deepEqual([...order].sort(), ["aaa", "bbb", "ccc"]);
    assert.deepEqual(globalThis.browser.storage.local.data["customOrder:PLx"], order);
  });

  test("snapshot positions replay as video ids", () => {
    const { Backup } = window.RYP;
    const snap = {
      order: [3, 1, 2],
      videos: [
        { index: 1, videoId: "aaa" },
        { index: 2, videoId: "bbb" },
        { index: 3, videoId: "ccc" },
      ],
    };
    assert.deepEqual(Backup.orderVideoIds(snap), ["ccc", "aaa", "bbb"]);
    assert.deepEqual(Backup.orderVideoIds({ order: [9], videos: [] }), []);
  });

  test("saving a snapshot under a video-id order stores valid positions", async () => {
    const { Playback, Panel, Backup } = window.RYP;
    rows = [item(1, "aaaaaaaaaaa", clicks), item(2, "bbbbbbbbbbb", clicks), item(3, "ccccccccccc", clicks)];
    at("aaaaaaaaaaa", 1);
    // A legacy position (2) mixed in, and one id with no rendered row.
    await Playback.applyCustomOrder("PLx", ["ccccccccccc", "zzzzzzzzzzz", 2, "aaaaaaaaaaa"]);
    await Panel.saveCurrentOrder("Mine", null, [], "PLx");
    const [snap] = globalThis.browser.storage.local.data.savedPlaylists;
    assert.deepEqual(snap.order, [3, 2, 1]);
    assert.equal(Backup.isValidSnapshot(snap), true, "must survive a backup round-trip");
    assert.deepEqual(Backup.orderVideoIds(snap), ["ccccccccccc", "bbbbbbbbbbb", "aaaaaaaaaaa"]);
  });

  test("a click on the next row is never overridden, even near the end", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    await Playback.enableReverse("PLx");
    clicks.length = 0;
    at("bbb", 2);
    Playback.handleNavigation();

    const v = { duration: 100, currentTime: 98.5 };
    document.querySelector = (sel) => (sel.includes("video") ? v : null);
    const row = { closest: () => ({}) };
    Playback._onUserPick({ isTrusted: true, target: row });
    Playback._onNavigateStart();
    at("ccc", 3);
    Playback.handleNavigation();
    assert.deepEqual(clicks, [], "the user picked index+1 — it plays");

    // Same moment without a user click: YouTube's auto-advance, redirected.
    await new Promise((r) => setTimeout(r, 1600));
    at("bbb", 2);
    Playback.handleNavigation();
    Playback._onNavigateStart();
    at("ccc", 3);
    Playback.handleNavigation();
    assert.deepEqual(clicks, ["aaa"], "reverse order goes 2 → 1");
  });

  test("3.5.0: YouTube bumping the URL index on the same video is not an advance", async () => {
    const { Playback } = window.RYP;
    rows = [item(1, "aaa", clicks), item(2, "bbb", clicks), item(3, "ccc", clicks)];
    await Playback.enableReverse("PLx");
    clicks.length = 0;
    at("bbb", 2);
    Playback.handleNavigation();
    // Even with the end-of-video signal, the same video with index+1 in the
    // address bar is YouTube's URL rewrite (refresh / new tab) — stay put.
    const v = { duration: 100, currentTime: 99.5 };
    document.querySelector = (sel) => (sel.includes("video") ? v : null);
    Playback._onNavigateStart();
    at("bbb", 3);
    Playback.handleNavigation();
    assert.deepEqual(clicks, [], "same video: no redirect");
  });

  test("3.5.0: the position comes from the selected row, not the rewritten URL", () => {
    const { Playlist } = window.RYP;
    const selectedRow = {
      hasAttribute: (a) => a === "selected",
      classList: { contains: () => false },
      dataset: {},
      querySelector: (sel) =>
        sel.includes("wc-endpoint")
          ? { getAttribute: () => "/watch?v=bbb&list=PLx&index=2" }
          : null,
    };
    const panel = { querySelectorAll: () => [selectedRow] };
    document.querySelector = (sel) => (sel === Playlist.SEL.panel ? panel : null);
    location.search = "?v=bbb&list=PLx&index=3"; // YouTube's +1 rewrite
    assert.equal(Playlist.currentIndex(), 2);
    // A selected row for a different video is not trusted over the URL.
    location.search = "?v=ccc&list=PLx&index=3";
    assert.equal(Playlist.currentIndex(), 3);
  });

  test("our own synthetic clicks don't count as the user", () => {
    const { Playback } = window.RYP;
    const row = { closest: () => ({}) };
    // Would throw or flip state if treated as trusted; just must not count.
    Playback._onUserPick({ isTrusted: false, target: row });
  });
});
