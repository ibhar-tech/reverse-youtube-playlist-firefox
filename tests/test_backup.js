/*
 * YouTube Playlist Tools — test_backup.js
 * Unit tests for Backup module (validation, tag normalization, merge logic)
 */
import "./setup.js";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

describe("Backup Module — Unit Tests", async () => {
  before(async () => {
    await import("../src/backup.js");
  });

  test("normalizeTags formats, deduplicates and trims tags", () => {
    const { Backup } = window.RYP;
    assert.deepEqual(Backup.normalizeTags("coding, tutorials, #coding, study"), ["coding", "tutorials", "study"]);
    assert.deepEqual(Backup.normalizeTags(["music", "lofi", "music"]), ["music", "lofi"]);
    assert.deepEqual(Backup.normalizeTags(""), []);
    assert.deepEqual(Backup.normalizeTags(null), []);
  });

  test("isValidSnapshot validates well-formed playlist snapshots", () => {
    const { Backup } = window.RYP;

    const validSnapshot = {
      id: "snap-123",
      name: "My Custom Playlist",
      tags: ["study"],
      sourceListId: "PL1234567890abcdef",
      order: [1, 2],
      videos: [
        { index: 1, videoId: "abc123XYZ01", title: "Video 1" },
        { index: 2, videoId: "abc123XYZ02", title: "Video 2" },
      ],
      savedAt: "2026-08-14T00:00:00.000Z"
    };
    assert.equal(Backup.isValidSnapshot(validSnapshot), true);

    // Custom sourceListId is valid
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, sourceListId: "custom" }), true);

    // Invalid snapshot (empty order)
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, order: [] }), false);

    // Invalid snapshot (missing name)
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, name: "  " }), false);
  });

  test("mergeSnapshots handles deduplication and ID collisions", () => {
    const { Backup } = window.RYP;

    const existing = [
      {
        id: "id-1",
        name: "Existing List",
        tags: ["tag1"],
        sourceListId: "PL1",
        order: [1],
        videos: [{ index: 1, videoId: "v1", title: "Video 1" }],
        savedAt: "2026-01-01T00:00:00.000Z"
      }
    ];

    const incoming = [
      // Duplicate of existing
      {
        id: "id-1",
        name: "Existing List",
        tags: ["tag1"],
        sourceListId: "PL1",
        order: [1],
        videos: [{ index: 1, videoId: "v1", title: "Video 1" }],
        savedAt: "2026-01-01T00:00:00.000Z"
      },
      // New distinct snapshot
      {
        id: "id-2",
        name: "Brand New List",
        tags: ["tag2"],
        sourceListId: "PL2",
        order: [1],
        videos: [{ index: 1, videoId: "v2", title: "Video 2" }],
        savedAt: "2026-02-01T00:00:00.000Z"
      }
    ];

    const { merged, added, skipped } = Backup.mergeSnapshots(existing, incoming);
    assert.equal(added, 1);
    assert.equal(skipped, 1);
    assert.equal(merged.length, 2);
    assert.equal(merged[1].name, "Brand New List");
  });
});
