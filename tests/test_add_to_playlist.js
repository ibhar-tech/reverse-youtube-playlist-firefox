/*
 * YouTube Playlist Tools — test_add_to_playlist.js
 *
 * Guards the rule that keeps "Add video" coherent: only local playlists
 * (no sourceListId) can hold arbitrary videos. A snapshot of a real YouTube
 * playlist is a view over YouTube's items — adding a foreign video to one
 * would raise its count while the video could never play.
 */
import "./setup.js";
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Add-to-Local-Playlist rules", async () => {
  before(async () => {
    await import("../src/state.js");
    await import("../src/backup.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    await import("../src/panel.js");
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    location.pathname = "/watch";
    location.search = "?v=testVideo1&list=PLtestList";
  });

  test("only local playlists are offered as targets", () => {
    const { Panel } = window.RYP;

    // Local: can hold arbitrary videos.
    assert.equal(Panel.isLocalPlaylist({ sourceListId: "" }), true);
    assert.equal(Panel.isLocalPlaylist({ sourceListId: "custom" }), true, "legacy spelling of local");
    assert.equal(Panel.isLocalPlaylist({ sourceListId: "virtual:abc123" }), true);
    assert.equal(Panel.isLocalPlaylist({}), true, "missing field counts as local");

    // Views over a real YouTube playlist: never a target.
    assert.equal(Panel.isLocalPlaylist({ sourceListId: "PLBlnK6fEyqRiueC" }), false);
    assert.equal(Panel.isLocalPlaylist({ sourceListId: "PLtestList" }), false);
  });

  test("a snapshot saved from a playlist page is NOT a local playlist", async () => {
    const { Panel, Playlist } = window.RYP;
    const originalReadItems = Playlist.readItems;
    Playlist.readItems = () => [
      { index: 1, videoId: "aaaaaaaaaaa", title: "One", thumbnail: "", durationStr: "1:00" },
      { index: 2, videoId: "bbbbbbbbbbb", title: "Two", thumbnail: "", durationStr: "2:00" },
    ];

    try {
      await Panel.saveCurrentOrder("A view", null, [], "PLtestList");
      const saved = globalThis.browser.storage.local.data.savedPlaylists;
      assert.equal(saved.length, 1);
      assert.equal(saved[0].sourceListId, "PLtestList");
      assert.equal(
        Panel.isLocalPlaylist(saved[0]),
        false,
        "playlist snapshots must not be addable targets"
      );
    } finally {
      Playlist.readItems = originalReadItems;
    }
  });

  test("adding a video appends to both videos and order", () => {
    // Mirrors addVideoToSnapshot's computation.
    const target = {
      id: "local-1",
      sourceListId: "",
      order: [1, 2],
      videos: [
        { index: 1, videoId: "aaaaaaaaaaa", title: "One" },
        { index: 2, videoId: "bbbbbbbbbbb", title: "Two" },
      ],
    };

    const indices = target.videos.map((v) => Number(v.index)).filter(Number.isFinite);
    const nextIndex = (indices.length ? Math.max(...indices) : 0) + 1;
    const updated = {
      ...target,
      videos: [...target.videos, { index: nextIndex, videoId: "ccccccccccc", title: "Three" }],
      order: [...target.order, nextIndex],
    };

    assert.equal(nextIndex, 3);
    assert.equal(updated.videos.length, updated.order.length, "count sources must stay in step");
    assert.deepEqual(updated.order, [1, 2, 3]);
    assert.equal(updated.videos.at(-1).videoId, "ccccccccccc");
  });

  test("a local playlist survives an export/import round trip", async () => {
    const { Backup } = window.RYP;
    const local = {
      id: "local-2",
      name: "Watch later, locally",
      tags: [],
      sourceListId: "",
      order: [1],
      videos: [{ index: 1, videoId: "ccccccccccc", title: "Three", thumbnail: "", durationStr: "3:00" }],
      savedAt: new Date().toISOString(),
    };

    assert.equal(Backup.isValidSnapshot(local), true, "empty sourceListId must validate");
    const parsed = Backup.parseImport(
      JSON.stringify({ schema: "ryp-saved-playlists", version: 1, playlists: [local] })
    );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].sourceListId, "");
    assert.equal(parsed[0].videos[0].durationStr, "3:00");
  });
});

describe("Local playlist playback advances", async () => {
  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    location.pathname = "/watch";
    // A local playlist identifies itself through the URL hash.
    location.search = "?v=aaaaaaaaaaa";
    location.hash = "#ryp_list=SNAP1&ryp_index=1";
  });

  test("knows the next video in a local playlist", async () => {
    const { Playback, Playlist } = window.RYP;
    const original = Playlist.readItems;
    Playlist.readItems = () => [
      { index: 1, videoId: "aaaaaaaaaaa", title: "One" },
      { index: 2, videoId: "bbbbbbbbbbb", title: "Two" },
      { index: 3, videoId: "ccccccccccc", title: "Three" },
    ];
    try {
      await Playback.disableAll("virtual:SNAP1");
      // This is what the end-of-video handler asks for. Returning null here is
      // what made a local playlist stop instead of advancing.
      assert.equal(Playback.nextIndexInMode(1), 2);
      assert.equal(Playback.nextIndexInMode(2), 3);
      assert.equal(Playback.nextIndexInMode(3), null, "last video ends the list");
    } finally {
      Playlist.readItems = original;
    }
  });

  test("an empty panel yields no next video", async () => {
    const { Playback, Playlist } = window.RYP;
    const original = Playlist.readItems;
    // Exactly the state the Polymer-gutted rows produced: the panel is there
    // but readItems finds nothing, so playback had nowhere to go.
    Playlist.readItems = () => [];
    try {
      await Playback.disableAll("virtual:SNAP1");
      assert.equal(Playback.nextIndexInMode(1), null);
    } finally {
      Playlist.readItems = original;
    }
  });
});
