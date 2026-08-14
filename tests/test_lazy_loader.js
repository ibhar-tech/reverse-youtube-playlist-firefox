/*
 * YouTube Playlist Tools — test_lazy_loader.js
 * Unit tests for Lazy Loading count detection and scroll resolver
 */
import "./setup.js";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

describe("Lazy Loading Resolver — Unit Tests", async () => {
  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
  });

  test("getTotalItemCount extracts video count from various YouTube header patterns", () => {
    const { Playlist } = window.RYP;

    // Pattern 1: Watch page counter "1 / 57 • Rick Astley"
    let mockText = "1 / 57 • Rick Astley";
    document.querySelector = (sel) => {
      if (sel.includes("byline") || sel.includes("publisher-container") || sel.includes("index")) {
        return { textContent: mockText };
      }
      return null;
    };
    assert.equal(Playlist.getTotalItemCount(), 57);

    // Pattern 2: Watch page counter "1 / 145"
    mockText = "1 / 145";
    assert.equal(Playlist.getTotalItemCount(), 145);

    // Pattern 3: Overview page stats "145 videos"
    mockText = "145 videos • 1,234,567 views";
    assert.equal(Playlist.getTotalItemCount(), 145);

    // Pattern 4: Formatted large counts "1,250 videos"
    mockText = "1,250 videos";
    assert.equal(Playlist.getTotalItemCount(), 1250);

    // Pattern 5: Arabic header "145 فيديو"
    mockText = "145 فيديو";
    assert.equal(Playlist.getTotalItemCount(), 145);

    // Pattern 6: French header "145 vidéos"
    mockText = "145 vidéos";
    assert.equal(Playlist.getTotalItemCount(), 145);
  });

  test("loadAllItems resolves when loadedCount reaches totalItemCount", async () => {
    const { Playlist } = window.RYP;

    let currentItemsCount = 20;
    const totalCount = 60;

    Playlist.getTotalItemCount = () => totalCount;
    Playlist.readItems = () => Array.from({ length: currentItemsCount }, (_, i) => ({ index: i + 1, videoId: `v${i + 1}` }));
    Playlist.getItemsContainer = () => ({
      parentElement: null,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });

    const progressUpdates = [];
    const progressCallback = (loaded, total) => {
      progressUpdates.push({ loaded, total });
      // Simulate items arriving on scroll
      currentItemsCount = Math.min(totalCount, currentItemsCount + 20);
    };

    const result = await Playlist.loadAllItems(progressCallback);

    assert.equal(result.loaded, 60);
    assert.equal(result.completed, true);
    assert.ok(progressUpdates.length > 0);
  });
});
