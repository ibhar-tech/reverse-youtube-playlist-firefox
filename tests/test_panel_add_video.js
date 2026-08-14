/*
 * YouTube Playlist Tools — test_panel_add_video.js
 * Unit & Integration tests for Panel and Add-to-Playlist flow
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

describe("Panel & Universal Add-To-Playlist Flow", async () => {
  // These tests stub Playlist methods; the modules are shared across the whole
  // run, so the real ones have to go back afterwards or later suites inherit
  // this suite's playlist id.
  let originals;

  before(async () => {
    await import("../src/state.js");
    await import("../src/backup.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    await import("../src/panel.js");
    const { Playlist } = window.RYP;
    originals = { readItems: Playlist.readItems, getPlaylistId: Playlist.getPlaylistId };
  });

  beforeEach(async () => {
    globalThis.browser.storage.local.data = {};
    const { Playback } = window.RYP;
    await Playback.disableAll("PLunit123");
  });

  after(() => {
    Object.assign(window.RYP.Playlist, originals);
  });

  test("Saving snapshot creates structured snapshot in storage", async () => {
    const { Panel, State, Playlist } = window.RYP;
    
    // Stub readItems and getPlaylistId
    Playlist.getPlaylistId = () => "PLunit123";
    Playlist.readItems = () => [
      { index: 1, videoId: "vid1", title: "Video One", thumbnail: "thumb1.jpg" },
      { index: 2, videoId: "vid2", title: "Video Two", thumbnail: "thumb2.jpg" },
    ];

    await Panel.saveCurrentOrder("My Unit Test Playlist", null, ["test", "unit"], "PLunit123");

    const saved = (await State.get(State.keys.savedPlaylists)) || [];
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, "My Unit Test Playlist");
    assert.deepEqual(saved[0].tags, ["test", "unit"]);
    assert.deepEqual(saved[0].order, [1, 2]);
    assert.equal(saved[0].videos.length, 2);
  });

  test("Updating existing snapshot preserves its ID and updates content", async () => {
    const { Panel, State, Playlist } = window.RYP;
    const listId = "PLunit123";
    Playlist.getPlaylistId = () => listId;
    Playlist.readItems = () => [
      { index: 1, videoId: "vid1", title: "Video One" },
    ];

    // Initial save
    await Panel.saveCurrentOrder("Original Snapshot", null, ["initial"], listId);
    let saved = await State.get(State.keys.savedPlaylists);
    const originalId = saved[0].id;

    // Update items in playlist
    Playlist.readItems = () => [
      { index: 1, videoId: "vid1", title: "Video One" },
      { index: 2, videoId: "vid2", title: "Video Two" },
    ];

    // Update snapshot
    await Panel.saveCurrentOrder("Updated Snapshot", originalId, ["updated"], listId);
    saved = await State.get(State.keys.savedPlaylists);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, originalId);
    assert.deepEqual(saved[0].order, [1, 2]);
    assert.deepEqual(saved[0].tags, ["updated"]);
  });
});
