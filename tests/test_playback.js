/*
 * YouTube Playlist Tools — test_playback.js
 * Unit tests for Playback engine (reverse, shuffle, smart sorting, custom ordering)
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

describe("Playback Module — Smart Sorting & Playback Logic", async () => {
  // These tests stub Playlist.readItems; the modules are shared across the
  // whole run, so the real one has to go back afterwards.
  let originalReadItems;

  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    originalReadItems = window.RYP.Playlist.readItems;
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
  });

  after(() => {
    window.RYP.Playlist.readItems = originalReadItems;
  });

  test("sortByTitle sorts items alphabetically ascending and descending", async () => {
    const { Playback, Playlist } = window.RYP;
    const listId = "PLtest1";

    const mockItems = [
      { index: 1, videoId: "v1", title: "Zebra in the Wild", durationSeconds: 100, channel: "Animals" },
      { index: 2, videoId: "v2", title: "Apple Pie Recipe", durationSeconds: 200, channel: "Cooking" },
      { index: 3, videoId: "v3", title: "Monkey Business", durationSeconds: 150, channel: "Comedy" },
    ];

    // Stub readItems
    Playlist.readItems = () => mockItems;

    // A -> Z
    const orderAZ = await Playback.sortByTitle(listId, true);
    assert.deepEqual(orderAZ, [2, 3, 1]); // Apple (2), Monkey (3), Zebra (1)

    // Z -> A
    const orderZA = await Playback.sortByTitle(listId, false);
    assert.deepEqual(orderZA, [1, 3, 2]); // Zebra (1), Monkey (3), Apple (2)
  });

  test("sortByDuration sorts items by length shortest first and longest first", async () => {
    const { Playback, Playlist } = window.RYP;
    const listId = "PLtest2";

    const mockItems = [
      { index: 1, videoId: "v1", title: "Mid video", durationSeconds: 300 },
      { index: 2, videoId: "v2", title: "Long video", durationSeconds: 900 },
      { index: 3, videoId: "v3", title: "Short video", durationSeconds: 60 },
    ];
    Playlist.readItems = () => mockItems;

    // Shortest first
    const orderShort = await Playback.sortByDuration(listId, true);
    assert.deepEqual(orderShort, [3, 1, 2]); // 60s (3), 300s (1), 900s (2)

    // Longest first
    const orderLong = await Playback.sortByDuration(listId, false);
    assert.deepEqual(orderLong, [2, 1, 3]); // 900s (2), 300s (1), 60s (3)
  });

  test("sortByChannel sorts items by channel name", async () => {
    const { Playback, Playlist } = window.RYP;
    const listId = "PLtest3";

    const mockItems = [
      { index: 1, videoId: "v1", title: "Video 1", channel: "Veritasium" },
      { index: 2, videoId: "v2", title: "Video 2", channel: "3Blue1Brown" },
      { index: 3, videoId: "v3", title: "Video 3", channel: "Kurzgesagt" },
    ];
    Playlist.readItems = () => mockItems;

    const orderChannel = await Playback.sortByChannel(listId, true);
    assert.deepEqual(orderChannel, [2, 3, 1]); // 3Blue1Brown (2), Kurzgesagt (3), Veritasium (1)
  });

  test("sortByWatched prioritizes unwatched or watched items", async () => {
    const { Playback, Playlist } = window.RYP;
    const listId = "PLtest4";

    const mockItems = [
      { index: 1, videoId: "v1", title: "Video 1" },
      { index: 2, videoId: "v2", title: "Video 2" },
      { index: 3, videoId: "v3", title: "Video 3" },
    ];
    Playlist.readItems = () => mockItems;

    // Mark v2 as watched
    await Playback.markAsWatched(listId, "v2");

    // Unwatched first: unwatched (1, 3) followed by watched (2)
    const orderUnwatched = await Playback.sortByWatched(listId, true);
    assert.deepEqual(orderUnwatched, [1, 3, 2]);

    // Watched first: watched (2) followed by unwatched (1, 3)
    const orderWatched = await Playback.sortByWatched(listId, false);
    assert.deepEqual(orderWatched, [2, 1, 3]);
  });
});
