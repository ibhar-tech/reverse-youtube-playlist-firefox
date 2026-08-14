/*
 * YouTube Playlist Tools — test_playlist.js
 * Unit tests for Playlist module (duration parsing, statistics, count extraction)
 */
import "./setup.js";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

describe("Playlist Module — Unit Tests", async () => {
  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
  });

  test("parseTimeToSeconds parses various time formats correctly", () => {
    const { Playlist } = window.RYP;
    assert.equal(Playlist.parseTimeToSeconds("0:45"), 45);
    assert.equal(Playlist.parseTimeToSeconds("1:00"), 60);
    assert.equal(Playlist.parseTimeToSeconds("12:34"), 12 * 60 + 34);
    assert.equal(Playlist.parseTimeToSeconds("1:23:45"), 1 * 3600 + 23 * 60 + 45);
    assert.equal(Playlist.parseTimeToSeconds("10:00:00"), 36000);
    assert.equal(Playlist.parseTimeToSeconds(""), 0);
    assert.equal(Playlist.parseTimeToSeconds("invalid"), 0);
    assert.equal(Playlist.parseTimeToSeconds(null), 0);
  });

  test("formatDuration formats seconds to human-readable strings", () => {
    const { Playlist } = window.RYP;
    assert.equal(Playlist.formatDuration(45), "45s");
    assert.equal(Playlist.formatDuration(125), "2m 5s");
    assert.equal(Playlist.formatDuration(3665), "1h 1m");
    assert.equal(Playlist.formatDuration(7200), "2h 0m");
    assert.equal(Playlist.formatDuration(0), "0s");
  });

  test("calculateDurationStats calculates total, watched, remaining, and speed multipliers", () => {
    const { Playlist } = window.RYP;
    const mockItems = [
      { videoId: "v1", durationSeconds: 600, durationStr: "10:00" },
      { videoId: "v2", durationSeconds: 1200, durationStr: "20:00" },
      { videoId: "v3", durationSeconds: 1800, durationStr: "30:00" },
    ];
    const watchedVideoIds = ["v1"]; // 600 seconds watched

    const stats = Playlist.calculateDurationStats(mockItems, watchedVideoIds);

    assert.equal(stats.totalSeconds, 3600); // 1 hour total
    assert.equal(stats.watchedSeconds, 600); // 10m watched
    assert.equal(stats.remainingSeconds, 3000); // 50m remaining

    assert.equal(stats.totalFormatted, "1h 0m");
    assert.equal(stats.watchedFormatted, "10m");
    assert.equal(stats.remainingFormatted, "50m");

    // Speeds breakdown for remaining (3000 seconds = 50m)
    // 1.0x = 50m
    // 1.25x = 40m
    // 1.5x = 33m
    // 2.0x = 25m
    assert.equal(stats.speeds["1.0x"], "50m");
    assert.equal(stats.speeds["1.25x"], "40m");
    assert.equal(stats.speeds["2.0x"], "25m");
  });
});
